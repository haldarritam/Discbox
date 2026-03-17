const cron = require('node-cron');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const LastFMService = require('./services/lastfm');
const YTDLPService = require('./services/ytdlp');
const DeezerService = require('./services/deezer');

const prisma = new PrismaClient();

// File scanner globals
let scannerJob = null;

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
  async start() {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 1 },
      });

      if (!settings) {
        console.log('Scheduler: No settings found, waiting for configuration');
        return;
      }

      const interval = settings.sync_interval || 360; // Default 6 hours

      // Schedule sync at specified interval
      this.scheduledTask = cron.schedule(`*/${interval} * * * *`, async () => {
        await this.sync();
      });

      console.log(`Scheduler: Started, sync every ${interval} minutes`);
      this.emitEvent({
        type: 'scheduler_started',
        interval,
        timestamp: new Date(),
      });

      // Run initial sync
      setTimeout(() => this.sync(), 5000);
    } catch (error) {
      console.error('Scheduler start error:', error);
    }
  }

  /**
   * Stop the sync scheduler
   */
  stop() {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
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
      const primaryArtist = (artist) => artist
        .toLowerCase()
        .split(/,|feat\.|ft\.|&/)[0]
        .trim();

      const dedupeMap = new Map();
      for (const track of collectedTracks) {
        const key = `${primaryArtist(track.artist)}|${track.title.toLowerCase()}`;
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
      let tracksAdded = 0;
      for (const track of deduplicatedTracks) {
        try {
          const existing = await prisma.track.findUnique({
            where: {
              artist_title: {
                artist: track.artist,
                title: track.title,
              },
            },
          });

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
   * Process a single track download
   */
  async processTrackDownload(track, settings, syncStats) {
    try {
      // Step 1: Search YouTube
      console.log(
        `Downloading: Searching YouTube for "${track.artist}" - "${track.title}"`
      );

      const result = await YTDLPService.searchYouTube(
        track.artist,
        track.title,
        settings.search_preference || 'auto'
      );

      if (!result) {
        console.warn(
          `Download: No YouTube result found for "${track.artist}" - "${track.title}"`
        );
        await prisma.track.update({
          where: { id: track.id },
          data: {
            status: 'failed',
            download_error: 'No YouTube result found',
          },
        });
        syncStats.tracksFailed++;

        this.emitEvent({
          type: 'track_failed',
          trackId: track.id,
          error: 'No YouTube result found',
          timestamp: new Date(),
        });
        return;
      }

      // Step 2: Update with YouTube metadata
      await prisma.track.update({
        where: { id: track.id },
        data: {
          youtube_url: result.url,
          youtube_video_id: result.videoId,
          status: 'downloading',
        },
      });

      this.emitEvent({
        type: 'track_downloading',
        trackId: track.id,
        timestamp: new Date(),
      });

      // Step 3: Sanitize artist and title before download
      // Replace "NA" or empty/null values with fallbacks
      const safeArtist = (track.artist && track.artist !== 'NA' && track.artist.trim())
        ? track.artist.trim()
        : 'Unknown Artist';

      const safeTitle = (track.title && track.title !== 'NA' && track.title.trim())
        ? track.title.trim()
        : 'Unknown Title';

      console.log(
        `[scheduler] Using sanitized names: ${safeArtist} - ${safeTitle}`
      );

      // Step 4: Download track
      const downloadResult = await YTDLPService.downloadTrack(
        result.url,
        safeArtist,
        safeTitle,
        {
          format: settings.audio_format || 'mp3',
          quality: settings.audio_quality || '320k',
          outputDir: settings.music_output_dir || '/music',
          track,
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
        // Tag the file with all available metadata
        if (downloadResult.filePath) {
          await YTDLPService.tagFile(downloadResult.filePath, track);
        }

        await prisma.track.update({
          where: { id: track.id },
          data: {
            status: 'downloaded',
            file_path: downloadResult.filePath,
            downloaded_at: new Date(),
          },
        });
        syncStats.tracksDownloaded++;

        console.log(
          `Download: Successfully downloaded "${track.artist}" - "${track.title}"`
        );

        this.emitEvent({
          type: 'track_downloaded',
          trackId: track.id,
          status: 'downloaded',
          filePath: downloadResult.filePath,
          download_error: null,
          timestamp: new Date(),
        });
      } else {
        // Before marking as failed, do one more file existence check
        // in case yt-dlp downloaded but reported an error
        const outputDir = settings.music_output_dir || '/music';
        const existingFile = YTDLPService.findDownloadedFile(
          outputDir,
          track.artist,
          track.title
        );
        
        if (existingFile) {
          console.log(
            `[scheduler] File found despite yt-dlp error — marking as downloaded: ${existingFile}`
          );
          await prisma.track.update({
            where: { id: track.id },
            data: {
              status: 'downloaded',
              file_path: existingFile,
              download_error: null,
              downloaded_at: new Date(),
            },
          });
          syncStats.tracksDownloaded++;

          this.emitEvent({
            type: 'track_downloaded',
            trackId: track.id,
            status: 'downloaded',
            filePath: existingFile,
            download_error: null,
            timestamp: new Date(),
          });
        } else {
          const retryCount = (track.retry_count || 0) + 1;
          const errMsg = downloadResult.error || '';

          // Detect YouTube premiere — reset to pending after the wait time
          const premiereMatch = errMsg.match(/Premieres in (\d+) hours?/i);
          if (premiereMatch) {
            const hoursUntil = parseInt(premiereMatch[1]) + 1;
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
            console.log(`[scheduler] Premiere detected for "${track.artist}" - "${track.title}", will retry in ${hoursUntil}h`);
          } else {
            await prisma.track.update({
              where: { id: track.id },
              data: {
                status: 'failed',
                download_error: errMsg,
                retry_count: retryCount,
              },
            });
            syncStats.tracksFailed++;

            console.error(
              `Download failed for "${track.artist}" - "${track.title}" (attempt ${retryCount}):`,
              errMsg
            );

            this.emitEvent({
              type: 'track_failed',
              trackId: track.id,
              error: errMsg,
              timestamp: new Date(),
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error processing track ${track.id}:`, error.message);
      const retryCount = (track.retry_count || 0) + 1;
      await prisma.track.update({
        where: { id: track.id },
        data: {
          status: 'failed',
          download_error: error.message,
          retry_count: retryCount,
        },
      });
      syncStats.tracksFailed++;

      this.emitEvent({
        type: 'track_failed',
        trackId: track.id,
        error: error.message,
        timestamp: new Date(),
      });
    }
  }
}

/**
 * File scanner - scans music output directory for already-downloaded tracks
 * Also retries failed downloads if file is missing
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

    let filesVerified = 0;
    let filesNotFound = 0;

    for (const track of downloadedTracks) {
      if (track.file_path && fs.existsSync(track.file_path)) {
        filesVerified++;
      } else {
        // File missing at stored path — try to find it at new location first
        const settings = await prisma.settings.findUnique({ where: { id: 1 } });
        const outputDir = settings?.music_output_dir || '/music';
        const foundFile = YTDLPService.findDownloadedFile(outputDir, track.artist, track.title);

        if (foundFile) {
          // Found at new location — update path, keep downloaded status
          filesVerified++;
          console.log(`[scanner] Updated path for "${track.artist}" - "${track.title}": ${foundFile}`);
          await prisma.track.update({
            where: { id: track.id },
            data: { file_path: foundFile },
          });
        } else {
          // Truly missing — reset to pending for re-download
          filesNotFound++;
          console.warn(`[scanner] File not found for "${track.artist}" - "${track.title}": ${track.file_path}`);
          await prisma.track.update({
            where: { id: track.id },
            data: {
              status: 'pending',
              download_error: null,
              retry_count: 0,
            },
          });
        }
      }
    }

    console.log(`[scanner] File verification: ${filesVerified} OK, ${filesNotFound} missing (reset to pending)`);

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
 * Start or restart the file scanner with interval from settings
 */
async function startFileScanner() {
  try {
    // Stop existing job if running
    if (scannerJob) {
      scannerJob.stop();
      scannerJob = null;
    }

    // Load interval from settings
    const settings = await prisma.settings.findFirst();
    const intervalMinutes = settings?.scan_interval ?? 10;

    console.log(`[scanner] Scheduling file scan every ${intervalMinutes} minutes`);

    // Build cron expression from interval
    // For intervals < 60 min use: */N * * * *
    // For 60 min use: 0 * * * *
    // For intervals > 60 min, convert to hours if clean, else use minutes
    const cronExpression = intervalMinutes < 60
      ? `*/${intervalMinutes} * * * *`
      : `0 */${Math.floor(intervalMinutes / 60)} * * *`;

    scannerJob = cron.schedule(cronExpression, async () => {
      try {
        await runFileScanner();
      } catch (err) {
        console.error('[scanner] File scan error:', err.message);
      }
    });

    console.log(`[scanner] File scanner started with cron: ${cronExpression}`);
  } catch (error) {
    console.error('[scanner] Failed to start file scanner:', error.message);
  }
}

module.exports = SyncScheduler;
module.exports.startFileScanner = startFileScanner;
module.exports.runFileScanner = runFileScanner;
module.exports.startFileScanner = startFileScanner;
module.exports.runFileScanner = runFileScanner;

