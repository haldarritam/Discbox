const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * GET /api/tracks
 * List all tracks with optional filtering and sorting
 * Query params:
 *   - status: filter by status (pending|downloading|downloaded|failed|ignored)
 *   - source: filter by source (loved|album|playlist)
 *   - sort: sort field (created_at|artist|title)
 *   - order: sort order (asc|desc)
 *   - page: page number (default: 1)
 *   - limit: max results per page (default: 50)
 */
router.get('/', async (req, res) => {
  try {
    const {
      status,
      source,
      sort = 'created_at',
      order = 'desc',
      page = 1,
      limit = 50,
    } = req.query;

    const { excludeStatus, accounts } = req.query;
    const whereClause = {};
    if (status) whereClause.status = status;
    if (source) whereClause.source = source;
    if (excludeStatus && !status) whereClause.status = { not: excludeStatus };
    if (accounts) {
      const accountList = accounts.split(',').map(a => a.trim()).filter(Boolean);
      if (accountList.length > 0) whereClause.account_label = { in: accountList };
    }

    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(parseInt(limit) || 50, 500);
    const skip = (pageNum - 1) * limitNum;

    const tracks = await prisma.track.findMany({
      where: whereClause,
      orderBy: {
        [sort]: order.toLowerCase() === 'asc' ? 'asc' : 'desc',
      },
      take: limitNum,
      skip,
    });

    const total = await prisma.track.count({ where: whereClause });

    res.json({
      data: tracks,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error('Error fetching tracks:', error);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

/**
 * PATCH /api/tracks/:id/ignore
 * Mark a track as ignored
 */
router.patch('/:id/ignore', async (req, res) => {
  try {
    const { id } = req.params;

    const track = await prisma.track.update({
      where: { id: parseInt(id) },
      data: { status: 'ignored' },
    });

    res.json(track);
  } catch (error) {
    console.error('Error ignoring track:', error);
    res.status(500).json({ error: 'Failed to ignore track' });
  }
});

/**
 * PATCH /api/tracks/:id/unignore
 * Revert an ignored track to pending
 */
router.patch('/:id/unignore', async (req, res) => {
  try {
    const { id } = req.params;

    const track = await prisma.track.update({
      where: { id: parseInt(id) },
      data: { status: 'pending' },
    });

    res.json(track);
  } catch (error) {
    console.error('Error un-ignoring track:', error);
    res.status(500).json({ error: 'Failed to un-ignore track' });
  }
});


/**
 * DELETE /api/tracks
 * Delete multiple tracks by ID, optionally deleting files from disk
 */
router.delete('/', async (req, res) => {
  const fs = require('fs');
  const { ids, deleteFiles, purge } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  try {
    const tracks = await prisma.track.findMany({ where: { id: { in: ids } } });
    if (deleteFiles) {
      for (const track of tracks) {
        if (track.file_path && fs.existsSync(track.file_path)) {
          fs.unlinkSync(track.file_path);
          try {
            const albumDir = require('path').dirname(track.file_path);
            const artistDir = require('path').dirname(albumDir);
            if (fs.readdirSync(albumDir).length === 0) fs.rmdirSync(albumDir);
            if (fs.readdirSync(artistDir).length === 0) fs.rmdirSync(artistDir);
          } catch (e) {}
        }
      }
    }
    if (purge) {
      // Completely remove from DB — will re-sync next time
      await prisma.track.deleteMany({ where: { id: { in: ids } } });
      res.json({ purged: ids.length });
    } else {
      // Block tracks so they don't re-sync
      await prisma.track.updateMany({
        where: { id: { in: ids } },
        data: { status: 'blocked', file_path: null, download_error: null },
      });
      res.json({ blocked: ids.length });
    }
  } catch (error) {
    console.error('Error deleting tracks:', error);
    res.status(500).json({ error: 'Failed to delete tracks' });
  }
});

/**
 * POST /api/tracks/manual
 * Manually add a track from a YouTube URL
 */
router.post('/manual', async (req, res) => {
  const { youtube_url, title, artist, album_name } = req.body;
  if (!youtube_url || !title || !artist) {
    return res.status(400).json({ error: 'youtube_url, title, and artist are required' });
  }
  try {
    const existing = await prisma.track.findUnique({
      where: { artist_title: { artist, title } },
    });
    if (existing) {
      return res.status(409).json({ error: 'Track already exists', track: existing });
    }
    const track = await prisma.track.create({
      data: {
        artist,
        title,
        album_name: album_name || null,
        youtube_url,
        status: 'pending',
        source: 'loved',
        account_label: 'manual',
      },
    });
    res.json({ track });
  } catch (error) {
    console.error('Error adding manual track:', error);
    res.status(500).json({ error: 'Failed to add track' });
  }
});


/**
 * PATCH /api/tracks/:id/unblock
 * Unblock a track so it can be re-synced and downloaded
 */
router.patch('/:id/unblock', async (req, res) => {
  try {
    const track = await prisma.track.update({
      where: { id: parseInt(req.params.id) },
      data: { status: 'pending', download_error: null, retry_count: 0 },
    });
    res.json(track);
  } catch (error) {
    res.status(500).json({ error: 'Failed to unblock track' });
  }
});

module.exports = router;
