const express = require('express');
const { PrismaClient } = require('@prisma/client');
const LastFMService = require('../services/lastfm');
const YTDLPService = require('../services/ytdlp');
const { startFileScanner } = require('../scheduler');

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
 */
router.post('/', async (req, res) => {
  try {
    const {
      lastfm_api_key,
      lastfm_secret,
      lastfm_username,
      music_output_dir,
      audio_format,
      audio_quality,
      max_concurrent_downloads,
      search_preference,
      sync_interval,
      sync_loved,
      sync_albums,
      sync_playlists,
      scan_interval,
      max_retries,
    } = req.body;

    const updateData = {};

    // Last.fm settings
    if (lastfm_api_key !== undefined)
      updateData.lastfm_api_key = lastfm_api_key;
    if (lastfm_secret !== undefined)
      updateData.lastfm_secret = lastfm_secret;
    if (lastfm_username !== undefined)
      updateData.lastfm_username = lastfm_username;

    // Download settings
    if (music_output_dir !== undefined)
      updateData.music_output_dir = music_output_dir;
    if (audio_format !== undefined)
      updateData.audio_format = audio_format;
    if (audio_quality !== undefined)
      updateData.audio_quality = audio_quality;
    if (max_concurrent_downloads !== undefined)
      updateData.max_concurrent_downloads = Math.max(
        1,
        parseInt(max_concurrent_downloads)
      );
    if (search_preference !== undefined)
      updateData.search_preference = search_preference;

    // Sync settings
    if (sync_interval !== undefined)
      updateData.sync_interval = Math.max(1, parseInt(sync_interval));
    if (sync_loved !== undefined)
      updateData.sync_loved = Boolean(sync_loved);
    if (sync_albums !== undefined)
      updateData.sync_albums = Boolean(sync_albums);
    if (sync_playlists !== undefined)
      updateData.sync_playlists = Boolean(sync_playlists);

    // File scanner settings
    if (scan_interval !== undefined)
      updateData.scan_interval = Math.max(1, parseInt(scan_interval) || 10);
    if (max_retries !== undefined)
      updateData.max_retries = Math.max(0, parseInt(max_retries) || 3);

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

    // Restart both timers so a changed interval takes effect immediately.
    // Previously only the file scanner was restarted, so editing sync_interval
    // did nothing until the container was restarted.
    await startFileScanner();
    const syncService = require('./sync').getSyncService();
    if (syncService) {
      syncService.stop();
      await syncService.start({ runInitialSync: false });
    }

    // Mask sensitive keys in response
    const maskedSettings = {
      ...settings,
      lastfm_api_key: settings.lastfm_api_key ? '***' : null,
      lastfm_secret: settings.lastfm_secret ? '***' : null,
    };

    res.json(maskedSettings);
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/**
 * POST /api/settings/test-lastfm
 * Test Last.fm connection
 */
router.post('/test-lastfm', async (req, res) => {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 1 },
    });

    if (!settings?.lastfm_api_key || !settings?.lastfm_secret || !settings?.lastfm_username) {
      return res.json({
        success: false,
        error: 'Last.fm credentials not configured',
      });
    }

    const lastfm = new LastFMService(
      settings.lastfm_api_key,
      settings.lastfm_secret,
      settings.lastfm_username
    );

    const result = await lastfm.testConnection();
    res.json(result);
  } catch (error) {
    console.error('Error testing Last.fm:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/settings/test-ytdlp
 * Test yt-dlp binary and return version
 */
router.post('/test-ytdlp', async (req, res) => {
  try {
    const version = await YTDLPService.checkYtDlp();
    res.json({ success: true, version });
  } catch (error) {
    console.error('Error testing yt-dlp:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
