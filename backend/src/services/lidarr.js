const axios = require('axios');

class LidarrService {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Search for an artist in Lidarr
   * @param {string} artistName
   * @returns {Array} Array of artist match objects
   */
  async searchArtist(artistName) {
    try {
      const response = await this.client.get('/api/v1/artist/lookup', {
        params: { term: artistName },
      });
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error(`Error searching artist "${artistName}":`, error.message);
      throw error;
    }
  }

  /**
   * Add an artist to Lidarr
   * @param {Object} artist - Artist object from lookup
   * @param {string} rootFolderPath - Root folder path for the artist
   * @param {boolean} monitored - Whether to monitor the entire artist
   * @returns {Object} Created artist object with lidarr_artist_id
   */
  async addArtist(artist, rootFolderPath, monitored = false) {
    try {
      const payload = {
        ...artist,
        rootFolderPath,
        monitored,
        addOptions: {
          searchForMissingAlbums: false,
        },
      };

      const response = await this.client.post('/api/v1/artist', payload);
      return {
        lidarr_artist_id: response.data.id,
        ...response.data,
      };
    } catch (error) {
      console.error(`Error adding artist:`, error.message);
      throw error;
    }
  }

  /**
   * Get artist by ID
   * @param {number} artistId
   * @returns {Object} Artist object or null
   */
  async getArtist(artistId) {
    try {
      const response = await this.client.get(`/api/v1/artist/${artistId}`);
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) return null;
      console.error(`Error getting artist ${artistId}:`, error.message);
      throw error;
    }
  }

  /**
   * Search for a track in Lidarr
   * @param {string} trackTitle
   * @param {string} artistName
   * @returns {Array} Array of track/album match objects
   */
  async searchTrack(trackTitle, artistName) {
    try {
      const response = await this.client.get('/api/v1/search', {
        params: { term: `${artistName} ${trackTitle}` },
      });
      return response.data || [];
    } catch (error) {
      console.error(`Error searching track "${trackTitle}":`, error.message);
      throw error;
    }
  }

  /**
   * Get all tracks for an album
   * @param {number} albumId
   * @returns {Array} Array of track objects
   */
  async getAlbumTracks(albumId) {
    try {
      const response = await this.client.get(`/api/v1/album/${albumId}/tracks`);
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error(`Error getting album tracks for ${albumId}:`, error.message);
      throw error;
    }
  }

  /**
   * Search for and request a specific track
   * Tries to find the track, then requests the album/single it's on
   * @param {Object} trackData - { artist, title }
   * @param {string} rootFolderPath
   * @returns {Object} Request result with lidarr IDs or error
   */
  async requestTrack(trackData, rootFolderPath) {
    try {
      // Step 1: Search for the artist
      const artists = await this.searchArtist(trackData.artist);
      if (!artists.length) {
        throw new Error(`Artist "${trackData.artist}" not found in Lidarr`);
      }

      const artistMatch = artists[0];
      let artistId = artistMatch.id;

      // Step 2: Add artist if not in Lidarr
      let addedArtist = null;
      try {
        const existingArtist = await this.getArtist(artistId);
        if (!existingArtist) {
          addedArtist = await this.addArtist(artistMatch, rootFolderPath, false);
          artistId = addedArtist.lidarr_artist_id;
        }
      } catch (e) {
        // Artist might not exist yet, try to add
        addedArtist = await this.addArtist(artistMatch, rootFolderPath, false);
        artistId = addedArtist.lidarr_artist_id;
      }

      // Step 3: Search for the track/album
      const searchResults = await this.searchTrack(trackData.title, trackData.artist);
      if (!searchResults.length) {
        throw new Error(
          `Track "${trackData.title}" by "${trackData.artist}" not found in Lidarr`
        );
      }

      // Step 4: Find matching album and track
      const result = searchResults[0];
      let albumId = result.id;
      let trackId = null;

      if (result.type === 'track') {
        trackId = result.id;
        // Get the album from the track
        const tracks = await this.getAlbumTracks(result.albumId);
        albumId = result.albumId;
      } else if (result.type === 'album') {
        // Get tracks from the album and find matching track
        const tracks = await this.getAlbumTracks(albumId);
        const matchingTrack = tracks.find(
          (t) =>
            t.title.toLowerCase().includes(trackData.title.toLowerCase()) ||
            trackData.title.toLowerCase().includes(t.title.toLowerCase())
        );
        if (matchingTrack) {
          trackId = matchingTrack.id;
        }
      }

      // Step 5: Mark the album/track for monitoring and request
      const monitoringResult = await this.client.put(`/api/v1/album/${albumId}`, {
        monitored: true,
      });

      // Optional: Add to queue (search for the track)
      await this.client.post(`/api/v1/command`, {
        name: 'AlbumSearch',
        albumId,
      });

      return {
        lidarr_artist_id: artistId,
        lidarr_album_id: albumId,
        lidarr_track_id: trackId,
        requested_at: new Date(),
      };
    } catch (error) {
      console.error(`Error requesting track:`, error.message);
      throw error;
    }
  }

  /**
   * Get all downloads in the queue
   * @returns {Array} Array of queue item objects
   */
  async getQueue() {
    try {
      const response = await this.client.get('/api/v1/queue');
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Error getting Lidarr queue:', error.message);
      throw error;
    }
  }

  /**
   * Get download history
   * @param {number} limit - Number of recent items to return
   * @returns {Array} Array of history item objects
   */
  async getHistory(limit = 100) {
    try {
      const response = await this.client.get('/api/v1/history', {
        params: { pageSize: limit, sortKey: 'date', sortDirection: 'descending' },
      });
      return response.data?.records || [];
    } catch (error) {
      console.error('Error getting Lidarr history:', error.message);
      throw error;
    }
  }

  /**
   * Test connection to Lidarr
   */
  async testConnection() {
    try {
      const response = await this.client.get('/api/v1/system/status');
      return { success: true, version: response.data.version };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all root folders
   * @returns {Array} Array of root folder objects
   */
  async getRootFolders() {
    try {
      const response = await this.client.get('/api/v1/rootfolder');
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      console.error('Error getting root folders:', error.message);
      throw error;
    }
  }
}

module.exports = LidarrService;
