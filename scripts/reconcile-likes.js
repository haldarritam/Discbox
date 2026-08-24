#!/usr/bin/env node
/**
 * Reconcile the Track table against what is actually loved on Deezer right now.
 *
 * Discbox only ever ADDS tracks. Nothing removes a row when a track stops being
 * a source of truth, so the table drifts upward over time:
 *   - tracks unliked on Deezer since they were first synced stay forever
 *   - tracks pulled in by sync_albums / sync_playlists stay even after those
 *     toggles are turned off
 *
 * This reports (and optionally removes) every track that is no longer backed by
 * a live "loved" entry on one of the configured Deezer accounts. Manually added
 * tracks (account_label = 'manual') and tracks the user explicitly blocked are
 * always kept.
 *
 * The expected set is built with the SAME dedupe key the sync uses
 * (primary artist + title, lowercased), so the numbers line up with what a sync
 * would produce rather than with a raw API total.
 *
 * Usage:
 *   node scripts/reconcile-likes.js                          # dry run
 *   node scripts/reconcile-likes.js --apply                  # delete the extra rows
 *   node scripts/reconcile-likes.js --apply --delete-files   # ...and their audio
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const SRC = fs.existsSync(path.join(__dirname, '../backend/src/services/matching.js'))
  ? path.join(__dirname, '../backend/src/services')
  : '/app/src/services';
const { trackKey } = require(path.join(SRC, 'matching'));
const DeezerService = require(path.join(SRC, 'deezer'));

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const DELETE_FILES = process.argv.includes('--delete-files');

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

async function main() {
  const accounts = await prisma.deezerAccount.findMany();

  // Build the expected set from live Deezer data.
  const expected = new Map(); // key -> {artist, title, label}
  for (const account of accounts) {
    const label = account.label || account.user_id;
    if (!account.sync_loved) {
      console.log(`[${label}] sync_loved is off — skipping`);
      continue;
    }
    // A short read here would look exactly like "the user unliked these" and
    // this script deletes on that basis, so verify against the count Deezer
    // itself reports before trusting the list.
    let loved;
    try {
      loved = await new DeezerService(account.user_id).getLovedTracks();
    } catch (err) {
      console.error(`[${label}] ${err.message}`);
      console.error('Aborting: refusing to reconcile against an incomplete list.');
      process.exitCode = 1;
      return;
    }
    console.log(`[${label}] ${loved.length} loved tracks on Deezer`);
    for (const track of loved) {
      const key = trackKey(track.artist, track.title);
      if (!expected.has(key)) expected.set(key, { ...track, label });
    }
  }

  const manualTracks = await prisma.track.findMany({ where: { account_label: 'manual' } });
  for (const track of manualTracks) {
    expected.set(trackKey(track.artist, track.title), { manual: true });
  }

  console.log(
    `\nExpected: ${expected.size} unique tracks ` +
    `(loved across ${accounts.length} account(s) + ${manualTracks.length} manual, deduped)`
  );

  const dbTracks = await prisma.track.findMany();
  console.log(`In database: ${dbTracks.length}\n`);

  // Extras: rows with no live "loved" entry behind them.
  const seen = new Set();
  const extras = [];
  const duplicates = [];
  for (const track of dbTracks) {
    if (track.status === 'blocked') continue;         // deliberately suppressed
    if (track.account_label === 'manual') continue;   // hand-added, always keep

    const key = trackKey(track.artist, track.title);
    if (!expected.has(key)) {
      extras.push(track);
    } else if (seen.has(key)) {
      duplicates.push(track);   // same song stored twice under artist spelling variants
    } else {
      seen.add(key);
    }
  }

  const bySource = {};
  for (const track of extras) {
    const source = track.source || 'unknown';
    bySource[source] = (bySource[source] || 0) + 1;
  }

  console.log(`--- ${extras.length} tracks are no longer backed by a Deezer like ---`);
  for (const [source, count] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${source}: ${count}`);
  }
  if (duplicates.length) {
    console.log(`--- ${duplicates.length} duplicate rows for a track already counted ---`);
  }

  const missing = [...expected.entries()].filter(([key]) => !seen.has(key) && !expected.get(key).manual);
  console.log(`--- ${missing.length} loved tracks are missing from the database ---`);
  for (const [, track] of missing.slice(0, 10)) {
    console.log(`  ${track.artist} - ${track.title}`);
  }
  if (missing.length > 10) console.log(`  ...and ${missing.length - 10} more`);

  const removable = [...extras, ...duplicates];

  // Never delete audio that a row we are KEEPING still points at. A duplicate
  // row usually has its own file (its artist string differs, so it downloaded
  // to a different folder), but nothing guarantees that — and deleting the
  // surviving track's audio would be silent data loss.
  const keptPaths = new Set(
    dbTracks
      .filter((t) => !removable.some((r) => r.id === t.id))
      .map((t) => t.file_path)
      .filter(Boolean)
  );
  const shared = removable.filter((t) => t.file_path && keptPaths.has(t.file_path));
  const withFiles = removable.filter(
    (t) => t.file_path && !keptPaths.has(t.file_path) && fs.existsSync(t.file_path)
  );
  if (shared.length) {
    console.log(`  (${shared.length} of these share a file with a track being kept — file left alone)`);
  }
  console.log(`\nWould remove ${removable.length} rows (${withFiles.length} have audio on disk).`);
  console.log(`Resulting count: ${dbTracks.length - removable.length} (target ${expected.size})`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply' +
      (DELETE_FILES ? ' --delete-files to remove the rows and their audio.' : ' to remove the rows.'));
    return;
  }

  if (DELETE_FILES) {
    let deleted = 0;
    for (const track of withFiles) {
      try {
        deleteFileAndEmptyParents(track.file_path);
        deleted++;
      } catch (err) {
        console.warn(`  could not delete ${track.file_path}: ${err.message}`);
      }
    }
    console.log(`\nDeleted ${deleted} audio files.`);
  }

  const result = await prisma.track.deleteMany({
    where: { id: { in: removable.map((t) => t.id) } },
  });
  console.log(`Removed ${result.count} rows. Total is now ${await prisma.track.count()}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
