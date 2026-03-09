const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * GET /api/tracks
 * List all tracks with optional filtering and sorting
 * Query params:
 *   - status: filter by status (pending|requested|downloaded|ignored)
 *   - loved: filter by loved (true|false)
 *   - sort: sort field (created_at|artist|title)
 *   - order: sort order (asc|desc)
 *   - limit: max results (default: 500)
 *   - offset: pagination offset (default: 0)
 */
router.get('/', async (req, res) => {
  try {
    const { status, loved, sort = 'created_at', order = 'desc', limit = 500, offset = 0 } = req.query;

    const whereClause = {};
    if (status) whereClause.status = status;
    if (loved !== undefined) whereClause.loved = loved === 'true';

    const tracks = await prisma.track.findMany({
      where: whereClause,
      orderBy: {
        [sort]: order.toLowerCase() === 'asc' ? 'asc' : 'desc',
      },
      take: Math.min(parseInt(limit) || 500, 1000),
      skip: parseInt(offset) || 0,
    });

    const total = await prisma.track.count({ where: whereClause });

    res.json({
      data: tracks,
      total,
      limit: Math.min(parseInt(limit) || 500, 1000),
      offset: parseInt(offset) || 0,
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

module.exports = router;
