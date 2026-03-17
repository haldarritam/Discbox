# 🎵 LikedFM

LikedFM is a self-hosted music automation app that syncs your loved tracks, saved albums, and playlists from **Deezer** (and optionally **Last.fm**) and automatically downloads them from YouTube via yt-dlp. It organizes your music library in a Navidrome-compatible folder structure and keeps everything in sync automatically.

---

## How It Works

1. LikedFM connects to your Deezer account(s) using your public profile ID
2. It fetches your loved tracks, saved albums, and playlists
3. Each track is searched on YouTube and downloaded as high-quality audio
4. Files are saved to your music library as `Artist / Album / TrackNum - Title.mp3`
5. Metadata (artist, album, BPM, ISRC, album art, etc.) is embedded using mutagen
6. Navidrome picks up the new files and makes them available in your music player

---

## Stack

- **Backend**: Node.js + Express + Prisma + SQLite
- **Frontend**: React + Vite + Tailwind CSS
- **Downloader**: yt-dlp + ffmpeg
- **Tagger**: Python + mutagen
- **Database**: SQLite (persisted in `/config` volume)
- **Port**: 8767

---

## Quick Start
```bash
git clone https://github.com/haldarritam/LikedFM.git
cd likedfm
docker-compose up -d --build
```

Open `http://localhost:8767` and go to Settings to configure.

---

## Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./config` | `/app/config` | Database and settings |
| `/your/music/path` | `/music` | Downloaded music library |

---

## Settings

All settings are configured via the web UI at `/settings` (gear icon, bottom right).

| Setting | Description |
|---------|-------------|
| Sync Interval | How often to check for new tracks (minutes) |
| Audio Format | mp3, flac, opus, m4a |
| Audio Quality | Up to 320kbps |
| Max Concurrent Downloads | Parallel downloads (1-5) |
| Last.fm API Key | Optional — for Last.fm loved track sync |

---

## Deezer Setup

Your Deezer profile must be **public**. To find your user ID:
1. Go to your Deezer profile page
2. The URL will be `deezer.com/profile/XXXXXXXXX` — that number is your ID

Add accounts via Settings → Deezer Accounts. Multiple accounts are supported.

---

## Dashboard

- **Stats bar** — Total, Pending, Downloaded, Failed counts + per-user track counts
- **User filter** — Click a user button to show only their tracks (multi-select supported)
- **Status filter** — Filter by Pending, Downloading, Downloaded, Failed, Ignored, Blocked
- **Source filter** — Filter by Loved, Albums, Playlists
- **Search** — Search by artist, title, or album
- **Select tracks** — Checkbox on each track, Select All button
- **Delete options** (after selecting tracks):
  - 🚫 **Block** — Hides track, prevents re-syncing (stays in DB)
  - 🚫 **Block + Delete File** — Same as above but also deletes the audio file
  - 🗑 **Remove Completely** — Deletes from DB and disk (will re-sync next time)
- **➕ Add Track** — Manually add a YouTube URL with metadata
- **🔄 Sync Now** — Trigger an immediate sync
- **📁 Scan Files** — Re-scan disk and update DB file paths

---

## Track States

| Status | Meaning |
|--------|---------|
| `pending` | Queued for download |
| `downloading` | Currently downloading |
| `downloaded` | Successfully downloaded |
| `failed` | Download failed (retries exhausted) |
| `ignored` | Manually hidden, can be restored |
| `blocked` | Permanently excluded from sync |

---

## File Structure
```
/music/
  Artist/
    Album/
      01 - Track Title.mp3
      02 - Another Track.mp3
    Single Title.mp3   ← fallback if no album
```

---

## Docker Commands
```bash
# Start / rebuild
cd /mnt/user/data/LikedFM
docker-compose up --build -d

# View logs
docker logs likedfm --tail 50
docker logs likedfm -f | grep -i "error\|tagger\|deezer"

# Push schema changes after editing prisma/schema.prisma
docker exec likedfm npx prisma db push --schema /app/prisma/schema.prisma

# Reset all tracks to pending (re-download everything)
docker exec likedfm node -e "
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
p.track.updateMany({ data: { status: 'pending', file_path: null, download_error: null, retry_count: 0 } })
.then(r => { console.log('Reset', r.count); process.exit(0) })
"

# Delete all tracks (fresh start)
docker exec likedfm node -e "
const { PrismaClient } = require('@prisma/client')
const p = new PrismaClient()
p.track.deleteMany().then(r => { console.log('Deleted', r.count); process.exit(0) })
"
```

---

## Utility Scripts

Located in `scripts/`. To run any script:
```bash
docker cp scripts/<script>.js likedfm:/app/<script>.js
docker exec likedfm node /app/<script>.js
```

### `cleanup-orphaned-files.js`
Finds and deletes audio files on disk that have no matching record in the database. Also removes empty artist/album directories. Run this after bulk-deleting tracks from the UI.

### `find-missing-files.js`
Finds tracks in the database marked as `downloaded` whose file no longer exists on disk. Useful for diagnosing sync issues between DB and disk.

---

## Navidrome Integration

LikedFM saves files in a format Navidrome understands natively:
- `Artist / Album / TrackNum - Title.mp3`
- Full metadata embedded (title, artist, album, track number, year, BPM, album art)

After a sync, trigger a **Full Rescan** in Navidrome to pick up new tracks.

---

## Troubleshooting

**Sync not running**
Check logs: `docker logs likedfm | grep -i "scheduler\|sync every"`
The sync interval is only picked up on container start — restart after changing it.

**Track keeps failing**
After 3 failed attempts a track is marked permanently failed. Use the Retry button or filter to Failed and use Retry All.

**Files not showing in Navidrome**
Trigger a Full Rescan in Navidrome. Check that the music volume is mounted correctly.

**Deezer returning "no data" (error 800)**
The Deezer profile is private. Make your profile public at deezer.com/account.

---

## License

MIT
