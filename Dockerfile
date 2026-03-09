# Multi-stage Dockerfile for LikedFM
# Stage 1: Build frontend
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend ./
RUN npm run build

# Stage 2: Build backend and final image
FROM node:18-alpine

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1000 likedfm && adduser -D -u 1000 -G likedfm likedfm

WORKDIR /app

# Copy backend files
COPY backend/package*.json ./
COPY backend/prisma ./prisma

# Install production dependencies
RUN npm ci --production

# Copy backend source
COPY backend/src ./src

# Copy built frontend from previous stage
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create config directory for SQLite and settings
RUN mkdir -p /app/config && chown -R likedfm:likedfm /app

# Set environment variables
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/config/likedfm.db
ENV PORT=8686

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8686/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

USER likedfm

EXPOSE 8686

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "src/index.js"]
