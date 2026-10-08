# FeedForge backend (API + video engine). Deploy on Hugging Face Spaces (Docker),
# Railway, Render (2GB+ RAM) or Google Cloud Run. The UI is deployed separately on Vercel.
FROM node:22-bookworm-slim

# FFmpeg + shared libraries for Chrome Headless Shell (used by the video renderer)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libgbm1 libasound2 \
      libxrandr2 libxkbcommon0 libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 \
  && rm -rf /var/lib/apt/lists/*

ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip \
    NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=768" \
    REMOTION_CONCURRENCY=1 \
    HOST=0.0.0.0 \
    PORT=7860 \
    FEEDFORGE_DATA_DIR=/data \
    FEEDFORGE_FRONTEND_DIR=/app/public

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund --include=dev

# Download Chrome Headless Shell for Remotion at build time
RUN npx remotion browser ensure

COPY server/ ./
COPY public/ /app/public/

# Run as the non-root "node" user (uid 1000, required by Hugging Face Spaces)
RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fsS "http://localhost:${PORT}/health" || exit 1
CMD ["npx", "tsx", "src/feedforge/server.ts"]
