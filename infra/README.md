# Self-hosting Aidlog

Bring up the whole stack — Caddy (TLS) → SvelteKit PWA + Fastify API → Postgres +
MinIO — with one command. The server is a **blind store**: it only ever holds
ciphertext and routing metadata, never plaintext patient data, passwords, or
keys (see [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md)).

```
                         ┌──────── Caddy (80/443, auto-TLS) ────────┐
   browser  ──HTTPS──►   │  /api/*  → api : 3000                     │
   (PWA)                 │  /*      → web : 3000 (SvelteKit)         │
                         └────────────┬───────────────┬─────────────┘
                                      │               │
                              Postgres 16        MinIO (S3)
                          (append-only records) (blob ciphertext)
```

## What gets created

| Service       | Role                                                                 |
| ------------- | -------------------------------------------------------------------- |
| `caddy`       | Reverse proxy, automatic HTTPS, security headers, gzip/zstd, HTTP/3  |
| `web`         | SvelteKit PWA (adapter-node) — see **Web adapter** below             |
| `api`         | Fastify blind sync + blob store; connects as least-privilege DB role |
| `postgres`    | Append-only record store; init creates the `aidlog_app` role         |
| `migrate`     | One-shot: applies SQL migrations as the privileged owner, then exits |
| `minio`       | S3-compatible object storage for opaque blob ciphertext              |
| `minio-setup` | One-shot: creates the `S3_BUCKET`, then exits                        |

---

## 1. Prerequisites

- A Linux host with **Docker Engine 24+** and the **Docker Compose v2** plugin
  (`docker compose version`).
- A **domain name** with an A/AAAA record pointing at the host's public IP
  (required for a real Let's Encrypt certificate). Ports **80** and **443** must
  be reachable from the internet for the ACME HTTP/TLS challenge.
- Outbound HTTPS so Caddy can reach Let's Encrypt.

> Local testing without a domain: set `AIDLOG_DOMAIN=localhost` in `.env` and
> Caddy will issue an internal self-signed certificate.

All commands below are run **from the monorepo root** (the directory containing
`apps/`, `packages/`, `infra/`).

---

## 2. Configure

```bash
cp infra/.env.example infra/.env
```

Edit `infra/.env`. **Generate a strong, unique secret for every
`*_PASSWORD` / `*_SECRET`** — do not keep the placeholders:

```bash
# one value per secret; run once per field
openssl rand -base64 36
```

Fill in at least:

- `AIDLOG_DOMAIN`, `ACME_EMAIL`, `CORS_ORIGIN`
- `POSTGRES_PASSWORD`, `AIDLOG_APP_DB_PASSWORD`
- `MINIO_ROOT_PASSWORD`
- `SESSION_SECRET`

`infra/.env` is git-ignored. Keep it `chmod 600` and out of version control.

---

## 3. Bring it up

```bash
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

Order is handled by health checks and `depends_on`:

1. `postgres` + `minio` start and become healthy.
2. `migrate` applies the schema, append-only trigger, and least-privilege grants,
   then exits 0.
3. `minio-setup` creates the bucket, then exits 0.
4. `api` and `web` start; `caddy` fronts them and obtains a certificate.

Check status and logs:

```bash
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs -f caddy api web
```

Verify health (from the host):

```bash
curl -fsS https://$AIDLOG_DOMAIN/api/health   # -> {"status":"ok",...}
```

> First certificate issuance can take a few seconds. If it fails, confirm DNS
> resolves to this host and 80/443 are open, then `docker compose logs caddy`.
> While testing, uncomment the staging `acme_ca` line in `Caddyfile` to avoid
> Let's Encrypt rate limits.

---

## 4. First-run organisation setup

Aidlog has no server-side admin account — trust lives entirely in client-held
keys. After the stack is up:

1. Open `https://$AIDLOG_DOMAIN/` and install the PWA.
2. Create the **organisation**: choose a strong **org password**. The browser
   generates the org keypairs, derives a wrapping key from the password
   (Argon2id), and uploads only the **public** keys + the **password-wrapped**
   secret keys via `POST /api/orgs`. The server stores opaque ciphertext.
3. **Write the org password down and store it safely.** Losing it loses all data
   — the server cannot recover it (that is the design). Optionally configure a
   recovery wrapper (`recoveryWrappers`) per the architecture doc.
4. Register **helpers** (each gets their own password-protected keypair) and load
   a protocol **schema** (`SchemaDefinition`). Helpers can then document in the
   field; only the org lead can read the archive back.

---

## 5. Backups

Backups contain **ciphertext only** (great for GDPR — a leaked backup exposes no
readable patient data) but must still be encrypted at rest and access-controlled.

```bash
# Dump Postgres + mirror the MinIO bucket into ./backups/<timestamp>/
./infra/scripts/backup.sh

# Restore a specific backup (DESTRUCTIVE — overwrites current data)
./infra/scripts/restore.sh ./backups/20260101T000000Z
```

Recommended: schedule `backup.sh` (cron/systemd timer), then push each backup
**off-site, separately encrypted** (e.g. `age`/`gpg`, or `restic` to an object
store). Apply a retention policy — don't keep dumps indefinitely.

For the manual, copy-pasteable `pg_dump`/`pg_restore` + `mc mirror` runbook —
including restore-test steps and the critical note that the **org key / Shamir
recovery shares are NOT in backups** and must be safeguarded separately — see
[`BACKUP.md`](./BACKUP.md).

---

## 6. Updating

```bash
git pull
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d --build
```

The images rebuild from the pulled source; `migrate` re-runs and applies any new
SQL migrations idempotently (already-applied files are skipped). Take a backup
before updating production.

---

## Web adapter (assumption to confirm)

`apps/web` did not exist when this infra was written. The setup **assumes the web
app is SvelteKit with `@sveltejs/adapter-node`**, producing `apps/web/build` run
with `node build`. Two supported wirings:

- **adapter-node (default here):** `apps/web/Dockerfile` builds and runs the Node
  server; Caddy reverse-proxies `/*` to `web:3000`. No changes needed.
- **adapter-static:** if the web app outputs a static site instead, you don't
  need the `web` container. Build the static files, mount them into Caddy, and
  replace the `handle { reverse_proxy web:3000 }` block with
  `handle { root * /srv; try_files {path} /index.html; file_server }` plus a
  volume for the built `build/` directory.

**Owners to confirm:** the chosen SvelteKit adapter and the start command
(`node build`). Adjust `apps/web/Dockerfile` + `Caddyfile` if it differs.

## Roles / DB assumptions (to confirm)

- The migration (`apps/api/src/db/migrations/0001_init.sql`) creates `aidlog_app`
  with `LOGIN` but **no password**. The Postgres init script
  (`postgres-init/10-create-roles.sh`) pre-creates `aidlog_app` **with** the
  `AIDLOG_APP_DB_PASSWORD`, so the migration's `IF NOT EXISTS` guard skips
  re-creation and only applies GRANTs. The running `api` connects as
  `aidlog_app` (INSERT/SELECT on `records` only); migrations run as the
  superuser/owner via `MIGRATION_DATABASE_URL`.
- The init script also enables the `pgcrypto` extension for `gen_random_uuid()`.

---

## Hardening checklist

- [ ] **Firewall:** allow only 80/443 (and SSH) inbound. Postgres (5432) and
      MinIO (9000/9001) are **not** published in `docker-compose.yml` — they live
      on the internal Docker network only. The dev override publishes them to
      loopback for local work; never use it on a public host.
- [ ] **MinIO console (9001):** keep it off the public internet. Access it via an
      SSH tunnel if needed. Consider a **scoped MinIO service account** limited to
      the blob bucket and use that for `S3_ACCESS_KEY`/`S3_SECRET_KEY` instead of
      the root credentials.
- [ ] **TLS:** confirm HSTS is acceptable for your domain (it's sticky in
      browsers). Caddy auto-renews certs; persist `caddy-data` (it is a named
      volume here).
- [ ] **Rate limiting:** the api enforces `@fastify/rate-limit`
      (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`). Tune for your fleet size. Add an
      external fail2ban/CrowdSec layer on the proxy logs if you want IP bans for
      abusive clients.
- [ ] **Secrets:** unique, high-entropy values for every credential; rotate
      `SESSION_SECRET` periodically (invalidates active sessions). Store `.env`
      with `chmod 600`; consider Docker/host secret management instead of a file.
- [ ] **Backups:** automated, off-site, **encrypted at rest**, access-controlled,
      with a tested restore and a retention limit.
- [ ] **Log retention / GDPR minimisation:** the api **redacts** secret-bearing
      fields and never logs request bodies. Keep `LOG_LEVEL=info` or higher, ship
      logs to a store with **short retention**, and avoid persisting access logs
      longer than you need. Caddy access logs go to stdout (Docker) — cap Docker
      log size (e.g. `--log-opt max-size=10m --log-opt max-file=3`).
- [ ] **Updates:** keep base images current (`postgres:16`, `caddy:2`,
      `minio`, `node:20`); rebuild regularly for security patches.
- [ ] **Org password:** the single most important secret in the whole system and
      it never reaches the server. Make sure operators understand recovery is
      impossible without it (or a configured recovery wrapper).

> ⚠️ Before processing real patient data, the cryptography and GDPR posture must
> pass an independent security and data-protection review (see root `README.md`).

```

```
