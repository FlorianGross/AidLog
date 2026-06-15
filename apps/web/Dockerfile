# syntax=docker/dockerfile:1.7
#
# @aidlog/web — SvelteKit PWA, multi-stage, pnpm-workspace-aware image.
#
# Build context MUST be the monorepo root (compose sets `context: ..`,
# `dockerfile: apps/web/Dockerfile`).
#
# ASSUMPTION (apps/web does not exist at the time this infra was written):
#   - The web app is SvelteKit and uses @sveltejs/adapter-node, producing a
#     Node server at apps/web/build/index.js started with `node build`.
#   - It depends on the workspace packages @aidlog/contracts and
#     @aidlog/crypto-core, and on a bundler (Vite) that aliases the broken
#     libsodium ESM build. Building inside the container keeps that resilient.
#   - PUBLIC_* env (e.g. PUBLIC_API_BASE) is same-origin ("/api"), so no API URL
#     needs to be baked at build time. If your build instead inlines a public API
#     URL, pass it as a build ARG.
#
# IF the web app actually uses @sveltejs/adapter-static instead, you do NOT need
# this image at all: build the static site and let Caddy serve ./build directly.
# See infra/README.md → "Web adapter" for both wiring options.

ARG NODE_VERSION=20-bookworm-slim

# ---------------------------------------------------------------------------
# Stage 1: base
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Stage 2: deps — install whole workspace from manifests (cached).
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json   packages/contracts/package.json
COPY packages/crypto-core/package.json packages/crypto-core/package.json
COPY apps/web/package.json             apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    corepack pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3: build — workspace deps + the SvelteKit app.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY packages/contracts   packages/contracts
COPY packages/crypto-core packages/crypto-core
COPY apps/web             apps/web
RUN corepack pnpm --filter @aidlog/contracts build \
 && corepack pnpm --filter @aidlog/crypto-core build \
 && corepack pnpm --filter @aidlog/web build
# Production-only deployable tree (adapter-node output + runtime deps).
RUN corepack pnpm --filter @aidlog/web deploy --prod --legacy /app

# ---------------------------------------------------------------------------
# Stage 4: runtime — slim, non-root, runs the adapter-node server.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
# adapter-node honours PORT/HOST.
ENV PORT=3000
ENV HOST=0.0.0.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app /app
RUN chown -R node:node /app
USER node

EXPOSE 3000

# adapter-node serves the app; SvelteKit answers "/" with the app shell.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider "http://127.0.0.1:${PORT:-3000}/" || exit 1

# adapter-node entrypoint.
CMD ["node", "build"]
