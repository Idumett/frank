FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY . .
RUN pnpm config set dangerouslyAllowAllBuilds true && pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/data/frank.db TTS_CACHE_DIR=/data/tts-cache OBSERVABILITY_ENABLED=true
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)})"
CMD ["node", "apps/api/dist/server.js"]
