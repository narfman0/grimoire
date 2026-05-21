# Multi-stage build for the SvelteKit (adapter-node) web service.

FROM node:22-alpine AS base
# pnpm 11 is required — pnpm-workspace.yaml uses the v11 allowBuilds /
# onlyBuiltDependencies fields, which v9 rejects with "packages field
# missing or empty". Keep in sync with the CI version (pnpm/action-setup
# @v4 with version: latest).
# CI=true keeps pnpm non-interactive (it auto-purges node_modules on
# mismatch instead of prompting and aborting in non-TTY environments).
ENV CI=true
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@11.1.2 --activate
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
COPY --from=deps      /app/node_modules ./node_modules
COPY --from=web-build /app/build         ./build
COPY --from=web-build /app/drizzle       ./drizzle
COPY --from=web-build /app/scripts       ./scripts
COPY --from=web-build /app/package.json      ./package.json
COPY --from=web-build /app/content-packs     ./content-packs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["sh", "-c", "node scripts/migrate.mjs && node build"]
