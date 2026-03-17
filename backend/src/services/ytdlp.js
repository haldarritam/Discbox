const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class YTDLPService {
  /**
   * Check if yt-dlp is installed and get version
   * @returns {Promise<string>} Version string
   */
  static async checkYtDlp() {
    return new Promise((resolve, reject) => {
      const proc = spawn('yt-dlp', ['--version']);
      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              'yt-dlp is not installed. Install via: curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && chmod +x /usr/local/bin/yt-dlp'
            )
          );
        } else {
          resolve(output.trim());
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run yt-dlp: ${err.message}`));
      });
    });
  }

  /**
   * Search YouTube for a track
   * @param {string} artist
   * @param {string} title
   * @param {string} preference - 'auto' | 'official_audio' | 'lyrics'
   * @returns {Promise<Object|null>} { url, videoId, title, duration, channelName, score }
   */
  static async searchYouTube(artist, title, preference = 'auto') {
    try {
      let query;
      
      if (preference === 'lyrics') {
        query = `${artist} ${title} lyrics`;
      } else if (preference === 'official_audio') {
        query = `${artist} ${title} official audio`;
      } else {
        // auto preference
        query = `${artist} ${title} official audio`;
      }

      return new Promise((resolve, reject) => {
        const proc = spawn('yt-dlp', [
          `ytsearch5:${query}`,
          '--dump-json',
          '--no-download',
          '--flat-playlist',
          '--extractor-args', 'youtube:player_skip=all',
          '--socket-timeout', '30',
        ]);

        let output = '';

        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', (code) => {
          if (code !== 0 || !output) {
            resolve(null);
            return;
          }

          try {
            const lines = output.trim().split('\n').filter((line) => line.trim());
            const results = lines.map((line) => JSON.parse(line));

            const scoredResults = results.map((result) => {
              let score = 0;

              // +3 if title contains both artist and track title
              const titleLower = (result.title || '').toLowerCase();
              const artistLower = artist.toLowerCase();
              const titleSearchLower = title.toLowerCase();

              if (titleLower.includes(artistLower) && titleLower.includes(titleSearchLower)) {
                score += 3;
              }

              // +2 if channel name matches artist
              const channelLower = (result.channel || '').toLowerCase();
              if (channelLower.includes(artistLower)) {
                score += 2;
              }

              // +2 if title contains "official audio" or channel is topic channel
              if (titleLower.includes('official audio') || channelLower.includes('topic')) {
                score += 2;
              }

              // +1 if title contains "lyrics" and preference is lyrics
              if (preference === 'lyrics' && titleLower.includes('lyrics')) {
                score += 1;
              }

              // +1 if duration is between 2-8 minutes
              const duration = result.duration || 0;
              if (duration >= 120 && duration <= 480) {
                score += 1;
              }

              // Disqualify if duration is under 60s or over 10min
              if (duration < 60 || duration > 600) {
                return null;
              }

              return {
                url: result.url,
                videoId: result.id,
                title: result.title,
                duration,
                channelName: result.channel,
                score,
              };
            }).filter((r) => r !== null && r.score > 0);

            if (scoredResults.length === 0) {
              resolve(null);
              return;
            }

            // Return highest scoring result
            scoredResults.sort((a, b) => b.score - a.score);
            resolve(scoredResults[0]);
          } catch (error) {
            reject(error);
          }
        });

        proc.on('error', (err) => {
          reject(err);
        });
      });
    } catch (error) {
      console.error('Error searching YouTube:', error);
      return null;
    }
  }

  /**
   * Download a track from YouTube
   * @param {string} videoUrl
   * @param {string} artist
   * @param {string} title
   * @param {Object} options - { format, quality, outputDir, onProgress }
   * @returns {Promise<Object>} { success, filePath, error }
   */
  static async downloadTrack(videoUrl, artist, title, options = {}) {
    const {
      format = 'mp3',
      quality = '320k',
      outputDir = '/music',
      onProgress = null,
      track = {},
    } = options;

    // Log the resolved output directory for debugging
    console.log(`[yt-dlp] Downloading to: ${outputDir}`);
    console.log(`[yt-dlp] Track: ${artist} - ${title}`);

    // Try to create directory but DO NOT fail if it errors
    // yt-dlp will create its own directories anyway
    try {
      if (!fs.existsSync(outputDir)) {
        console.log(`[yt-dlp] Creating directory: ${outputDir}`);
        fs.mkdirSync(outputDir, { recursive: true });
      }
    } catch (mkdirErr) {
      // Log the warning but DO NOT block download
      // yt-dlp may still succeed by creating its own dirs
      console.warn(`[yt-dlp] mkdir warning (non-fatal): ${mkdirErr.message}`);
    }

    const maxRetries = 2;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const sanitize = (str) => (str || '').replace(/[<>:"\/\\|?*]/g, '').replace(/\//g, '-').trim()
          const safeArtist = sanitize(artist)
          const safeAlbum = sanitize(track.album_name || '')
          const safeTitle = sanitize(title)
          const trackNum = track.track_position ? String(track.track_position).padStart(2, '0') + ' - ' : ''
          const outputTemplate = safeAlbum
            ? path.join(outputDir, safeArtist, safeAlbum, `${trackNum}${safeTitle}.${format}`)
            : path.join(outputDir, safeArtist, `${safeTitle}.${format}`)

          const args = [
            '-x',
            '--audio-format',
            format,
            '--audio-quality',
            quality,
            '--embed-thumbnail',
            '--embed-metadata',
            '--output',
            outputTemplate,
            '--newline',
            '--no-playlist',
            '--extractor-args', 'youtube:player_skip=all',
            '--socket-timeout', '30',
            '--no-check-certificate',
            videoUrl,
          ];

          const proc = spawn('yt-dlp', args);

          let filePath = null;
          let error = '';

          proc.stdout.on('data', (data) => {
            const line = data.toString().trim();

            // Parse progress lines: "[download]  45.3% of 4.23MiB at 1.2MiB/s ETA 00:03"
            const progressMatch = line.match(
              /\[download\]\s+([\d.]+)%.*at\s+([\d.]+\w+\/s).*ETA\s+([\d:]+)/
            );
            if (progressMatch && onProgress) {
              onProgress({
                percent: parseFloat(progressMatch[1]),
                speed: progressMatch[2],
                eta: progressMatch[3],
              });
            }

            // Capture final file path from output
            if (line.includes('[ExtractAudio]') || line.includes('Deleting')) {
              // Extract file path from context
              const pathMatch = line.match(/(?:Deleting|for)\s+(.+\.mp3|\.flac|\.opus|\.m4a)/);
              if (pathMatch) {
                filePath = pathMatch[1];
              }
            }
          });

          proc.stderr.on('data', (data) => {
            error += data.toString();
          });

          proc.on('close', (code) => {
            if (code !== 0) {
              lastError = error || 'Unknown error';
              reject(new Error(error || 'yt-dlp exited with non-zero code'));
            } else {
              // Try to construct expected file path if not found in output
              if (!filePath) {
                filePath = path.join(
                  outputDir,
                  artist,
                  `${title}.${format}`
                );
              }
              
              // After yt-dlp finishes, verify the file actually exists
              // This handles cases where yt-dlp reports success but file wasn't created
              const downloadedFile = YTDLPService.findDownloadedFile(
                outputDir,
                artist,
                title
              );
              
              if (downloadedFile) {
                console.log(`[yt-dlp] Download verified: ${downloadedFile}`);
                resolve({ success: true, filePath: downloadedFile, error: null });
              } else {
                console.warn(`[yt-dlp] yt-dlp reported success but file not found for ${artist} - ${title}`);
                resolve({ success: true, filePath: filePath || null, error: null });
              }
            }
          });

          proc.on('error', (err) => {
            lastError = err.message;
            reject(err);
          });
        });
      } catch (error) {
        if (attempt < maxRetries) {
          console.warn(`Download attempt ${attempt + 1} failed, retrying in 5s...`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } else {
          return {
            success: false,
            filePath: null,
            error: lastError || error.message,
          };
        }
      }
    }

    return {
      success: false,
      filePath: null,
      error: lastError || 'All download attempts failed',
    };
  }
  /**
   * Find a downloaded audio file by artist and title
   * Walks the output directory and matches files by normalized name
   * @param {string} outputDir
   * @param {string} artist
   * @param {string} title
   * @returns {string|null} Full path to found file or null
   */
  static findDownloadedFile(outputDir, artist, title) {
    const audioExtensions = ['.mp3', '.flac', '.m4a', '.opus', '.ogg', '.aac'];
    
    const normalize = (str) => (str || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const normalizedTitle = normalize(title);
    const normalizedArtist = normalize(artist);

    function walkDir(dir) {
      let files = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            files = files.concat(walkDir(fullPath));
          } else if (audioExtensions.includes(
            path.extname(entry.name).toLowerCase()
          )) {
            files.push(fullPath);
          }
        }
      } catch (e) {
        // Silently ignore permission errors or missing directories
      }
      return files;
    }

    if (!fs.existsSync(outputDir)) return null;

    const allFiles = walkDir(outputDir);
    
    for (const filePath of allFiles) {
      const fileName = normalize(
        path.basename(filePath, path.extname(filePath))
      );
      const parentDir = normalize(
        path.basename(path.dirname(filePath))
      );
      
      // Match if filename contains title, and either:
      // 1. Parent directory contains artist name, OR
      // 2. Grandparent directory contains artist name (new Album/Artist structure), OR
      // 3. Filename contains both artist and title
      const grandParentDir = normalize(
        path.basename(path.dirname(path.dirname(filePath)))
      );
      if (fileName.includes(normalizedTitle)) {
        if (parentDir.includes(normalizedArtist) ||
            grandParentDir.includes(normalizedArtist) ||
            fileName.includes(normalizedArtist)) {
          return filePath;
        }
      }
    }
    
    return null;
  }
  static async tagFile(filePath, track) {
    return new Promise((resolve) => {
      const taggerPath = path.join(__dirname, 'tagger.py')
      const tmpJson = path.join('/tmp', `tag_${Date.now()}.json`)

      const meta = {
        filepath: filePath,
        artist: track.artist || '',
        title: track.title || '',
        album: track.album_name || null,
        album_art_url: track.album_art_url || null,
        contributors: track.contributors || null,
        track_position: track.track_position || null,
        disk_number: track.disk_number || null,
        release_date: track.release_date || null,
        bpm: track.bpm || null,
        isrc: track.isrc || null,
      }

      fs.writeFileSync(tmpJson, JSON.stringify(meta))
      console.log(`[tagger] Tagging: ${track.artist} - ${track.title}`)

      const proc = spawn('python3', [taggerPath, tmpJson])
      let error = ''
      proc.stdout.on('data', (data) => { console.log(data.toString().trim()) })
      proc.stderr.on('data', (data) => { error += data.toString(); console.warn('[tagger]', data.toString().trim()) })
      proc.on('close', (code) => {
        try { fs.unlinkSync(tmpJson) } catch {}
        if (code === 0) {
          // tagger.py already logs success
          resolve({ success: true })
        } else {
          console.warn(`[tagger] Failed for ${filePath}: ${error}`)
          resolve({ success: false, error })
        }
      })
      proc.on('error', (err) => {
        try { fs.unlinkSync(tmpJson) } catch {}
        resolve({ success: false, error: err.message })
      })
    })
  }

}

module.exports = YTDLPService;
