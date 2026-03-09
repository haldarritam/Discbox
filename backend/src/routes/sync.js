const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

// This will be set by the main app
let syncService = null;

function setSyncService(service) {
  syncService = service;
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

module.exports = router;
module.exports.setSyncService = setSyncService;
