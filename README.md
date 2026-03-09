# 🎵 LikedFM - Music Taste Sync for Last.fm + Lidarr

LikedFM is a self-hosted music automation bridge that syncs your **loved** and **top tracks** from **Last.fm** and automatically requests individual song downloads through **Lidarr**. Think of it as **Jellyseerr for music**.

## Features

✅ **Last.fm Integration**
- Sync loved tracks from your Last.fm profile
- Sync top tracks (7-day, 1-month, 3-month, 6-month, 12-month, or all-time)
- Configurable minimum play count threshold
- Automatic deduplication

✅ **Lidarr Integration**
- Automatic artist discovery and addition
- Smart track/album search and request
- Download completion detection via file system polling
- Lidarr queue/history tracking

✅ **Web Dashboard**
- Real-time track status tracking (Pending → Requested → Downloaded)
- Live activity log with SSE updates
- Statistics dashboard (total synced, downloaded, pending, ignored)
- Manual sync trigger
- Per-track ignore/un-ignore controls
- Album art thumbnails from Last.fm

✅ **Settings UI**
- Fully configurable via web interface
- Test Last.fm & Lidarr connections
- Adjust sync intervals and play count thresholds
- No need to edit config files

✅ **Docker-Ready**
- Multi-stage build (optimized image size)
- Unraid Community Applications template included
- Health check endpoint
- Non-root user for security
- Volume mounts for persistence and music library access

## Architecture

- **Backend**: Node.js + Express + Prisma + SQLite
- **Frontend**: React 18 + Vite + React Router + Tailwind CSS
- **Scheduler**: node-cron for automated sync intervals
- **Database**: SQLite (persisted in `/config` volume)

## Quick Start

### Using Docker Compose

1. Clone the repository:
```bash
git clone https://github.com/yourusername/likedfm.git
cd likedfm
```

2. Build the Docker image:
```bash
docker-compose build
```

3. Start the container:
```bash
docker-compose up -d
```

4. Access the web UI:
```
http://localhost:8686
```

5. Configure Last.fm and Lidarr credentials in the Settings page.

6. Click "Sync Now" to start!

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8686` | Web UI port |
| `DATABASE_URL` | `file:/app/config/likedfm.db` | SQLite database path |
| `NODE_ENV` | `production` | Node environment |
| `LASTFM_API_KEY` | - | Last.fm API Key (can be set via UI) |
| `LASTFM_SECRET` | - | Last.fm API Secret (can be set via UI) |
| `LASTFM_USERNAME` | - | Last.fm Username (can be set via UI) |
| `LIDARR_URL` | - | Lidarr Base URL (can be set via UI) |
| `LIDARR_API_KEY` | - | Lidarr API Key (can be set via UI) |
| `MUSIC_ROOT` | `/music` | Container path to music library |
| `MUSIC_PATH` | `/mnt/user/music` | Host path to music library (for docker-compose) |
| `SYNC_INTERVAL` | `360` | Sync interval in minutes |

## Getting API Keys

### Last.fm API

1. Visit https://www.last.fm/api
2. Click "Create an API account"
3. Fill in the form and accept terms
4. You'll get your **API Key** and **Shared Secret**
5. You'll need your **Last.fm username** (not email)

### Lidarr API Key

1. Open your Lidarr web UI
2. Go to **Settings** → **General**
3. Scroll to the bottom to find your **API Key**
4. Your **Base URL** is typically `http://lidarr:8686` or `http://192.168.x.x:8686`

## Volume Mounts (Docker)

### Required Mounts

- **`./config:/app/config`** - SQLite database and persistent settings
- **`/mnt/user/music:/music` (read-only)** - Music library for download detection

### Example docker-compose.yml

```yaml
version: '3.8'

services:
  likedfm:
    image: likedfm:latest
    container_name: likedfm
    restart: unless-stopped
    ports:
      - "8686:8686"
    volumes:
      - ./config:/app/config
      - /mnt/user/music:/music:ro  # Adjust path to your Unraid music share
    environment:
      SYNC_INTERVAL: 360
      MUSIC_ROOT: /music
```

## Installation on Unraid

### Via Community Applications

1. Open **Community Applications** → **Apps**
2. Search for "**LikedFM**"
3. Click **Install**
4. Configure environment variables and volume paths
5. Click **Apply**

### Manual Installation

1. Download the `unraid-template.xml` file
2. In Unraid, go to **Docker** → **Add Container**
3. Click "**Select a template**"
4. Click "**Upload template**"
5. Select the XML file
6. Configure settings and click **Apply**

## API Endpoints

### Tracks
- `GET /api/tracks` - List all tracks with filters
- `PATCH /api/tracks/:id/ignore` - Mark track as ignored
- `PATCH /api/tracks/:id/unignore` - Revert ignored track

### Sync
- `POST /api/sync` - Trigger manual sync now
- `GET /api/sync/status` - Get last sync time and next scheduled time

### Settings
- `GET /api/settings` - Get current settings (masked)
- `POST /api/settings` - Save settings
- `POST /api/settings/test` - Test Last.fm & Lidarr connections

### Stats
- `GET /api/stats` - Get track counts by status

### Events
- `GET /api/events` - Server-Sent Events stream for live updates

### Health
- `GET /health` - Health check endpoint

## Database Schema

### Tracks Table
```
id              Int (PK)
artist          String
title           String
lastfm_url      String
album_art_url   String
play_count      Int
loved            Boolean
status          String (pending|requested|downloaded|ignored)
lidarr_artist_id Int
lidarr_album_id Int
lidarr_track_id Int
requested_at    DateTime
downloaded_at   DateTime
created_at      DateTime
updated_at      DateTime
```

### Sync Log Table
```
id              Int (PK)
synced_at       DateTime
tracks_found    Int
tracks_added    Int
source          String (loved|top|both)
```

### Settings Table
```
id               Int (PK)
lastfm_api_key   String
lastfm_secret    String
lastfm_username  String
lidarr_url       String
lidarr_api_key   String
music_root       String
sync_interval    Int (minutes)
min_play_count   Int
sync_loved       Boolean
sync_top         Boolean
top_period       String
```

## Sync Flow

1. **Fetch Last.fm tracks** - Pull loved/top tracks based on settings
2. **Deduplicate** - Remove duplicates and store in database
3. **Request to Lidarr** - For each pending track:
   - Search for artist in Lidarr
   - Add artist if not present (monitored=false)
   - Search for specific track/album
   - Request the album/track
4. **Detect Downloads** - Scan music library and Lidarr history for completions
5. **Update Status** - Mark tracks as "downloaded" when file appears
6. **Broadcast Events** - Send SSE updates to connected clients

## Troubleshooting

### Sync not running
- Check Settings page to ensure all fields are filled
- Click "Test Connections" to verify Last.fm & Lidarr connectivity
- Check application logs: `docker logs likedfm`

### Tracks not appearing in Lidarr
- Verify Lidarr URL and API key are correct
- Ensure the artist exists in Last.fm
- Check if Lidarr already has the artist added (monitored=false)

### Downloads not detected
- Verify music library path is correct
- Ensure music library volume is mounted to `/music` in container
- Check file permissions
- Manually scan Lidarr to refresh library

### Database locked
- Stop the container: `docker-compose down`
- Remove database: `rm config/likedfm.db`
- Restart container: `docker-compose up -d`

## Development

### Prerequisites
- Node.js 18+
- Docker & Docker Compose

### Running Locally

**Backend:**
```bash
cd backend
npm install
npx prisma db push
npm run dev
```

**Frontend (separate terminal):**
```bash
cd frontend
npm install
npm run dev
```

The frontend dev server will proxy API calls to `http://localhost:8686`.

### Building Docker Image
```bash
docker-compose build
docker-compose up
```

## Project Structure

```
likedfm/
├── backend/
│   ├── prisma/
│   │   └── schema.prisma
│   ├── src/
│   │   ├── index.js (Express app)
│   │   ├── scheduler.js (cron sync)
│   │   ├── services/
│   │   │   ├── lastfm.js
│   │   │   ├── lidarr.js
│   │   │   └── scanner.js
│   │   └── routes/
│   │       ├── tracks.js
│   │       ├── sync.js
│   │       ├── settings.js
│   │       ├── stats.js
│   │       └── events.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx
│   │   │   └── Settings.jsx
│   │   ├── components/
│   │   │   ├── TrackCard.jsx
│   │   │   ├── StatusBadge.jsx
│   │   │   ├── SyncStats.jsx
│   │   │   ├── ActivityLog.jsx
│   │   │   └── SettingsForm.jsx
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── index.css
│   ├── package.json
│   ├── vite.config.js
│   └── index.html
├── Dockerfile
├── docker-compose.yml
├── unraid-template.xml
└── README.md
```

## License

MIT

## Support

- **GitHub Issues**: https://github.com/yourusername/likedfm/issues
- **Discussions**: https://github.com/yourusername/likedfm/discussions

## Roadmap

- [ ] Spotify integration
- [ ] Track download notifications
- [ ] Advanced filtering (genre, decade, etc.)
- [ ] Batch operations (ignore all pending, etc.)
- [ ] Export/import settings
- [ ] Multi-user support
- [ ] Dark/light mode toggle

---

Made with ❤️ for music lovers and automation enthusiasts
