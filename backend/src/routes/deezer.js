const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const DeezerService = require('../services/deezer');

const prisma = new PrismaClient();

// GET /api/deezer/accounts - list all accounts
router.get('/accounts', async (req, res) => {
  try {
    const accounts = await prisma.deezerAccount.findMany({
      orderBy: { created_at: 'asc' },
    });
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deezer/accounts - add account
router.post('/accounts', async (req, res) => {
  try {
    const { user_id, label, sync_loved, sync_albums, sync_playlists } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    const account = await prisma.deezerAccount.create({
      data: {
        user_id: String(user_id),
        label: label || null,
        sync_loved: sync_loved !== undefined ? sync_loved : true,
        sync_albums: sync_albums !== undefined ? sync_albums : true,
        sync_playlists: sync_playlists !== undefined ? sync_playlists : true,
      },
    });
    res.json(account);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'This Deezer user ID is already added' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/deezer/accounts/:id - update account
router.put('/accounts/:id', async (req, res) => {
  try {
    const { label, sync_loved, sync_albums, sync_playlists } = req.body;
    const account = await prisma.deezerAccount.update({
      where: { id: parseInt(req.params.id) },
      data: { label, sync_loved, sync_albums, sync_playlists },
    });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/deezer/accounts/:id - remove account
router.delete('/accounts/:id', async (req, res) => {
  try {
    await prisma.deezerAccount.delete({
      where: { id: parseInt(req.params.id) },
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deezer/test/:userId - test connection
router.get('/test/:userId', async (req, res) => {
  try {
    const deezer = new DeezerService(req.params.userId);
    const user = await deezer.testConnection();
    res.json({ success: true, name: user.name, id: user.id });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;
