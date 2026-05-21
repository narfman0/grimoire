# Multi-stage build for the SvelteKit (adapter-node) web service.

FROM node:20-alpine AS base
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# --- deps stage: install deps once, cache mountable ---------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json ./
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1
CMD ["sh", "-c", "node scripts/migrate.mjs && node build"]
