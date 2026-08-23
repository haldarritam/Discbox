const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// This will be set by the main app
let syncService = null;

function setSyncService(service) {
  syncService = service;
}

function getSyncService() {
  return syncService;
}

/**
 * POST /api/sync
 * Trigger a manual sync now
 */
router.post('/', async (req, res) => {
  try {
    if (!syncService) {
      return res.status(500).json({ error: 'Sync service not initialized' });
    }

    res.json({ message: 'Sync triggered', status: 'queued' });

    // Run sync in the background
    setTimeout(() => {
      syncService.sync().catch((error) => {
        console.error('Background sync error:', error);
      });
    }, 0);
  } catch (error) {
    console.error('Error triggering sync:', error);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
});

/**
 * GET /api/sync/status
 * Get the status of the last sync and next scheduled sync time
 */
router.get('/status', async (req, res) => {
  try {
    const lastSync = await prisma.syncLog.findFirst({
      orderBy: { synced_at: 'desc' },
    });

    const settings = await prisma.settings.findUnique({
      where: { id: 1 },
    });

    let nextSyncTime = null;
    if (lastSync && settings?.sync_interval) {
      nextSyncTime = new Date(
        lastSync.synced_at.getTime() + settings.sync_interval * 60 * 1000
      );
    }

    res.json({
      lastSync,
      nextSyncTime,
      syncInterval: settings?.sync_interval,
    });
  } catch (error) {
    console.error('Error getting sync status:', error);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

/**
 * POST /api/tracks/:id/download
 * Manually trigger download for a single track
 */
router.post('/tracks/:id/download', async (req, res) => {
  try {
    const trackId = parseInt(req.params.id);
    const track = await prisma.track.findUnique({
      where: { id: trackId },
    });

    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    if (track.status !== 'pending' && track.status !== 'failed') {
      return res.status(400).json({
        error: `Cannot download track with status "${track.status}"`,
      });
    }

    // Step 1: Clear error immediately in DB
    await prisma.track.update({
      where: { id: trackId },
      data: {
        status: 'pending',
        download_error: null,
      },
    });

    // Step 2: Emit SSE so ALL connected clients update instantly
    const { broadcastEvent } = require('./events');
    broadcastEvent({
      type: 'track_updated',
      trackId: trackId,
      status: 'pending',
      download_error: null,
    });

    res.json({ message: 'Download queued', trackId });

    // Step 3: Trigger download asynchronously (non-blocking)
    if (syncService) {
      setTimeout(async () => {
        try {
          const settings = await prisma.settings.findUnique({ where: { id: 1 } });
          if (settings) {
            // Pass track with sanitized artist/title
            // Scheduler will handle the sanitization in processTrackDownload
            await syncService.processTrackDownload(
              track,
              settings,
              {}
            );
          }
        } catch (error) {
          console.error(`Error downloading track ${trackId}:`, error);
        }
      }, 0);
    }
  } catch (error) {
    console.error('Error triggering track download:', error);
    res.status(500).json({ error: 'Failed to trigger download' });
  }
});

/**
 * POST /api/tracks/retry-failed
 * Queue all failed tracks for retry
 */
router.post('/retry-failed', async (req, res) => {
  try {
    // Step 1: Clear all failed tracks in DB immediately.
    // retry_count is reset too — an explicit user retry should get a full set of
    // attempts, otherwise tracks that already hit max_retries fail again at once.
    const failedIds = (await prisma.track.findMany({
      where: { status: 'failed' },
      select: { id: true },
    })).map((t) => t.id);

    const updated = await prisma.track.updateMany({
      where: { id: { in: failedIds } },
      data: {
        status: 'pending',
        download_error: null,
        retry_count: 0,
      },
    });

    // Step 2: Emit SSE for each cleared track.
    // (Was filtered to source in loved/album/playlist, which silently skipped
    // every Deezer track — deezer_loved / deezer_album / deezer_playlist.)
    const { broadcastEvent } = require('./events');
    const clearedTracks = await prisma.track.findMany({
      where: { id: { in: failedIds } },
    });

    clearedTracks.forEach((track) => {
      broadcastEvent({
        type: 'track_updated',
        trackId: track.id,
        status: 'pending',
        download_error: null,
      });
    });

    res.json({
      message: `${updated.count} failed tracks queued for retry`,
      count: updated.count,
    });

    // Step 3: Trigger sync in background
    if (syncService) {
      setTimeout(() => {
        syncService.sync().catch((error) => {
          console.error('Background sync error:', error);
        });
      }, 0);
    }
  } catch (error) {
    console.error('Error retrying failed tracks:', error);
    res.status(500).json({ error: 'Failed to retry tracks' });
  }
});

/**
 * POST /api/sync/file-scan
 * Trigger a manual file scan now
 */
router.post('/file-scan', async (req, res) => {
  try {
    if (!syncService) {
      return res.status(500).json({ error: 'Sync service not initialized' });
    }

    res.json({ message: 'File scan triggered', status: 'queued' });

    // Run file scan in the background
    const { runFileScanner } = require('../scheduler');
    setTimeout(() => {
      runFileScanner().catch((error) => {
        console.error('Background file scan error:', error);
      });
    }, 0);
  } catch (error) {
    console.error('Error triggering file scan:', error);
    res.status(500).json({ error: 'Failed to trigger file scan' });
  }
});

module.exports = router;
module.exports.setSyncService = setSyncService;
module.exports.getSyncService = getSyncService;

