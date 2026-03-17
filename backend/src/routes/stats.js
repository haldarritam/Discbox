const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * GET /api/stats
 * Return counts of tracks by status and source
 */
router.get('/', async (req, res) => {
  try {
    const [
      totalPending,
      totalDownloading,
      totalDownloaded,
      totalFailed,
      totalIgnored,
      totalTracks,
      totalLoved,
      totalAlbum,
      totalPlaylist,
    ] = await Promise.all([
      prisma.track.count({ where: { status: 'pending' } }),
      prisma.track.count({ where: { status: 'downloading' } }),
      prisma.track.count({ where: { status: 'downloaded' } }),
      prisma.track.count({ where: { status: 'failed' } }),
      prisma.track.count({ where: { status: 'ignored' } }),
      prisma.track.count(),
      prisma.track.count({ where: { source: 'loved' } }),
      prisma.track.count({ where: { source: 'album' } }),
      prisma.track.count({ where: { source: 'playlist' } }),
    ]);

    // Per-account counts
    const accountGroups = await prisma.track.groupBy({
      by: ['account_label'],
      _count: { id: true },
      where: { account_label: { not: null } },
    });
    const byAccount = {};
    for (const g of accountGroups) {
      byAccount[g.account_label] = g._count.id;
    }

    res.json({
      status: {
        pending: totalPending,
        downloading: totalDownloading,
        downloaded: totalDownloaded,
        failed: totalFailed,
        ignored: totalIgnored,
      },
      source: {
        loved: totalLoved,
        album: totalAlbum,
        playlist: totalPlaylist,
      },
      total: totalTracks,
      byAccount,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
