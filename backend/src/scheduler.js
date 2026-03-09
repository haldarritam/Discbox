const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const LastFMService = require('./services/lastfm');
const LidarrService = require('./services/lidarr');
const ScannerService = require('./services/scanner');

const prisma = new PrismaClient();

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
  private emitEvent(event) {
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
    this.emitEvent({
      type: 'sync_started',
      timestamp: new Date(),
    });

    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 1 },
      });

      if (!settings?.lastfm_api_key || !settings?.lidarr_api_key) {
        console.log('Sync: Settings incomplete, aborting');
        this.isRunning = false;
        return;
      }

      const lastfm = new LastFMService(
        settings.lastfm_api_key,
        settings.lastfm_secret,
        settings.lastfm_username
      );

      const lidarr = new LidarrService(
        settings.lidarr_url,
        settings.lidarr_api_key
      );

      const scanner = new ScannerService(settings.music_root);

      // Step 1: Fetch tracks from Last.fm
      let allTracks = [];

      if (settings.sync_loved) {
        console.log('Sync: Fetching loved tracks from Last.fm');
        const loved = await lastfm.getLovedTracks();
        allTracks = [...allTracks, ...loved];
      }

      if (settings.sync_top) {
        console.log(
          `Sync: Fetching top tracks from Last.fm (period: ${settings.top_period})`
        );
        const top = await lastfm.getTopTracks(settings.top_period);
        allTracks = [...allTracks, ...top];
      }

      // Step 2: Deduplicate tracks
      const uniqueMap = new Map();
      for (const track of allTracks) {
        const key = `${track.artist}|${track.title}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, track);
        }
      }

      const uniqueTracks = Array.from(uniqueMap.values());
      console.log(
        `Sync: Found ${uniqueTracks.length} unique tracks from Last.fm`
      );

      // Step 3: Insert new tracks into database
      let tracksAdded = 0;
      for (const track of uniqueTracks) {
        try {
          await prisma.track.upsert({
            where: {
              artist_title: {
                artist: track.artist,
                title: track.title,
              },
            },
            update: {
              play_count: track.play_count,
              loved: track.loved,
            },
            create: {
              ...track,
            },
          });
          tracksAdded++;
        } catch (error) {
          console.error(`Failed to upsert track ${track.artist} - ${track.title}:`, error);
        }
      }

      console.log(`Sync: Added/updated ${tracksAdded} tracks`);

      // Step 4: Request pending tracks
      const pendingTracks = await prisma.track.findMany({
        where: {
          status: 'pending',
          play_count: { gte: settings.min_play_count },
        },
        take: 50, // Limit requests per sync to avoid overwhelming Lidarr
      });

      console.log(`Sync: Processing ${pendingTracks.length} pending tracks`);

      for (const track of pendingTracks) {
        try {
          const lidarrResult = await lidarr.requestTrack(
            { artist: track.artist, title: track.title },
            settings.music_root
          );

          await prisma.track.update({
            where: { id: track.id },
            data: {
              status: 'requested',
              requested_at: new Date(),
              lidarr_artist_id: lidarrResult.lidarr_artist_id,
              lidarr_album_id: lidarrResult.lidarr_album_id,
              lidarr_track_id: lidarrResult.lidarr_track_id,
            },
          });

          this.emitEvent({
            type: 'track_requested',
            track: { artist: track.artist, title: track.title },
            timestamp: new Date(),
          });
        } catch (error) {
          console.error(
            `Failed to request track ${track.artist} - ${track.title}:`,
            error.message
          );
        }
      }

      // Step 5: Check for downloaded tracks
      const requestedTracks = await prisma.track.findMany({
        where: { status: 'requested' },
      });

      console.log(`Sync: Checking ${requestedTracks.length} requested tracks for completion`);

      for (const track of requestedTracks) {
        try {
          const file = await scanner.findTrackFile(track);
          if (file) {
            await prisma.track.update({
              where: { id: track.id },
              data: {
                status: 'downloaded',
                downloaded_at: new Date(),
              },
            });

            this.emitEvent({
              type: 'track_downloaded',
              track: { artist: track.artist, title: track.title },
              timestamp: new Date(),
            });
          }
        } catch (error) {
          console.error(`Failed to check download for track ${track.id}:`, error.message);
        }
      }

      // Step 6: Log the sync
      const source = settings.sync_loved && settings.sync_top
        ? 'both'
        : settings.sync_loved
        ? 'loved'
        : 'top';

      await prisma.syncLog.create({
        data: {
          tracks_found: uniqueTracks.length,
          tracks_added: tracksAdded,
          source,
        },
      });

      console.log('Sync completed successfully');
      this.emitEvent({
        type: 'sync_completed',
        summary: {
          tracksFound: uniqueTracks.length,
          tracksAdded: tracksAdded,
          trackRequested: pendingTracks.length,
        },
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
}

module.exports = SyncScheduler;
