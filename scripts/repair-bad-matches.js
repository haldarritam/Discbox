#!/usr/bin/env node
/**
 * Repair tracks that were marked "downloaded" against a file that isn't theirs.
 *
 * Two bugs put bad rows in the database:
 *   1. findDownloadedFile() normalized titles by stripping everything outside
 *      [a-z0-9], so any non-Latin title became "" — and `includes("")` is always
 *      true, so the library-wide walk returned whatever audio file it hit first.
 *   2. downloadTrack() resolved `{ success: true }` even when it could not find
 *      the file it had just tried to write.
 *
 * Both are fixed in the app; this cleans up the rows they already created.
 * A repaired track goes back to `pending`, so the next sync re-downloads it
 * properly.
 *
 * With --delete-files the wrong audio is removed from disk too, but ONLY when
 * the track being repaired is the sole owner of that path. A file that another
 * track legitimately downloaded is never deleted — the bogus claim on it is
 * dropped from the database instead.
 *
 * Usage:
 *   node scripts/repair-bad-matches.js                          # dry run
 *   node scripts/repair-bad-matches.js --apply                  # update the database
 *   node scripts/repair-bad-matches.js --apply --delete-files   # ...and delete the bad audio
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
// Works both from a checkout (backend/src/...) and inside the container (/app/src/...).
const SRC = fs.existsSync(path.join(__dirname, '../backend/src/services/matching.js'))
  ? path.join(__dirname, '../backend/src/services')
  : '/app/src/services';
const { normalizeTitle, sanitizeFilename, coverage, durationMatches } = require(path.join(SRC, 'matching'));
const YTDLPService = require(path.join(SRC, 'ytdlp'));

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const DELETE_FILES = process.argv.includes('--delete-files');
const CHECK_DURATION = !process.argv.includes('--skip-duration');

/** Remove a file, then any album/artist directory it just left empty. */
function deleteFileAndEmptyParents(filePath) {
  fs.unlinkSync(filePath);
  let dir = path.dirname(filePath);
  for (let depth = 0; depth < 2; depth++) {
    try {
      if (fs.readdirSync(dir).length > 0) break;
      fs.rmdirSync(dir);
      dir = path.dirname(dir);
    } catch (e) {
      break;
    }
  }
}

/**
 * Filename (minus any "07 - " prefix) has to actually carry the track title.
 *
 * The title is sanitized first, because that is what the downloader wrote to
 * disk: "3:59 AM" is stored as "359 AM.mp3" and "cold/mess" as "coldmess.mp3".
 * Comparing the raw title flags those correct files as mismatches.
 */
function filenameMatchesTitle(filePath, title) {
  const stem = path
    .basename(filePath, path.extname(filePath))
    .replace(/^\d{1,3}\s*-\s*/, '');
  const wanted = normalizeTitle(sanitizeFilename(title));
  if (!wanted) return false;
  return coverage(wanted, normalizeTitle(stem)) >= 0.6;
}

async function main() {
  const tracks = await prisma.track.findMany({ where: { status: 'downloaded' } });
  console.log(`Checking ${tracks.length} tracks marked "downloaded"...\n`);

  // Which tracks claim each path — a path claimed twice means a bad fuzzy match.
  const byPath = new Map();
  for (const track of tracks) {
    if (!track.file_path) continue;
    if (!byPath.has(track.file_path)) byPath.set(track.file_path, []);
    byPath.get(track.file_path).push(track);
  }

  const broken = [];
  const reasons = {};
  // Files safe to delete: the repaired track is the only claimant AND the file
  // carries its name, so it is this track's own bad download and nothing else
  // in the library depends on it.
  const deletable = new Set();
  const note = (track, reason, detail = '', canDelete = false) => {
    broken.push(track);
    reasons[reason] = (reasons[reason] || 0) + 1;
    if (canDelete && track.file_path) deletable.add(track.file_path);
    console.log(`  [${reason}]${canDelete ? ' [delete]' : ''} ${track.artist} - ${track.title}${detail ? ` ${detail}` : ''}`);
    console.log(`      ${track.file_path || '(no path)'}`);
  };

  for (const track of tracks) {
    if (!track.file_path) {
      note(track, 'no-path');
      continue;
    }

    if (!fs.existsSync(track.file_path)) {
      note(track, 'file-missing');
      continue;
    }

    // Shared path: keep the lowest id (the track that really downloaded it).
    const sharers = byPath.get(track.file_path);
    if (sharers.length > 1) {
      const owner = sharers.reduce((a, b) => (a.id <= b.id ? a : b));
      if (track.id !== owner.id) {
        note(track, 'duplicate-claim');
        continue;
      }
    }

    // Not deleted: the filename says this file was written for a DIFFERENT
    // track (often one whose own row lost its file_path). Dropping the bogus
    // claim is enough; sweeping genuinely orphaned audio is
    // cleanup-orphaned-files.js's job.
    if (!filenameMatchesTitle(track.file_path, track.title)) {
      note(track, 'filename-mismatch');
      continue;
    }

    // Sole claimant, and the filename is this track's own, so anything wrong
    // with the contents makes the file this track's to delete.

    if (CHECK_DURATION && track.duration) {
      const actual = await YTDLPService.probeDuration(track.file_path);
      if (actual && !durationMatches(actual, track.duration)) {
        note(track, 'duration-mismatch', `(file ${actual}s, source says ${track.duration}s)`, true);
        continue;
      }
    }
  }

  console.log(`\n--- ${broken.length} of ${tracks.length} tracks need repair ---`);
  for (const [reason, count] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }
  console.log(`  files safe to delete: ${deletable.size}`);
  console.log(`  bogus claims on files owned by another track (kept on disk): ${broken.length - deletable.size}`);

  if (!broken.length) return;

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to reset these to "pending"' +
      (DELETE_FILES ? ' and delete the files marked [delete].' : '.'));
    return;
  }

  if (DELETE_FILES) {
    let deleted = 0;
    let failed = 0;
    for (const filePath of deletable) {
      try {
        deleteFileAndEmptyParents(filePath);
        deleted++;
      } catch (err) {
        failed++;
        console.warn(`  could not delete ${filePath}: ${err.message}`);
      }
    }
    console.log(`\nDeleted ${deleted} wrong audio files${failed ? ` (${failed} failed)` : ''}.`);
  }

  const result = await prisma.track.updateMany({
    where: { id: { in: broken.map((t) => t.id) } },
    data: { status: 'pending', file_path: null, download_error: null, retry_count: 0 },
  });
  console.log(`Reset ${result.count} tracks to "pending". They will re-download on the next sync.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
