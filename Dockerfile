# Multi-stage build for the SvelteKit (adapter-node) web service.

FROM node:26-alpine AS base
# pnpm 11 is required — pnpm-workspace.yaml uses the v11 allowBuilds /
# onlyBuiltDependencies fields, which v9 rejects with "packages field
# missing or empty". Keep in sync with the CI version (pnpm/action-setup
# @v6 with version: latest).
# CI=true keeps pnpm non-interactive (it auto-purges node_modules on
# mismatch instead of prompting and aborting in non-TTY environments).
ENV CI=true
# pnpm is installed via npm, not corepack: corepack was removed from the
# official Node distributions as of Node 25, so `corepack enable` in the
# node:26-alpine image fails with "corepack: not found" (exit 127). That is
# what broke the first Node 26 deploy — CI never saw it, because CI installs
# pnpm through pnpm/action-setup and never touches this image.
RUN apk add --no-cache python3 make g++ \
  && npm install -g pnpm@11.1.2
WORKDIR /app

# --- deps stage: install deps once, cache mountable ---------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

# --- web build ----------------------------------------------------------
FROM deps AS web-build
COPY . .
RUN pnpm build

FROM base AS web
ENV NODE_ENV=production
# Litestream streams the SQLite file to S3-compatible storage when
# LITESTREAM_REPLICA_URL is set (see scripts/start.sh); inert otherwise.
COPY --from=docker.io/litestream/litestream:0.3 /usr/local/bin/litestream /usr/local/bin/litestream
COPY --from=deps      /app/node_modules ./node_modules
COPY --from=web-build /app/build         ./build
COPY --from=web-build /app/drizzle       ./drizzle
COPY --from=web-build /app/scripts       ./scripts
COPY --from=web-build /app/package.json      ./package.json
COPY --from=web-build /app/content-packs     ./content-packs
RUN chmod +x scripts/start.sh
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["sh", "scripts/start.sh"]
