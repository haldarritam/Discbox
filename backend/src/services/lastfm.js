const crypto = require('crypto');
const axios = require('axios');

const LASTFM_API_URL = 'http://ws.audioscrobbler.com/2.0/';

class LastFMService {
  constructor(apiKey, secret, username) {
    this.apiKey = apiKey;
    this.secret = secret;
    this.username = username;
  }

  /**
   * Generate Last.fm authentication signature for API calls
   */
  private getSignature(params) {
    const sortedParams = Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join('');
    const message = sortedParams + this.secret;
    return crypto.createMd5Hash(message).digest('hex');
  }

  /**
   * Make an authenticated Last.fm API call
   */
  private async makeRequest(method, params = {}) {
    const payload = {
      method,
      user: this.username,
      api_key: this.apiKey,
      format: 'json',
      ...params,
    };

    try {
      const response = await axios.get(LASTFM_API_URL, { params: payload });
      
      if (response.data.error) {
        throw new Error(`Last.fm API error: ${response.data.message}`);
      }

      return response.data;
    } catch (error) {
      console.error(`Last.fm API call failed for method ${method}:`, error.message);
      throw error;
    }
  }

  /**
   * Fetch loved tracks from Last.fm
   * @returns {Array} Array of track objects { artist, title, url, image }
   */
  async getLovedTracks(limit = 500) {
    try {
      const response = await this.makeRequest('user.getLovedTracks', {
        limit,
        extended: 1,
      });

      if (!response.lovedtracks || !response.lovedtracks.track) {
        return [];
      }

      const tracks = Array.isArray(response.lovedtracks.track)
        ? response.lovedtracks.track
        : [response.lovedtracks.track];

      return tracks.map((track) => ({
        artist: track.artist.name || track.artist,
        title: track.name,
        lastfm_url: track.url,
        album_art_url: this.getImageUrl(track.image),
        play_count: 0,
        loved: true,
      }));
    } catch (error) {
      console.error('Error fetching loved tracks:', error);
      throw error;
    }
  }

  /**
   * Fetch top tracks from Last.fm
   * @param {string} period - Time period: 7day, 1month, 3month, 6month, 12month, overall
   * @param {number} limit - Max tracks to return
   * @returns {Array} Array of track objects { artist, title, url, image, play_count }
   */
  async getTopTracks(period = '1month', limit = 500) {
    try {
      const response = await this.makeRequest('user.getTopTracks', {
        period,
        limit,
        extended: 1,
      });

      if (!response.toptracks || !response.toptracks.track) {
        return [];
      }

      const tracks = Array.isArray(response.toptracks.track)
        ? response.toptracks.track
        : [response.toptracks.track];

      return tracks.map((track) => ({
        artist: track.artist.name || track.artist,
        title: track.name,
        lastfm_url: track.url,
        album_art_url: this.getImageUrl(track.image),
        play_count: parseInt(track.playcount) || 0,
        loved: false,
      }));
    } catch (error) {
      console.error('Error fetching top tracks:', error);
      throw error;
    }
  }

  /**
   * Get the best quality image URL from Last.fm image array
   */
  private getImageUrl(images) {
    if (!images || !Array.isArray(images)) return null;

    // Last.fm provides images in order: small, medium, large, extralarge
    // Return the largest available
    const extralarge = images.find((img) => img.size === 'extralarge');
    if (extralarge) return extralarge['#text'];

    const large = images.find((img) => img.size === 'large');
    if (large) return large['#text'];

    const medium = images.find((img) => img.size === 'medium');
    if (medium) return medium['#text'];

    return images[images.length - 1]?.['#text'] || null;
  }

  /**
   * Test Last.fm credentials
   */
  async testConnection() {
    try {
      await this.makeRequest('user.getInfo');
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = LastFMService;
