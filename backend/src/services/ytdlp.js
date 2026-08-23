const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const {
  normalize,
  normalizeTitle,
  coverage,
  primaryArtist,
  durationMatches,
  durationTolerance,
  unwantedVariantMarkers,
} = require('./matching');

/** Candidate must carry at least this much of the wanted title to be considered. */
const MIN_TITLE_COVERAGE = 0.6;
/** ...and this much of the wanted artist, somewhere in the video title or channel. */
const MIN_ARTIST_COVERAGE = 0.5;
/** Both-ways title overlap required when matching an existing file by name. */
const FILENAME_MATCH_COVERAGE = 0.75;

const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.m4a', '.opus', '.ogg', '.aac'];

/**
 * Filesystem-safe name. Kept byte-for-byte identical to the original so that
 * paths already stored in the database still resolve.
 */
const sanitize = (str) => (str || '')
  .replace(/[<>:"\/\\|?*]/g, '')
  .replace(/\//g, '-')
  .trim();

class YTDLPService {
  /**
   * Check if yt-dlp is installed and get version
   * @returns {Promise<string>} Version string
   */
  static async checkYtDlp() {
    return new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', ['--version']);
      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              'yt-dlp is not installed. Install via: curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp'
            )
          );
        } else {
          resolve(output.trim());
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run yt-dlp: ${err.message}`));
      });
    });
  }

  /**
   * Update yt-dlp in place. YouTube breaks older builds regularly — once a build
   * goes stale every download starts failing with HTTP 403 Forbidden — so this
   * runs at boot and on a timer rather than being frozen at image build time.
   * @returns {Promise<{updated: boolean, version: string|null, error: string|null}>}
   */
  static async updateYtDlp() {
    return new Promise((resolve) => {
      const proc = spawn('yt-dlp', ['--update-to', 'stable']);
      let output = '';
      proc.stdout.on('data', (d) => { output += d.toString(); });
      proc.stderr.on('data', (d) => { output += d.toString(); });
      proc.on('close', async (code) => {
        let version = null;
        try {
          version = await YTDLPService.checkYtDlp();
        } catch (e) { /* leave null */ }
        resolve({
          updated: code === 0,
          version,
          error: code === 0 ? null : output.trim(),
        });
      });
      proc.on('error', (err) => resolve({ updated: false, version: null, error: err.message }));
    });
  }

  /**
   * Read the real runtime of an audio file. Used to reject partial rips and
   * wrong-version matches after the download finishes.
   * @param {string} filePath
   * @returns {Promise<number|null>} duration in seconds
   */
  static async probeDuration(filePath) {
    return new Promise((resolve) => {
      const proc = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1',
        filePath,
      ]);
      let output = '';
      proc.stdout.on('data', (d) => { output += d.toString(); });
      proc.on('close', (code) => {
        const seconds = parseFloat(output.trim());
        resolve(code === 0 && Number.isFinite(seconds) ? Math.round(seconds) : null);
      });
      proc.on('error', () => resolve(null));
    });
  }

  /**
   * Search YouTube and return every plausible candidate, best first.
   *
   * Scoring is gated, not purely additive: a candidate has to actually look like
   * the requested artist + title, and — when the source (Deezer) told us how long
   * the track runs — has to run for about that long. Without those gates an
   * unrelated 3-minute video scored a single point (just for being 2-8 minutes
   * long) and was downloaded as if it were the track.
   *
   * @param {string} artist
   * @param {string} title
   * @param {Object} options - { preference, expectedDuration, limit }
   * @returns {Promise<Array>} [{ url, videoId, title, duration, channelName, score }]
   */
  static async searchCandidates(artist, title, options = {}) {
    const {
      preference = 'auto',
      expectedDuration = null,
      limit = 10,
    } = options;

    const suffix = preference === 'lyrics' ? 'lyrics' : 'official audio';
    const query = `${artist} ${title} ${suffix}`;

    const raw = await new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', [
        `ytsearch${limit}:${query}`,
        '--dump-json',
        '--no-download',
        '--flat-playlist',
        '--no-warnings',
        '--socket-timeout', '30',
      ]);

      let output = '';
      proc.stdout.on('data', (data) => { output += data.toString(); });

      proc.on('close', (code) => {
        if (code !== 0 || !output.trim()) {
          resolve([]);
          return;
        }
        try {
          resolve(
            output.trim().split('\n')
              .filter((line) => line.trim())
              .map((line) => JSON.parse(line))
          );
        } catch (e) {
          reject(e);
        }
      });

      proc.on('error', reject);
    });

    const wantedTitle = normalizeTitle(title);
    const wantedArtist = normalize(primaryArtist(artist));

    /**
     * @param {boolean} strictDuration - true: candidate must sit inside the
     *   normal tolerance. false: allow +/-25% but demand a perfect title match,
     *   so a track whose only upload is a music video with a long intro can
     *   still be found instead of failing outright.
     */
    const evaluate = (strictDuration) => {
      const scored = [];

      for (const result of raw) {
        const candidateTitle = result.title || '';
        const channel = result.channel || result.uploader || '';
        const duration = result.duration || 0;

        // Gate 1 — runtime. With a reference duration this is the single most
        // reliable signal that we found the right recording.
        if (expectedDuration) {
          if (!duration) continue;
          const withinTolerance = strictDuration
            ? durationMatches(duration, expectedDuration)
            : Math.abs(duration - expectedDuration) <= expectedDuration * 0.25;
          if (!withinTolerance) continue;
        } else if (duration && (duration < 60 || duration > 900)) {
          continue;
        }

        // Gate 2 — the video has to name the track.
        const titleCoverage = coverage(wantedTitle, normalizeTitle(candidateTitle));
        if (titleCoverage < (strictDuration ? MIN_TITLE_COVERAGE : 1)) continue;

        // Gate 3 — ...and the artist, in the video title or the channel name.
        const artistCoverage = Math.max(
          coverage(wantedArtist, normalize(candidateTitle)),
          coverage(wantedArtist, normalize(channel))
        );
        if (artistCoverage < (strictDuration ? MIN_ARTIST_COVERAGE : 1)) continue;

        let score = titleCoverage * 4 + artistCoverage * 3;

        const channelLower = normalize(channel);
        const titleLower = normalize(candidateTitle);
        if (channelLower.includes('topic')) score += 3;   // auto-generated = studio master
        if (titleLower.includes('official audio')) score += 2;
        if (titleLower.includes('official video')) score += 1;
        if (preference === 'lyrics' && titleLower.includes('lyrics')) score += 1;

        // Closer runtime wins: exact -> +2, at the tolerance limit -> 0.
        if (expectedDuration && duration) {
          const drift = Math.abs(duration - expectedDuration);
          score += 2 * Math.max(-1, 1 - drift / durationTolerance(expectedDuration));
        }

        // Live/remix/cover/sped-up versions the user did not ask for.
        const markers = unwantedVariantMarkers(candidateTitle, title);
        score -= markers.length * 2;

        scored.push({
          url: result.url || (result.id ? `https://www.youtube.com/watch?v=${result.id}` : null),
          videoId: result.id,
          title: candidateTitle,
          duration,
          channelName: channel,
          score: Math.round(score * 100) / 100,
          variantMarkers: markers,
          relaxed: !strictDuration,
        });
      }

      return scored
        .filter((c) => c.url && c.score > 0)
        .sort((a, b) => b.score - a.score);
    };

    const strict = evaluate(true);
    if (strict.length > 0) return strict;

    const relaxed = expectedDuration ? evaluate(false) : [];
    if (relaxed.length > 0) {
      console.log(
        `[yt-dlp] No exact-length match for "${artist} - ${title}" (~${expectedDuration}s); ` +
        `falling back to ${relaxed.length} relaxed candidate(s)`
      );
    }
    return relaxed;
  }

  /**
   * Backwards-compatible single-result search.
   * @returns {Promise<Object|null>}
   */
  static async searchYouTube(artist, title, preference = 'auto', expectedDuration = null) {
    try {
      const candidates = await YTDLPService.searchCandidates(artist, title, {
        preference,
        expectedDuration,
      });
      return candidates[0] || null;
    } catch (error) {
      console.error('Error searching YouTube:', error.message);
      return null;
    }
  }

  /**
   * Build the exact path a download will land at. Keeping this deterministic is
   * what lets us verify a download afterwards instead of guessing at it.
   * @param {Object} args - { outputDir, artist, title, album, trackPosition, format }
   * @returns {{ template: string, expectedPath: string, dir: string }}
   */
  static resolveOutputPath({ outputDir, artist, title, album, trackPosition, format }) {
    const safeArtist = sanitize(artist);
    const safeTitle = sanitize(title);
    const safeAlbum = sanitize(album || '');
    const trackNum = trackPosition
      ? `${String(trackPosition).padStart(2, '0')} - `
      : '';

    const dir = safeAlbum
      ? path.join(outputDir, safeArtist, safeAlbum)
      : path.join(outputDir, safeArtist);
    const base = path.join(dir, `${trackNum}${safeTitle}`);

    return {
      dir,
      template: `${base}.%(ext)s`,
      expectedPath: `${base}.${format}`,
    };
  }

  /**
   * Download a track from YouTube.
   *
   * Returns success ONLY when a file actually exists at the path we told yt-dlp
   * to write to, and (when the source gave us a reference duration) only when
   * that file runs for about the right length. The old version resolved
   * `{ success: true }` even when it could not find any file, which is how
   * tracks ended up marked "downloaded" pointing at another track's file.
   *
   * @param {string} videoUrl
   * @param {string} artist
   * @param {string} title
   * @param {Object} options - { format, quality, outputDir, onProgress, track, expectedDuration, durationSlack }
   * @returns {Promise<Object>} { success, filePath, duration, durationMismatch, error }
   */
  static async downloadTrack(videoUrl, artist, title, options = {}) {
    const {
      format = 'mp3',
      quality = '320k',
      outputDir = '/music',
      onProgress = null,
      track = {},
      expectedDuration = track.duration || null,
      // Fraction of expectedDuration to allow instead of the default tolerance.
      // Set when the candidate came from the relaxed search pass.
      durationSlack = null,
    } = options;

    const tolerance = expectedDuration
      ? (durationSlack ? Math.round(expectedDuration * durationSlack) : durationTolerance(expectedDuration))
      : null;

    const { dir, template, expectedPath } = YTDLPService.resolveOutputPath({
      outputDir,
      artist,
      title,
      album: track.album_name,
      trackPosition: track.track_position,
      format,
    });

    console.log(`[yt-dlp] ${artist} - ${title} -> ${expectedPath}`);

    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (mkdirErr) {
      console.warn(`[yt-dlp] mkdir warning (non-fatal): ${mkdirErr.message}`);
    }

    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Never let a leftover file from a previous attempt look like a success.
      try {
        if (fs.existsSync(expectedPath)) fs.unlinkSync(expectedPath);
      } catch (e) { /* ignore */ }

      try {
        const exitError = await new Promise((resolve, reject) => {
          const args = [
            '-x',
            '--audio-format', format,
            '--audio-quality', quality,
            '--embed-thumbnail',
            '--embed-metadata',
            '--output', template,
            '--newline',
            '--no-playlist',
            '--no-warnings',
            '--no-continue',
            '--socket-timeout', '30',
            videoUrl,
          ];

          const proc = spawn('yt-dlp', args);
          let error = '';

          proc.stdout.on('data', (data) => {
            const line = data.toString().trim();
            const progressMatch = line.match(
              /\[download\]\s+([\d.]+)%.*at\s+([\d.]+\w+\/s).*ETA\s+([\d:]+)/
            );
            if (progressMatch && onProgress) {
              onProgress({
                percent: parseFloat(progressMatch[1]),
                speed: progressMatch[2],
                eta: progressMatch[3],
              });
            }
          });

          proc.stderr.on('data', (data) => { error += data.toString(); });

          proc.on('close', (code) => {
            resolve(code === 0 ? null : (error.trim() || `yt-dlp exited with code ${code}`));
          });

          proc.on('error', (err) => reject(err));
        });

        if (exitError) throw new Error(exitError);

        // Verify: the file has to be where we told yt-dlp to put it.
        const filePath = fs.existsSync(expectedPath)
          ? expectedPath
          : YTDLPService.findInDir(dir, path.basename(expectedPath, `.${format}`));

        if (!filePath) {
          throw new Error(`yt-dlp reported success but no file was written to ${expectedPath}`);
        }

        // Verify: the runtime matches what the source said it should be. Catches
        // truncated rips and near-miss wrong versions that survived search scoring.
        const actualDuration = await YTDLPService.probeDuration(filePath);
        if (expectedDuration && actualDuration && Math.abs(actualDuration - expectedDuration) > tolerance) {
          try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
          return {
            success: false,
            filePath: null,
            duration: actualDuration,
            durationMismatch: true,
            error: `Duration mismatch: got ${actualDuration}s, expected ~${expectedDuration}s (tolerance ${tolerance}s)`,
          };
        }

        return { success: true, filePath, duration: actualDuration, error: null };
      } catch (error) {
        lastError = error.message;
        if (attempt < maxRetries) {
          console.warn(`[yt-dlp] attempt ${attempt + 1} failed (${lastError}), retrying in 5s...`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    return {
      success: false,
      filePath: null,
      duration: null,
      error: lastError || 'All download attempts failed',
    };
  }

  /**
   * Look for `<basename>.<audio ext>` inside a single directory.
   * @param {string} dir
   * @param {string} basename
   * @returns {string|null}
   */
  static findInDir(dir, basename) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (!AUDIO_EXTENSIONS.includes(ext.toLowerCase())) continue;
        if (path.basename(entry.name, ext) === basename) {
          return path.join(dir, entry.name);
        }
      }
    } catch (e) { /* missing dir / permissions */ }
    return null;
  }

  /**
   * Locate an already-downloaded file for a track.
   *
   * Only directories this track could legitimately live in are searched
   * (`<out>/<artist>/` and its album subfolders), and a candidate filename must
   * actually carry the track's title.
   *
   * The previous implementation walked the ENTIRE music library and matched with
   * `String.includes` on a normalization that stripped every non-ASCII character
   * — for a CJK/Devanagari/Cyrillic title the needle became "" and
   * `includes("")` is always true, so it returned whichever audio file the walk
   * hit first. In this library that mislabelled 937 tracks as "downloaded",
   * all pointing at unrelated files.
   *
   * @param {string} outputDir
   * @param {string} artist
   * @param {string} title
   * @param {Object} track - optional, for album_name / track_position
   * @returns {string|null}
   */
  static findDownloadedFile(outputDir, artist, title, track = {}, options = {}) {
    const { exactOnly = false } = options;
    const normalizedTitle = normalizeTitle(title);
    if (!normalizedTitle) return null; // refuse to match on an empty needle

    // The exact path the current naming scheme would produce, first.
    for (const ext of AUDIO_EXTENSIONS) {
      const { expectedPath } = YTDLPService.resolveOutputPath({
        outputDir,
        artist,
        title,
        album: track.album_name,
        trackPosition: track.track_position,
        format: ext.slice(1),
      });
      if (fs.existsSync(expectedPath)) return expectedPath;
    }

    if (exactOnly) return null;

    // Otherwise scan only this artist's folders — covers files written under an
    // older naming scheme (e.g. before track numbers were prefixed).
    const artistDir = path.join(outputDir, sanitize(artist));
    const searchDirs = [artistDir];
    try {
      for (const entry of fs.readdirSync(artistDir, { withFileTypes: true })) {
        if (entry.isDirectory()) searchDirs.push(path.join(artistDir, entry.name));
      }
    } catch (e) {
      return null;
    }

    for (const dir of searchDirs) {
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (e) { continue; }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = path.extname(entry.name);
        if (!AUDIO_EXTENSIONS.includes(ext.toLowerCase())) continue;

        // Drop a leading "07 - " track-number prefix before comparing.
        const stem = normalizeTitle(
          path.basename(entry.name, ext).replace(/^\d{1,3}\s*-\s*/, '')
        );
        // Symmetric on purpose: "Alag Aasmaan" fully covers "Alag Aasmaan
        // (Acoustic)" in one direction, and those are different recordings.
        if (coverage(normalizedTitle, stem) >= FILENAME_MATCH_COVERAGE
            && coverage(stem, normalizedTitle) >= FILENAME_MATCH_COVERAGE) {
          return path.join(dir, entry.name);
        }
      }
    }

    return null;
  }

  static async tagFile(filePath, track) {
    return new Promise((resolve) => {
      const taggerPath = path.join(__dirname, 'tagger.py')
      const tmpJson = path.join('/tmp', `tag_${Date.now()}_${Math.random().toString(36).slice(2)}.json`)

      const meta = {
        filepath: filePath,
        artist: track.artist || '',
        title: track.title || '',
        album: track.album_name || null,
        album_art_url: track.album_art_url || null,
        contributors: track.contributors || null,
        track_position: track.track_position || null,
        disk_number: track.disk_number || null,
        release_date: track.release_date || null,
        bpm: track.bpm || null,
        isrc: track.isrc || null,
      }

      fs.writeFileSync(tmpJson, JSON.stringify(meta))
      console.log(`[tagger] Tagging: ${track.artist} - ${track.title}`)

      const proc = spawn('python3', [taggerPath, tmpJson])
      let error = ''
      proc.stdout.on('data', (data) => { console.log(data.toString().trim()) })
      proc.stderr.on('data', (data) => { error += data.toString(); console.warn('[tagger]', data.toString().trim()) })
      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpJson) } catch {}
        if (code === 0) {
          resolve({ success: true })
        } else {
          console.warn(`[tagger] Failed for ${filePath}: ${error}`)
          resolve({ success: false, error })
        }
      })
      proc.on('error', (err) => {
        try { fs.unlinkSync(tmpJson) } catch {}
        resolve({ success: false, error: err.message })
      })
    })
  }
}

module.exports = YTDLPService;
