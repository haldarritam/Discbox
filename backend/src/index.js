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
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// Fallback to index.html for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Initialize database and start scheduler
async function startApp() {
  try {
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

    // Start scheduler
    await scheduler.start();

    // Start server
    const PORT = process.env.PORT || 8686;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎵 LikedFM server running on http://0.0.0.0:${PORT}`);
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
