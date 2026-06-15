# syntax=docker/dockerfile:1.7
#
# @aidlog/api — multi-stage, pnpm-workspace-aware image.
#
# Build context MUST be the monorepo root (see infra/docker-compose.yml: the api
# service sets `context: ..` and `dockerfile: apps/api/Dockerfile`) so the root
# manifests + lockfile + workspace packages are available.
#
# Strategy: install the FULL workspace with the same tooling the repo uses
# (corepack-pinned pnpm + frozen lockfile), build the workspace deps
# (@aidlog/contracts, @aidlog/crypto-core) and the api, then `pnpm deploy` a
# production-only tree into a slim runtime image. We build INSIDE the container
# so the known-broken libsodium ESM build is reproducible and never depends on
# host tooling.
#
# Migrations: `tsc` compiles src/db/migrate.ts to dist/db/migrate.js, but it does
# NOT copy the *.sql files. We copy them next to the compiled runner so the
# migrate one-shot can run with plain `node` — no tsx needed at runtime.

ARG NODE_VERSION=20-bookworm-slim

# ---------------------------------------------------------------------------
# Stage 1: base — pnpm via corepack, pinned to the version in package.json.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Stage 2: deps — install the whole workspace from manifests only (cached layer).
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json   packages/contracts/package.json
COPY packages/crypto-core/package.json packages/crypto-core/package.json
COPY apps/api/package.json             apps/api/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    corepack pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3: build — source in, build deps + api, copy raw SQL into dist.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY packages/contracts   packages/contracts
COPY packages/crypto-core packages/crypto-core
COPY apps/api             apps/api
# Build order: contracts → crypto-core → api (deps before dependents).
RUN corepack pnpm --filter @aidlog/contracts build \
 && corepack pnpm --filter @aidlog/crypto-core build \
 && corepack pnpm --filter @aidlog/api build
# tsc does not copy *.sql — place them next to the compiled migrate runner.
RUN cp apps/api/src/db/migrations/*.sql apps/api/dist/db/migrations/ 2>/dev/null \
 || (mkdir -p apps/api/dist/db/migrations && cp apps/api/src/db/migrations/*.sql apps/api/dist/db/migrations/)
# Production-only deployable tree with workspace deps materialised to real files.
RUN corepack pnpm --filter @aidlog/api deploy --prod /app

# ---------------------------------------------------------------------------
# Stage 4: runtime — slim, non-root.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
# wget powers the container healthcheck (not present on -slim by default).
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
# node image ships an unprivileged `node` user (uid 1000).
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Liveness: api answers GET /api/health on $PORT (default 3000).
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

# Default: run the compiled server. The migrate one-shot (compose) overrides the
# command with: node dist/db/migrate.js
CMD ["node", "dist/server.js"]
