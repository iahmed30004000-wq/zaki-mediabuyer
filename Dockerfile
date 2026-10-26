# syntax=docker/dockerfile:1
# Zaki Media Buyer — one image for the site and the worker (same code, different command).
# Built on GitHub Actions (.github/workflows/image.yml) and pulled by Coolify: the server never compiles anything
# (lesson from the OMS: a `next build` beside the live site took it down every time).
# Debian slim: Prisma's engines need libssl3.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# dev dependencies stay: the worker runs with tsx
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# placeholders for the build only — production values come from Coolify's environment
ENV AUTH_SECRET=build-time-placeholder-not-a-secret-000000 DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
# the commit this image was built from — /api/health reports it, so the deploy can prove the new image is the one running
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3140 TZ=Asia/Amman STORAGE_DIR=/app/storage
# ffmpeg/ffprobe: the creative intake probes every video and cuts its thumbnail frames (spec 7.2, 7.5)
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl ca-certificates tzdata ffmpeg && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /bin/false mb \
    && mkdir -p /app/storage && chown -R mb:mb /app/storage
COPY --from=build /app/package.json /app/next.config.mjs /app/tsconfig.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src ./src
COPY --from=build /app/worker ./worker
COPY --from=build /app/scripts ./scripts
USER mb
EXPOSE 3140
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3140/api/health',r=>process.exit(r.statusCode<400?0:1)).on('error',()=>process.exit(1))"
# additive, idempotent migrations at start (DATABASE_URL from the environment, never baked in), then serve
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx next start -p 3140"]
