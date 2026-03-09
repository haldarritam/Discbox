const fs = require('fs').promises;
const path = require('path');

class ScannerService {
  constructor(musicRootPath) {
    this.musicRootPath = musicRootPath;
  }

  /**
   * Get supported audio file extensions
   */
  getSupportedExtensions() {
    return ['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wma', '.alac'];
  }

  /**
   * Recursively scan directory for audio files
   * @param {string} dirPath - Directory to scan
   * @returns {Array} Array of file paths
   */
  private async scanDirectory(dirPath) {
    const files = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Recursively scan subdirectories
          const subFiles = await this.scanDirectory(fullPath);
          files.push(...subFiles);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (this.getSupportedExtensions().includes(ext)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${dirPath}:`, error.message);
    }

    return files;
  }

  /**
   * Normalize track title for matching
   * Removes special characters and converts to lowercase
   */
  private normalizeTitle(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }

  /**
   * Check if a file path matches a track's artist and title
   */
  private matchesTrack(filePath, artist, title) {
    const fileName = path.basename(filePath, path.extname(filePath));
    const normalized = this.normalizeTitle(fileName);
    const normalizedArtist = this.normalizeTitle(artist);
    const normalizedTitle = this.normalizeTitle(title);
    const normalizedSearch = `${normalizedArtist}${normalizedTitle}`;

    // Check if both artist and title appear in the filename
    return (
      normalized.includes(normalizedArtist) &&
      normalized.includes(normalizedTitle)
    );
  }

  /**
   * Scan the music root directory for downloaded tracks
   * @param {Array} tracks - Array of track objects { artist, title, ... }
   * @returns {Array} Array of matched track indices
   */
  async findDownloadedTracks(tracks) {
    try {
      const allFiles = await this.scanDirectory(this.musicRootPath);
      const matched = [];

      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const isMatched = allFiles.some((filePath) =>
          this.matchesTrack(filePath, track.artist, track.title)
        );

        if (isMatched) {
          matched.push(i);
        }
      }

      return matched;
    } catch (error) {
      console.error('Error scanning for downloaded tracks:', error.message);
      throw error;
    }
  }

  /**
   * Get recently modified audio files in the music root
   * @param {number} minutes - Look for files modified in the last N minutes
   * @returns {Array} Array of file paths
   */
  async getRecentlyAdded(minutes = 60) {
    try {
      const allFiles = await this.scanDirectory(this.musicRootPath);
      const now = Date.now();
      const threshold = minutes * 60 * 1000;

      const recent = [];
      for (const filePath of allFiles) {
        try {
          const stat = await fs.stat(filePath);
          const timeDiff = now - stat.mtimeMs;
          if (timeDiff < threshold) {
            recent.push({
              path: filePath,
              fileName: path.basename(filePath),
              modifiedTime: stat.mtime,
            });
          }
        } catch (e) {
          // Skip files that can't be stat'd
        }
      }

      return recent.sort((a, b) => b.modifiedTime - a.modifiedTime);
    } catch (error) {
      console.error('Error getting recently added files:', error.message);
      throw error;
    }
  }

  /**
   * Find a matching file for a specific track
   * @param {Object} track - { artist, title }
   * @returns {Object|null} File object with path and metadata, or null
   */
  async findTrackFile(track) {
    try {
      const recent = await this.getRecentlyAdded(1440); // Last 24 hours

      for (const file of recent) {
        if (this.matchesTrack(file.path, track.artist, track.title)) {
          return file;
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding track file:', error.message);
      throw error;
    }
  }

  /**
   * Get total size of downloaded music
   */
  async getTotalSize() {
    try {
      const allFiles = await this.scanDirectory(this.musicRootPath);
      let totalSize = 0;

      for (const filePath of allFiles) {
        try {
          const stat = await fs.stat(filePath);
          totalSize += stat.size;
        } catch (e) {
          // Skip files that can't be stat'd
        }
      }

      return totalSize;
    } catch (error) {
      console.error('Error calculating total size:', error.message);
      throw error;
    }
  }

  /**
   * Test if the music root directory is accessible
   */
  async testAccess() {
    try {
      await fs.access(this.musicRootPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

module.exports = ScannerService;
