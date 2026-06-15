# syntax=docker/dockerfile:1.7
#
# Aidlog edge proxy + static web, in one image.
#
# The web app is SvelteKit with @sveltejs/adapter-static (a client-rendered PWA
# with a `200.html` SPA fallback). There is no Node web server to run — Caddy
# serves the prebuilt static files directly and reverse-proxies /api to the api
# service. This removes a whole container and matches how the app is actually
# built (verified: `vite build` -> "Using @sveltejs/adapter-static", wrote ./build).
#
# Build context MUST be the monorepo root (see infra/docker-compose.yml: the
# caddy service sets `context: ..` and `dockerfile: infra/Caddy.Dockerfile`) so
# the pnpm workspace + lockfile + workspace packages are available.

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
COPY apps/web/package.json             apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    corepack pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 3: build — source in, build deps + the static site (adapter-static).
# Build INSIDE the container so the libsodium ESM bundler alias is reproducible.
# ---------------------------------------------------------------------------
FROM deps AS build
COPY packages/contracts   packages/contracts
COPY packages/crypto-core packages/crypto-core
COPY apps/web             apps/web
RUN corepack pnpm --filter @aidlog/contracts build \
 && corepack pnpm --filter @aidlog/crypto-core build \
 && corepack pnpm --filter @aidlog/web build

# ---------------------------------------------------------------------------
# Stage 4: runtime — Caddy serving the static site + proxying /api.
# ---------------------------------------------------------------------------
FROM caddy:2-alpine AS runtime
# Prebuilt static PWA (incl. 200.html SPA fallback, sw.js, _app/ assets).
COPY --from=build /repo/apps/web/build /srv
# The Caddyfile is NOT baked in: the repo root .dockerignore excludes infra/ from
# the build context, and compose mounts ./Caddyfile to /etc/caddy/Caddyfile at
# runtime anyway (see infra/docker-compose.yml caddy.volumes). Caddy's default
# config path is /etc/caddy/Caddyfile, so the mounted file is used directly.
EXPOSE 80 443
