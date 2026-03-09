const express = require('express');
const { PrismaClient } = require('@prisma/client');

const router = express.Router();
const prisma = new PrismaClient();

/**
 * GET /api/settings
 * Get current settings (mask sensitive keys)
 */
router.get('/', async (req, res) => {
  try {
    let settings = await prisma.settings.findUnique({
      where: { id: 1 },
    });

    // Create new settings if none exist
    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: 1 },
      });
    }

    // Mask sensitive keys
    const maskedSettings = {
      ...settings,
      lastfm_api_key: settings.lastfm_api_key ? '***' : null,
      lastfm_secret: settings.lastfm_secret ? '***' : null,
      lidarr_api_key: settings.lidarr_api_key ? '***' : null,
    };

    res.json(maskedSettings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * POST /api/settings
 * Save settings
 * Body: {
 *   lastfm_api_key?: string,
 *   lastfm_secret?: string,
 *   lastfm_username?: string,
 *   lidarr_url?: string,
 *   lidarr_api_key?: string,
 *   music_root?: string,
 *   sync_interval?: number (in minutes),
 *   min_play_count?: number,
 *   sync_loved?: boolean,
 *   sync_top?: boolean,
 *   top_period?: string
 * }
 */
router.post('/', async (req, res) => {
  try {
    const {
      lastfm_api_key,
      lastfm_secret,
      lastfm_username,
      lidarr_url,
      lidarr_api_key,
      music_root,
      sync_interval,
      min_play_count,
      sync_loved,
      sync_top,
      top_period,
    } = req.body;

    const updateData = {};

    // Only update fields that are provided (not null/undefined)
    if (lastfm_api_key !== undefined) updateData.lastfm_api_key = lastfm_api_key;
    if (lastfm_secret !== undefined) updateData.lastfm_secret = lastfm_secret;
    if (lastfm_username !== undefined) updateData.lastfm_username = lastfm_username;
    if (lidarr_url !== undefined) updateData.lidarr_url = lidarr_url;
    if (lidarr_api_key !== undefined) updateData.lidarr_api_key = lidarr_api_key;
    if (music_root !== undefined) updateData.music_root = music_root;
    if (sync_interval !== undefined) updateData.sync_interval = Math.max(1, parseInt(sync_interval));
    if (min_play_count !== undefined) updateData.min_play_count = Math.max(0, parseInt(min_play_count));
    if (sync_loved !== undefined) updateData.sync_loved = Boolean(sync_loved);
    if (sync_top !== undefined) updateData.sync_top = Boolean(sync_top);
    if (top_period !== undefined) updateData.top_period = top_period;

    let settings = await prisma.settings.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      settings = await prisma.settings.create({
        data: { id: 1, ...updateData },
      });
    } else {
      settings = await prisma.settings.update({
        where: { id: 1 },
        data: updateData,
      });
    }

    // Mask sensitive keys in response
    const maskedSettings = {
      ...settings,
      lastfm_api_key: settings.lastfm_api_key ? '***' : null,
      lastfm_secret: settings.lastfm_secret ? '***' : null,
      lidarr_api_key: settings.lidarr_api_key ? '***' : null,
    };

    res.json(maskedSettings);
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/**
 * POST /api/settings/test
 * Test Last.fm and Lidarr connections
 */
router.post('/test', async (req, res) => {
  try {
    const { testType } = req.body; // 'lastfm' or 'lidarr'

    const settings = await prisma.settings.findUnique({
      where: { id: 1 },
    });

    const results = {};

    if (testType === 'lastfm' || !testType) {
      const LastFMService = require('../services/lastfm');
      const lastfm = new LastFMService(
        settings.lastfm_api_key,
        settings.lastfm_secret,
        settings.lastfm_username
      );
      results.lastfm = await lastfm.testConnection();
    }

    if (testType === 'lidarr' || !testType) {
      const LidarrService = require('../services/lidarr');
      const lidarr = new LidarrService(settings.lidarr_url, settings.lidarr_api_key);
      results.lidarr = await lidarr.testConnection();
    }

    res.json(results);
  } catch (error) {
    console.error('Error testing connections:', error);
    res.status(500).json({ error: 'Failed to test connections' });
  }
});

module.exports = router;
