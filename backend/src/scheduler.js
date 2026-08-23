const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const LastFMService = require('./services/lastfm');
const YTDLPService = require('./services/ytdlp');
const DeezerService = require('./services/deezer');
const { primaryArtist, durationMatches } = require('./services/matching');

const prisma = new PrismaClient();

// File scanner globals
let scannerTimer = null;
let ytdlpUpdateTimer = null;

const MINUTE_MS = 60 * 1000;

/**
 * How many search results to try before giving up on a track. If the top hit
 * turns out to be the wrong length once downloaded, we fall through to the next.
 */
const MAX_CANDIDATES_PER_TRACK = 3;

/**
 * yt-dlp writes multi-line WARNINGs (stale-version notices, SABR notices) to
 * stderr alongside the real error. Keep only the lines that explain the failure
 * so download_error stays readable in the UI.
 * @param {string} raw
 * @returns {string}
 */
function cleanError(raw) {
  const lines = (raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const errors = lines.filter((l) => /^ERROR/i.test(l));
  const text = (errors.length ? errors : lines.filter((l) => !/^WARNING/i.test(l) && !/^\s*(It is strongly|Run "yt-dlp|To suppress)/i.test(l)));
  return (text.length ? text : lines).join(' ').slice(0, 500);
}

class SyncScheduler {
  constructor() {
    this.scheduledTask = null;
    this.isRunning = false;
    this.eventBroadcaster = null;
  }

  /**
   * Set the event broadcaster for SSE updates
   */
  setEventBroadcaster(broadcaster) {
    this.eventBroadcaster = broadcaster;
  }

  /**
   * Emit an event to connected SSE clients
   */
  emitEvent(event) {
    if (this.eventBroadcaster) {
      this.eventBroadcaster(event);
    }
  }

  /**
   * Start the sync scheduler
   */
  async start({ runInitialSync = true } = {}) {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 1 },
      });

      if (!settings) {
        console.log('Scheduler: No settings found, waiting for configuration');
        return;
      }

      const interval = settings.sync_interval || 360; // Default 6 hours

      // A plain interval timer, not cron. The old `*/${interval} * * * *` is only
      // a valid cron expression while interval < 60 — at the default of 360
      // minutes node-cron reduced it to "every hour", so the app synced 6x more
      // often than configured (and hammered the Deezer API doing it).
      if (this.scheduledTask) clearInterval(this.scheduledTask);
      this.scheduledTask = setInterval(() => {
        this.sync().catch((err) => console.error('Scheduled sync error:', err));
      }, interval * MINUTE_MS);

      console.log(`Scheduler: Started, sync every ${interval} minutes`);
      this.emitEvent({
        type: 'scheduler_started',
        interval,
        timestamp: new Date(),
      });

      // Run initial sync (skipped when we're just re-arming the timer after a
      // settings change — a full Deezer re-fetch on every save is wasteful).
      if (runInitialSync) {
        setTimeout(() => this.sync(), 5000);
      }
    } catch (error) {
      console.error('Scheduler start error:', error);
    }
  }

  /**
   * Stop the sync scheduler
   */
  stop() {
    if (this.scheduledTask) {
      clearInterval(this.scheduledTask);
      this.scheduledTask = null;
      console.log('Scheduler: Stopped');
      this.emitEvent({
        type: 'scheduler_stopped',
        timestamp: new Date(),
      });
    }
  }

  /**
   * Main sync logic
   */
  async sync() {
    if (this.isRunning) {
      console.log('Sync already in progress, skipping');
      return;
    }

    this.isRunning = true;
    const syncStartTime = new Date();

    this.emitEvent({
      type: 'sync_started',
      timestamp: syncStartTime,
    });

    const syncStats = {
      tracksFound: 0,
      tracksAdded: 0,
      tracksDownloaded: 0,
      tracksFailed: 0,
      lovedCount: 0,
      albumCount: 0,
      playlistCount: 0,
    };

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 1 },
      });

      const hasLastfmConfig = settings?.lastfm_api_key && settings?.lastfm_username;
      const lastfm = hasLastfmConfig
        ? new LastFMService(settings.lastfm_api_key, settings.lastfm_secret, settings.lastfm_username)
        : null;

      // Collect all tracks from various sources
      const collectedTracks = [];

      // Step 1: Fetch loved tracks from Last.fm (optional)
      if (hasLastfmConfig && lastfm && settings.sync_loved) {
        try {
          console.log('Sync: Fetching loved tracks from Last.fm');
          const loved = await lastfm.getLovedTracks();
          console.log(`Sync: Found ${loved.length} loved tracks`);

          // Enrich loved tracks with album info from track.getInfo
          const enrichedTracks = await Promise.all(
            loved.map(async (track) => {
              // Only fetch if album info is missing or art is placeholder
              const needsEnrichment = !track.album_name || !track.album_art_url ||
                track.album_art_url.includes('2a96cbd8b46e442fc41c2b86b821562f');

              if (needsEnrichment) {
                const info = await lastfm.getTrackInfo(track.artist, track.title);
                if (info) {
                  return {
                    ...track,
                    album_name: info.album_name || track.album_name || null,
                    album_art_url: info.album_art_url || track.album_art_url || null,
                  };
                }
              }
              return track;
            })
          );

          collectedTracks.push(
            ...enrichedTracks.map((track) => ({
              ...track,
              source: 'loved',
            }))
          );

          syncStats.lovedCount = loved.length;
        } catch (error) {
          console.error('Error fetching loved tracks:', error);
        }
      }


      // Step 2: Album sync disabled (library.getalbums deprecated by Last.fm)
      // Step 3: Playlist sync disabled (user.getplaylists deprecated by Last.fm)



      // Step 4: Deezer sync
      const deezerAccounts = await prisma.deezerAccount.findMany();
      for (const account of deezerAccounts) {
        const deezer = new DeezerService(account.user_id);
        const label = account.label || account.user_id;
        console.log(`[deezer] Syncing account: ${label}`);
        try {
          if (account.sync_loved) {
            const loved = await deezer.getLovedTracks();
            console.log(`[deezer] ${label}: Found ${loved.length} loved tracks`);
            collectedTracks.push(...loved.map(t => ({ ...t, account_label: label })));
          }
        } catch (err) {
          console.error(`[deezer] ${label}: Failed to fetch loved tracks:`, err.message);
        }
        try {
          if (account.sync_albums) {
            const albumTracks = await deezer.getSavedAlbums();
            console.log(`[deezer] ${label}: Found ${albumTracks.length} album tracks`);
            collectedTracks.push(...albumTracks.map(t => ({ ...t, account_label: label })));
          }
        } catch (err) {
          console.error(`[deezer] ${label}: Failed to fetch album tracks:`, err.message);
        }
        try {
          if (account.sync_playlists) {
            const playlistTracks = await deezer.getPlaylistTracks();
            console.log(`[deezer] ${label}: Found ${playlistTracks.length} playlist tracks`);
            collectedTracks.push(...playlistTracks.map(t => ({ ...t, account_label: label })));
          }
        } catch (err) {
          console.error(`[deezer] ${label}: Failed to fetch playlist tracks:`, err.message);
        }
      }
      syncStats.tracksFound = collectedTracks.length;
      console.log(
        `Sync: Total collected ${collectedTracks.length} tracks from all sources`
      );

      // Step 4: Deduplicate tracks by (primary artist + title), keep "loved" source as priority
      // Primary artist = first artist before any comma/feat/& to handle multi-artist differences
      // e.g. "Pritam, Atif Aslam" and "Pritam" both normalize to "pritam"
      const dedupeMap = new Map();
      for (const track of collectedTracks) {
        const key = `${primaryArtist(track.artist).toLowerCase()}|${track.title.toLowerCase()}`;
        const existing = dedupeMap.get(key);

        if (!existing) {
          dedupeMap.set(key, track);
        } else if (track.source === 'loved') {
          // Last.fm loved takes highest priority
          dedupeMap.set(key, track);
        } else if (track.source === 'deezer_loved' && existing.source !== 'loved') {
          // Deezer loved takes priority over album/playlist sources
          dedupeMap.set(key, track);
        }
      }

      const deduplicatedTracks = Array.from(dedupeMap.values());
      console.log(
        `Sync: Deduped to ${deduplicatedTracks.length} unique tracks`
      );

      // Step 5: Insert new tracks into database
      //
      // One indexed read of (artist, title, status, source, id) instead of a
      // findUnique per collected track — this loop used to fire ~6500 separate
      // SQLite queries on every sync.
      const knownTracks = new Map(
        (await prisma.track.findMany({
          select: { id: true, artist: true, title: true, status: true, source: true },
        })).map((t) => [`${t.artist}\u0000${t.title}`, t])
      );

      let tracksAdded = 0;
      for (const track of deduplicatedTracks) {
        try {
          const existing = knownTracks.get(`${track.artist}\u0000${track.title}`);

          if (existing?.status === 'blocked') {
            // Track is blocked — skip re-adding
          } else if (!existing) {
            await prisma.track.create({
              data: {
                artist: track.artist,
                title: track.title,
                album: track.album || null,
                lastfm_url: track.lastfm_url || track.url || null,
                album_art_url: track.album_art_url || track.albumImage || null,
                status: 'pending',
                source: track.source,
                album_name: track.album_name || null,
                playlist_name: track.playlist_name || null,
                isrc: track.isrc || null,
                release_date: track.release_date || null,
                track_position: track.track_position || null,
                disk_number: track.disk_number || null,
                bpm: track.bpm || null,
                duration: track.duration || null,
                explicit_lyrics: track.explicit_lyrics || false,
                deezer_id: track.deezer_id || null,
                contributors: track.contributors || null,
                account_label: track.account_label || null,
              },
            });
            tracksAdded++;
          } else if (
            existing.source !== 'loved' &&
            track.source === 'loved'
          ) {
            // Update to loved if this is the first time we see it as loved
            await prisma.track.update({
              where: { id: existing.id },
              data: {
                source: 'loved',
              },
            });
          }
        } catch (error) {
          console.error(
            `Failed to insert track ${track.artist} - ${track.title}:`,
            error.message
          );
        }
      }

      syncStats.tracksAdded = tracksAdded;
      console.log(`Sync: Added ${tracksAdded} new tracks to database`);

      // Step 6: Process pending tracks for download
      const pendingTracks = await prisma.track.findMany({
        where: {
          status: 'pending',
          OR: [
            { requested_at: null },
            { requested_at: { lte: new Date() } },
          ],
        },
        orderBy: { created_at: 'desc' },
      });

      console.log(
        `Sync: Processing ${pendingTracks.length} pending tracks for download`
      );

      // Process up to max_concurrent_downloads at a time
      const maxConcurrent = settings.max_concurrent_downloads || 2;
      for (let i = 0; i < pendingTracks.length; i += maxConcurrent) {
        const batch = pendingTracks.slice(
          i,
          Math.min(i + maxConcurrent, pendingTracks.length)
        );

        await Promise.all(
          batch.map((track) =>
            this.processTrackDownload(track, settings, syncStats)
          )
        );
      }

      // Step 7: Create sync log
      await prisma.syncLog.create({
        data: {
          tracks_found: syncStats.tracksFound,
          tracks_added: syncStats.tracksAdded,
          tracks_downloaded: syncStats.tracksDownloaded,
          tracks_failed: syncStats.tracksFailed,
          loved_count: syncStats.lovedCount,
          album_count: syncStats.albumCount,
          playlist_count: syncStats.playlistCount,
        },
      });

      console.log('Sync completed successfully', syncStats);
      this.emitEvent({
        type: 'sync_completed',
        summary: syncStats,
        timestamp: new Date(),
      });
    } catch (error) {
      console.error('Sync error:', error);
      this.emitEvent({
        type: 'sync_error',
        error: error.message,
        timestamp: new Date(),
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Pick a YouTube source for a track.
   *
   * A URL the user supplied by hand always wins — the whole point of pasting a
   * link is to override the search. The old code stored `youtube_url` on manual
   * adds and then ignored it, running its own search and downloading whatever
   * that returned, which is why hand-added tracks came back as the wrong (or a
   * truncated) recording.
   *
   * @param {Object} track
   * @param {Object} settings
   * @returns {Promise<{candidates: Array, manual: boolean}>}
   */
  async resolveCandidates(track, settings) {
    if (track.account_label === 'manual' && track.youtube_url) {
      console.log(`[scheduler] Using user-supplied URL for "${track.artist}" - "${track.title}"`);
      return {
        manual: true,
        candidates: [{
          url: track.youtube_url,
          videoId: track.youtube_video_id || null,
          title: track.title,
          duration: track.duration || null,
          score: Infinity,
        }],
      };
    }

    console.log(
      `Downloading: Searching YouTube for "${track.artist}" - "${track.title}"` +
      (track.duration ? ` (~${track.duration}s)` : '')
    );

    const candidates = await YTDLPService.searchCandidates(track.artist, track.title, {
      preference: settings.search_preference || 'auto',
      expectedDuration: track.duration || null,
    });

    return { manual: false, candidates };
  }

  /**
   * Process a single track download
   */
  async processTrackDownload(track, settings, syncStats) {
    const bump = (key) => {
      if (syncStats && typeof syncStats[key] === 'number') syncStats[key]++;
    };

    const markFailed = async (error) => {
      const message = cleanError(error);
      await prisma.track.update({
        where: { id: track.id },
        data: {
          status: 'failed',
          download_error: message,
          retry_count: (track.retry_count || 0) + 1,
        },
      });
      bump('tracksFailed');
      console.error(`Download failed for "${track.artist}" - "${track.title}": ${message}`);
      this.emitEvent({
        type: 'track_failed',
        trackId: track.id,
        error: message,
        timestamp: new Date(),
      });
    };

    try {
      const outputDir = settings.music_output_dir || '/music';

      // If a good file is already on disk for this track, don't re-download it.
      // Exact path only — a fuzzy filename match here could adopt a sibling
      // recording ("Alag Aasmaan" vs "Alag Aasmaan (Acoustic)").
      const alreadyThere = YTDLPService.findDownloadedFile(
        outputDir, track.artist, track.title, track, { exactOnly: true }
      );
      if (alreadyThere) {
        const existingDuration = await YTDLPService.probeDuration(alreadyThere);
        if (durationMatches(existingDuration, track.duration)) {
          console.log(`[scheduler] Already on disk, skipping download: ${alreadyThere}`);
          await prisma.track.update({
            where: { id: track.id },
            data: {
              status: 'downloaded',
              file_path: alreadyThere,
              download_error: null,
              downloaded_at: track.downloaded_at || new Date(),
            },
          });
          bump('tracksDownloaded');
          this.emitEvent({
            type: 'track_downloaded',
            trackId: track.id,
            status: 'downloaded',
            filePath: alreadyThere,
            download_error: null,
            timestamp: new Date(),
          });
          return;
        }
      }

      // Step 1: Find sources to try
      const { candidates, manual } = await this.resolveCandidates(track, settings);

      if (candidates.length === 0) {
        const reason = track.duration
          ? `No YouTube result matching "${track.title}" at ~${track.duration}s`
          : 'No YouTube result found';
        console.warn(`Download: ${reason} for "${track.artist}" - "${track.title}"`);
        await markFailed(reason);
        return;
      }

      // Step 2: Sanitize artist and title before download
      const safeArtist = (track.artist && track.artist !== 'NA' && track.artist.trim())
        ? track.artist.trim()
        : 'Unknown Artist';
      const safeTitle = (track.title && track.title !== 'NA' && track.title.trim())
        ? track.title.trim()
        : 'Unknown Title';

      // Step 3: Try candidates best-first. A candidate that downloads to the
      // wrong length is discarded and we fall through to the next one.
      const attempts = manual
        ? candidates
        : candidates.slice(0, MAX_CANDIDATES_PER_TRACK);
      let lastError = 'All candidates rejected';

      for (const [index, candidate] of attempts.entries()) {
        console.log(
          `[scheduler] Candidate ${index + 1}/${attempts.length} for "${track.artist}" - "${track.title}": ` +
          `${candidate.title} (${candidate.duration || '?'}s, score ${candidate.score})`
        );

        await prisma.track.update({
          where: { id: track.id },
          data: {
            youtube_url: candidate.url,
            youtube_video_id: candidate.videoId,
            status: 'downloading',
          },
        });

        this.emitEvent({
          type: 'track_downloading',
          trackId: track.id,
          timestamp: new Date(),
        });

        const downloadResult = await YTDLPService.downloadTrack(
          candidate.url,
          safeArtist,
          safeTitle,
          {
            format: settings.audio_format || 'mp3',
            quality: settings.audio_quality || '320k',
            outputDir,
            track,
            // A hand-picked URL is trusted as-is; only searched results are
            // held to the source's runtime.
            expectedDuration: manual ? null : (track.duration || null),
            durationSlack: candidate.relaxed ? 0.25 : null,
            onProgress: (progress) => {
              this.emitEvent({
                type: 'download_progress',
                trackId: track.id,
                percent: progress.percent,
                speed: progress.speed,
                eta: progress.eta,
                timestamp: new Date(),
              });
            },
          }
        );

        if (downloadResult.success) {
          await YTDLPService.tagFile(downloadResult.filePath, track);

          await prisma.track.update({
            where: { id: track.id },
            data: {
              status: 'downloaded',
              file_path: downloadResult.filePath,
              download_error: null,
              retry_count: 0,
              downloaded_at: new Date(),
            },
          });
          bump('tracksDownloaded');

          console.log(
            `Download: Successfully downloaded "${track.artist}" - "${track.title}" ` +
            `-> ${downloadResult.filePath}`
          );

          this.emitEvent({
            type: 'track_downloaded',
            trackId: track.id,
            status: 'downloaded',
            filePath: downloadResult.filePath,
            download_error: null,
            timestamp: new Date(),
          });
          return;
        }

        lastError = downloadResult.error || 'Unknown download error';

        if (downloadResult.durationMismatch) {
          console.warn(`[scheduler] Rejected candidate: ${lastError}`);
          continue; // try the next search result
        }

        // A YouTube premiere isn't a failure — it just hasn't aired yet.
        const premiereMatch = lastError.match(/Premieres in (\d+) hours?/i);
        if (premiereMatch) {
          const hoursUntil = parseInt(premiereMatch[1], 10) + 1;
          const retryAt = new Date(Date.now() + hoursUntil * 60 * 60 * 1000);
          await prisma.track.update({
            where: { id: track.id },
            data: {
              status: 'pending',
              download_error: `Premiere — auto-retry after ${retryAt.toISOString()}`,
              retry_count: 0,
              requested_at: retryAt,
            },
          });
          console.log(
            `[scheduler] Premiere detected for "${track.artist}" - "${track.title}", retrying in ${hoursUntil}h`
          );
          return;
        }

        // Unavailable/age-gated/blocked video — the next candidate may work.
        console.warn(`[scheduler] Candidate failed: ${cleanError(lastError)}`);
      }

      await markFailed(lastError);
    } catch (error) {
      console.error(`Error processing track ${track.id}:`, error.message);
      await markFailed(error.message);
    }
  }
}

/**
 * File scanner — verifies that every "downloaded" track really has its own file
 * on disk, and re-queues failed tracks that still have retries left.
 */
async function runFileScanner() {
  try {
    console.log('[scanner] Starting file scan...');

    const settings = await prisma.settings.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      console.log('[scanner] No settings found, skipping scan');
      return;
    }

    const outputDir = settings.music_output_dir || '/music';
    const maxRetries = settings.max_retries || 3;

    // Step 1: Check all downloaded tracks - verify files exist
    const downloadedTracks = await prisma.track.findMany({
      where: { status: 'downloaded' },
    });

    console.log(`[scanner] Checking ${downloadedTracks.length} downloaded tracks...`);

    // Two tracks must never claim the same file. When they do, the later claim
    // is a bad match, not a real download.
    const claimedPaths = new Map();
    for (const track of downloadedTracks) {
      if (!track.file_path) continue;
      if (!claimedPaths.has(track.file_path)) claimedPaths.set(track.file_path, []);
      claimedPaths.get(track.file_path).push(track);
    }

    let filesVerified = 0;
    let filesNotFound = 0;
    let duplicateClaims = 0;

    const requeue = async (track, reason) => {
      console.warn(`[scanner] ${reason} for "${track.artist}" - "${track.title}" (${track.file_path || 'no path'})`);
      await prisma.track.update({
        where: { id: track.id },
        data: {
          status: 'pending',
          file_path: null,
          download_error: null,
          retry_count: 0,
        },
      });
    };

    for (const track of downloadedTracks) {
      const sharers = track.file_path ? claimedPaths.get(track.file_path) : null;
      if (sharers && sharers.length > 1) {
        // Keep the oldest claim (the track that actually triggered the
        // download); everything else pointed here through a bad fuzzy match.
        const owner = sharers.reduce((a, b) => (a.id <= b.id ? a : b));
        if (track.id !== owner.id) {
          duplicateClaims++;
          await requeue(track, 'Duplicate file claim');
          continue;
        }
      }

      if (track.file_path && fs.existsSync(track.file_path)) {
        filesVerified++;
        continue;
      }

      // File missing at stored path — look for it under this artist's folder.
      const foundFile = YTDLPService.findDownloadedFile(
        outputDir, track.artist, track.title, track
      );

      if (foundFile && !claimedPaths.has(foundFile)) {
        filesVerified++;
        console.log(`[scanner] Updated path for "${track.artist}" - "${track.title}": ${foundFile}`);
        claimedPaths.set(foundFile, [track]);
        await prisma.track.update({
          where: { id: track.id },
          data: { file_path: foundFile },
        });
      } else {
        filesNotFound++;
        await requeue(track, 'File not found');
      }
    }

    console.log(
      `[scanner] File verification: ${filesVerified} OK, ${filesNotFound} missing, ` +
      `${duplicateClaims} duplicate claims (all reset to pending)`
    );

    // Step 2: Check failed tracks - retry if under max retries
    const failedTracks = await prisma.track.findMany({
      where: { status: 'failed' },
    });

    console.log(`[scanner] Checking ${failedTracks.length} failed tracks for retry...`);

    let retriesQueued = 0;
    let retriesExhausted = 0;

    for (const track of failedTracks) {
      const retryCount = track.retry_count || 0;

      if (retryCount < maxRetries) {
        // Queue for retry
        await prisma.track.update({
          where: { id: track.id },
          data: {
            status: 'pending',
            retry_count: retryCount + 1,
          },
        });
        retriesQueued++;
        console.log(`[scanner] Queued retry ${retryCount + 1}/${maxRetries} for "${track.artist}" - "${track.title}"`);
      } else {
        // Max retries exceeded — only update error message if not already finalized
        retriesExhausted++;
        if (!(track.download_error || '').startsWith('Failed after')) {
          const finalError = `Failed after ${maxRetries} retry attempts. ${track.download_error || 'Unknown error'}`;
          await prisma.track.update({
            where: { id: track.id },
            data: { download_error: finalError },
          });
          console.log(`[scanner] Retries exhausted for "${track.artist}" - "${track.title}"`);
        }
      }
    }

    console.log(`[scanner] Retry queue: ${retriesQueued} queued, ${retriesExhausted} exhausted`);
    console.log(`[scanner] File scan completed`);

  } catch (error) {
    console.error('[scanner] File scan error:', error.message);
  }
}

/**
 * Start or restart the file scanner on its configured interval.
 * Uses a plain timer — see SyncScheduler.start() for why cron was wrong here.
 */
async function startFileScanner() {
  try {
    if (scannerTimer) {
      clearInterval(scannerTimer);
      scannerTimer = null;
    }

    const settings = await prisma.settings.findFirst();
    const intervalMinutes = Math.max(1, settings?.scan_interval ?? 10);

    scannerTimer = setInterval(() => {
      runFileScanner().catch((err) => console.error('[scanner] File scan error:', err.message));
    }, intervalMinutes * MINUTE_MS);

    console.log(`[scanner] File scanner started, every ${intervalMinutes} minutes`);
  } catch (error) {
    console.error('[scanner] Failed to start file scanner:', error.message);
  }
}

/**
 * Keep yt-dlp current.
 *
 * The binary is baked into the image at build time, so a long-running container
 * ends up months behind. YouTube then rejects its download requests outright
 * (HTTP 403 Forbidden on every track) while search still works — which looks
 * exactly like "my new songs never download".
 */
async function startYtDlpUpdater() {
  const runUpdate = async () => {
    try {
      const { updated, version, error } = await YTDLPService.updateYtDlp();
      if (updated) {
        console.log(`[yt-dlp] Up to date (${version})`);
      } else {
        console.warn(`[yt-dlp] Self-update failed (running ${version || 'unknown'}): ${error}`);
      }
    } catch (err) {
      console.warn('[yt-dlp] Self-update error:', err.message);
    }
  };

  if (ytdlpUpdateTimer) clearInterval(ytdlpUpdateTimer);
  ytdlpUpdateTimer = setInterval(runUpdate, 24 * 60 * MINUTE_MS);
  await runUpdate();
}

module.exports = SyncScheduler;
module.exports.startFileScanner = startFileScanner;
module.exports.runFileScanner = runFileScanner;
module.exports.startYtDlpUpdater = startYtDlpUpdater;
