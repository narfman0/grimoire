# Multi-stage build for the SvelteKit (adapter-node) web service.
# The sync-server is built from the same context in a parallel stage so
# docker-compose can ship both from one Dockerfile (selected via target).

FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# --- deps stage: install all workspaces' deps once, cache mountable -----
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
COPY sync-server/package.json ./sync-server/
RUN pnpm install --frozen-lockfile=false

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
COPY --from=web-build /app/package.json  ./package.json
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && node build"]

# --- sync-server --------------------------------------------------------
FROM deps AS sync-build
COPY . .
RUN pnpm --filter @grimoire/sync-server build

FROM base AS sync
ENV NODE_ENV=production
COPY --from=deps       /app/node_modules           ./node_modules
COPY --from=sync-build /app/sync-server/dist       ./sync-server/dist
COPY --from=sync-build /app/sync-server/package.json ./sync-server/package.json
WORKDIR /app/sync-server
EXPOSE 1234
CMD ["node", "dist/index.js"]
