# Multi-stage Dockerfile for Discbox
# Stage 1: Build frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend ./
RUN npm run build

# Stage 2: Build backend and final image
FROM node:18-alpine

# Install dumb-init, libssl for Prisma, ffmpeg, python3 for yt-dlp, deno for JS runtime, and yt-dlp itself
RUN apk add --no-cache dumb-init openssl ffmpeg python3 py3-pip curl deno

# Install yt-dlp.
#
# The ADD below is a cache-buster, not a build input. "curl .../latest/download"
# is a constant string, so Docker happily reuses a cached layer forever and the
# image keeps shipping whatever yt-dlp was current the first time it was built —
# this image was rebuilt repeatedly and silently kept a 5-month-old binary.
# Fetching the release metadata makes the layer's cache key depend on the actual
# latest release, so a new upstream release invalidates it.
ADD https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest /tmp/ytdlp-release.json

# YouTube breaks older yt-dlp builds every few months (every download starts
# returning HTTP 403 Forbidden while search keeps working), so the app ALSO
# self-updates the binary at startup and once a day — see startYtDlpUpdater() in
# src/scheduler.js. That needs the binary to stay writable, hence /usr/local/bin
# rather than a package install.
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
    -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp && \
    rm -f /tmp/ytdlp-release.json && \
    yt-dlp --version

# Install mutagen for audio metadata tagging
RUN pip3 install mutagen --break-system-packages

# Create non-root user
RUN addgroup -g 1001 discbox && adduser -D -u 1001 -G discbox discbox

WORKDIR /app

# Copy backend files
COPY backend/package*.json ./
COPY backend/prisma ./prisma

# Install production dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate

# Copy backend source
COPY backend/src ./src

# Maintenance scripts, runnable with: docker exec <container> node scripts/<name>.js
COPY scripts ./scripts

# Copy built frontend from previous stage
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create config and music directories with proper permissions
RUN mkdir -p /app/config /music && \
    chmod 777 /app/config /music && \
    chown -R discbox:discbox /app /music

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/config/discbox.db
ENV PORT=8767
ENV MUSIC_OUTPUT_DIR=/music
ENV AUDIO_FORMAT=mp3
ENV AUDIO_QUALITY=320k
ENV MAX_CONCURRENT_DOWNLOADS=2
ENV SEARCH_PREFERENCE=auto

# Health check.
# 127.0.0.1, not localhost: the container's /etc/hosts maps localhost to ::1 as
# well, and the server binds 0.0.0.0 (IPv4 only), so an IPv6-first resolution
# makes the check fail with ECONNREFUSED against a perfectly healthy app.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8767/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)}).on('error', (e) => {console.error(e.message); process.exit(1)})"

# Run as root to ensure yt-dlp can write to /music directory
# Note: The music directory is mounted from the host, and host permissions take precedence
USER root

EXPOSE 8767

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/index.js"]
