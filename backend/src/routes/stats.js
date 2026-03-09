const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * GET /api/stats
 * Return counts of tracks by status
 */
router.get('/', async (req, res) => {
  try {
    const [
      totalPending,
      totalRequested,
      totalDownloaded,
      totalIgnored,
      totalTracks,
      totalLoved,
    ] = await Promise.all([
      prisma.track.count({ where: { status: 'pending' } }),
      prisma.track.count({ where: { status: 'requested' } }),
      prisma.track.count({ where: { status: 'downloaded' } }),
      prisma.track.count({ where: { status: 'ignored' } }),
      prisma.track.count(),
      prisma.track.count({ where: { loved: true } }),
    ]);

    res.json({
      pending: totalPending,
      requested: totalRequested,
      downloaded: totalDownloaded,
      ignored: totalIgnored,
      total: totalTracks,
      loved: totalLoved,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
