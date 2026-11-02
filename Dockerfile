# syntax=docker/dockerfile:1

###############################################################################
# Ops — production image
#
# IMPORTANT: PDF export (§7.5) renders through headless Chromium, so the image
# must contain a Chromium binary AND its shared libraries. Omitting them makes
# "Export PDF" fail at runtime with a launch error, while everything else works
# — an easy failure to miss in review.
###############################################################################

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---------------------------------------------------------------- dependencies
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# better-sqlite3 and sharp need build tooling; that is why this stage is not slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

# --------------------------------------------------------------------- build
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ------------------------------------------------------------------- runtime
FROM base AS runtime
WORKDIR /app

# Chromium's runtime dependencies (§7.5). Keep this list in sync with
# `npx playwright install-deps chromium` for the Playwright version in use.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation fonts-noto-color-emoji \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 \
      libcups2 libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libnspr4 \
      libnss3 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxrender1 \
      libxshmfence1 wget xdg-utils \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/src/server/db/migrations ./src/server/db/migrations
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build /app/scripts ./scripts

# Install ONLY Chromium (not the full browser set) to keep the image small.
RUN npx playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

# Uploads and the DB live on mounted volumes (§10.1), never in the image layer.
RUN mkdir -p /data /var/ops/uploads
ENV DATABASE_PATH=/data/ops.db
ENV UPLOADS_DIR=/var/ops/uploads

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

# Migrations run before the server starts so a fresh volume is always in sync.
CMD ["sh", "-c", "node -e \"require('child_process').execSync('npx tsx src/server/db/migrate.ts',{stdio:'inherit'})\" && npx next start -p 3000"]
