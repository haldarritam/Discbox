const express = require('express');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const SyncScheduler = require('./scheduler');

const prisma = new PrismaClient();
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize sync scheduler
const scheduler = new SyncScheduler();

// Import routes
const tracksRouter = require('./routes/tracks');
const syncRouter = require('./routes/sync');
const settingsRouter = require('./routes/settings');
const statsRouter = require('./routes/stats');
const eventsRouter = require('./routes/events');
const bookmarksRouter = require('./routes/bookmarks');
const deezerRouter = require('./routes/deezer');
const { startFileScanner, startYtDlpUpdater } = require('./scheduler');

// Set sync service for the sync route
const { setSyncService } = require('./routes/sync');
setSyncService(scheduler);

// Set event broadcaster for scheduler
const { broadcastEvent } = require('./routes/events');
scheduler.setEventBroadcaster(broadcastEvent);

// API Routes
app.use('/api/tracks', tracksRouter);
app.use('/api/sync', syncRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/bookmarks', bookmarksRouter);
app.use('/api/deezer', deezerRouter);

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    version: process.env.VERSION || '1.0.0',
  });
});

// Serve React frontend as static files
const frontendPath = '/app/frontend/dist';
app.use(express.static(frontendPath));

// Fallback to index.html for React Router
// Info endpoint - returns server IP
app.get('/api/info', (req, res) => {
  const os = require('os')
  const interfaces = os.networkInterfaces()
  const ips = []
  for (const iface of Object.values(interfaces)) {
    for (const alias of iface) {
      if (alias.family === 'IPv4' && alias.internal === false) {
        ips.push(alias.address)
      }
    }
  }
  res.json({ ip: ips[0] || 'unknown', port: process.env.PORT || 8767 })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Initialize database and start scheduler
async function startApp() {
  try {
    // Run Prisma migrations
    console.log('Running Prisma migrations...');
    const { execSync } = require('child_process');
    try {
      execSync('npx prisma db push --skip-generate', { stdio: 'inherit' });
      console.log('Prisma migrations completed');
    } catch (error) {
      console.log('Prisma migration already up to date or no changes needed');
    }

    // Create default settings if they don't exist
    const existingSettings = await prisma.settings.findUnique({
      where: { id: 1 },
    });

    if (!existingSettings) {
      await prisma.settings.create({
        data: { id: 1 },
      });
      console.log('Created default settings');
    }

    // Make sure yt-dlp is current before the first sync — a stale binary makes
    // YouTube return HTTP 403 for every download while search still succeeds.
    await startYtDlpUpdater();

    // Start scheduler
    await scheduler.start();

    // Start file scanner
    await startFileScanner();

    // Start server
    const PORT = process.env.PORT || 8767;
    
app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎵 Discbox server running on http://0.0.0.0:${PORT}`);
      console.log('📊 Dashboard: http://localhost:' + PORT);
      console.log('⚙️  Settings: http://localhost:' + PORT + '/settings');
    });
  } catch (error) {
    console.error('Failed to start app:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  scheduler.stop();
  await prisma.$disconnect();
  process.exit(0);
});

startApp();

module.exports = app;
