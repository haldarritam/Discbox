const axios = require('axios');

const BASE_URL = 'https://api.deezer.com';

class DeezerService {
  constructor(userId) {
    this.userId = userId;
  }

  async fetchPaginated(url) {
    const results = [];
    let index = 0;
    const limit = 50;

    while (true) {
      const response = await axios.get(url, {
        params: { index, limit },
        timeout: 10000,
      });

      const data = response.data;

      if (data.error) {
        throw new Error(`Deezer API error: ${data.error.message} (code ${data.error.code})`);
      }

      const items = data.data || [];
      results.push(...items);

      if (!data.next || items.length < limit) break;
      index += limit;
    }

    return results;
  }

  normalizeTrack(track, extra = {}) {
    const artist = track.artist?.name || '';

    // All contributors as comma-separated string
    const contributors = track.contributors
      ? track.contributors.map(c => c.name).join(', ')
      : artist;

    // Use cover_big for best quality, fall back to cover_medium
    const albumArt = track.album?.cover_big
      || track.album?.cover_medium
      || null;

    return {
      artist,
      title: track.title || '',
      album_name: track.album?.title || null,
      album_art_url: albumArt,
      isrc: track.isrc || null,
      release_date: track.release_date || track.album?.release_date || null,
      track_position: track.track_position || null,
      disk_number: track.disk_number || null,
      bpm: track.bpm || null,
      duration: track.duration || null,
      explicit_lyrics: track.explicit_lyrics || false,
      deezer_id: track.id ? String(track.id) : null,
      contributors: contributors || null,
      ...extra,
    };
  }

  async getLovedTracks() {
    const items = await this.fetchPaginated(`${BASE_URL}/user/${this.userId}/tracks`);
    return items.map((t) => this.normalizeTrack(t, { source: 'deezer_loved' }));
  }

  async getSavedAlbums() {
    const albums = await this.fetchPaginated(`${BASE_URL}/user/${this.userId}/albums`);
    const tracks = [];

    for (const album of albums) {
      try {
        const response = await axios.get(`${BASE_URL}/album/${album.id}/tracks`, { timeout: 10000 });
        const albumTracks = response.data?.data || [];
        for (const track of albumTracks) {
          tracks.push(this.normalizeTrack(
            {
              ...track,
              album: {
                title: album.title,
                cover_big: album.cover_big,
                cover_medium: album.cover_medium,
                release_date: album.release_date,
              }
            },
            { source: 'deezer_album' }
          ));
        }
      } catch (err) {
        console.warn(`[deezer] Failed to fetch tracks for album ${album.title}:`, err.message);
      }
    }

    return tracks;
  }

  async getPlaylistTracks() {
    const playlists = await this.fetchPaginated(`${BASE_URL}/user/${this.userId}/playlists`);
    const tracks = [];

    for (const playlist of playlists) {
      if (playlist.title === 'Loved Tracks') continue;
      try {
        const items = await this.fetchPaginated(`${BASE_URL}/playlist/${playlist.id}/tracks`);
        for (const track of items) {
          tracks.push(this.normalizeTrack(track, { source: 'deezer_playlist', playlist_name: playlist.title }));
        }
      } catch (err) {
        console.warn(`[deezer] Failed to fetch tracks for playlist ${playlist.title}:`, err.message);
      }
    }

    return tracks;
  }

  async testConnection() {
    const response = await axios.get(`${BASE_URL}/user/${this.userId}`, { timeout: 10000 });
    if (response.data.error) {
      throw new Error(response.data.error.message);
    }
    return {
      name: response.data.name,
      id: response.data.id,
    };
  }
}

module.exports = DeezerService;
