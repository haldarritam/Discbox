const express = require('express');

const router = express.Router();

// This will be set by the main app
let eventClients = [];

function addClient(res) {
  eventClients.push(res);
}

function removeClient(res) {
  eventClients = eventClients.filter((client) => client !== res);
}

function broadcastEvent(event) {
  eventClients.forEach((client) => {
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  });
}

/**
 * GET /api/events
 * Server-Sent Events endpoint for live status updates
 */
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  addClient(res);

  req.on('close', () => {
    removeClient(res);
    res.end();
  });
});

module.exports = router;
module.exports.broadcastEvent = broadcastEvent;
module.exports.addClient = addClient;
module.exports.removeClient = removeClient;
