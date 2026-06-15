# @aidlog/api

The Aidlog server: a **blind, append-only sync + blob store** for an
end-to-end-encrypted emergency-medical documentation app. It stores ciphertext
and minimal routing metadata, verifies integrity (signatures + hash chain), and
enforces immutability — **without ever being able to read protocol content.**

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the full design.

## Stack

Node 20+ · Fastify 5 · Postgres (Drizzle ORM + `postgres`) · MinIO/S3
(`@aws-sdk/client-s3`) · Zod validation · Pino logging.

## Run

```bash
# from the monorepo root
corepack pnpm install

# 1. Bring up Postgres + MinIO (your own docker-compose, or hosted).
# 2. Configure env:
cp apps/api/.env.example apps/api/.env   # then edit

# 3. Apply migrations as a PRIVILEGED db role (creates the least-privilege
#    aidlog_app role + the append-only trigger/grants):
MIGRATION_DATABASE_URL=postgres://owner:pw@host/db pnpm --filter @aidlog/api migrate

# 4. Start (connects as the restricted aidlog_app role via DATABASE_URL):
pnpm --filter @aidlog/api dev      # tsx watch
# or
pnpm --filter @aidlog/api build && pnpm --filter @aidlog/api start
```

### Scripts

| script      | what                                           |
| ----------- | ---------------------------------------------- |
| `dev`       | `tsx watch src/server.ts`                      |
| `build`     | `tsc` → `dist/`                                |
| `start`     | `node dist/server.js`                          |
| `migrate`   | apply `src/db/migrations/*.sql` (run as owner) |
| `test`      | `vitest run`                                   |
| `typecheck` | `tsc --noEmit`                                 |
| `lint`      | (handled at root)                              |

## Environment

All config comes from env (validated by Zod at boot — the server refuses to
start on bad config). See [`.env.example`](./.env.example). Keys:

`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `CORS_ORIGIN`, `SESSION_SECRET`,
`SESSION_TTL_SECONDS`, `CHALLENGE_TTL_SECONDS`, `S3_ENDPOINT`, `S3_REGION`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_FORCE_PATH_STYLE`,
`BLOB_TICKET_TTL_SECONDS`, `BLOB_MAX_BYTES`, `PORT`, `HOST`, `RATE_LIMIT_MAX`,
`RATE_LIMIT_WINDOW`, `LOG_LEVEL`.

## Routes

All paths come from `ROUTES` in `@aidlog/contracts`:

| route                   | method | auth    | purpose                                   |
| ----------------------- | ------ | ------- | ----------------------------------------- |
| `/api/health`           | GET    | none    | liveness                                  |
| `/api/orgs`             | POST   | none    | register org (public id + wrapped secret) |
| `/api/helpers`          | POST   | none    | register helper                           |
| `/api/auth/challenge`   | POST   | none    | issue proof-of-possession challenge       |
| `/api/auth/verify`      | POST   | none    | verify Ed25519 sig → session token        |
| `/api/records`          | POST   | session | append immutable, hash-chained record     |
| `/api/blobs/ticket`     | POST   | session | presigned PUT (MinIO) upload ticket       |
| `/api/blobs/ticket/:id` | PUT    | session | direct-upload fallback (opaque bytes)     |
| `/api/sync`             | GET    | session | cursor-based, role-scoped record sync     |
| `/api/schemas`          | GET    | session | list form schemas; POST = org-admin only  |
| `/api/shifts/close`     | POST   | session | soft-revoke helper DEK wrappers           |

## The append-only guarantee

`records` is immutable, enforced at **two independent layers**:

1. **Trigger** — a `BEFORE UPDATE OR DELETE` trigger on `records`
   (`records_reject_mutation`) `RAISE`s an exception, aborting any mutation.
   Corrections are made by **appending** a new record with `supersedes` set,
   never by editing.
2. **Least-privilege role** — the app connects as `aidlog_app`, which is granted
   only `INSERT, SELECT` on `records` (no `UPDATE`/`DELETE` privilege at all).

Either layer alone blocks mutation; together they are defence in depth. A unique
constraint on `(deployment_id, seq)` plus the client-computed `prevHash` chain
make the history verifiable offline.

DEK wrappers live in a **separate** `sealed_keys` table precisely so the
shift-close "soft revocation" can `DELETE` a helper's wrappers **without
touching** any immutable record.

## What the server CAN and CANNOT see

**Can see (routing metadata + ciphertext, never interpreted):**

- Org / helper **public** identities (box + sign public keys) and the
  **password-wrapped** secret-key blobs (opaque — never unwrappable here).
- Record ids, `deploymentId`, `seq`, `createdAt`, `authorKeyId`, `prevHash`,
  `recordHash`, `signature`, algorithm pins, server `receivedAt`.
- Blob descriptors (id, size, ciphertext hash, media type) and the opaque blob
  ciphertext bytes in MinIO.
- Sealed-DEK ciphertexts (who a DEK is sealed _to_, but not the DEK itself).

**Cannot see (and never receives):**

- Plaintext protocol payloads (form data).
- Data-encryption keys (DEKs).
- Org / helper passwords.
- Unwrapped (plaintext) secret keys.
- Decrypted attachment contents.

The server **verifies** signatures and the hash chain using only public keys and
hashes — integrity without readability. Pino logging **redacts** any field that
could carry a secret (`payload`, `wrappedSecret`, `ciphertext`, `dek`,
`*SecretKey`, `password`, `token`, auth headers — see `REDACT_PATHS` in
`src/app.ts`), and request bodies are never attached to logs.

### Honest limitation (soft revocation)

Shift-close removes a helper's _future_ decryption capability by deleting their
DEK wrappers. It **cannot** erase what a helper already viewed or copied while
the shift was open — inherent to client-side decryption (ARCHITECTURE.md §5).

## Crypto boundary

This package performs **no** content cryptography. Signature verification goes
through `@aidlog/crypto-core` (`crypto.verify` / `crypto.verifyRecord`). It never
imports a crypto primitive library directly — the crypto-lint CI gate enforces
this.

## Tests

`pnpm --filter @aidlog/api test`

- **Offline unit tests** always run: session-token tamper-evidence, log
  redaction config, and a contract test asserting the migration ships the
  append-only trigger + least-privilege grants.
- **Integration tests** (`test/integration.test.ts`) run only when
  `TEST_DATABASE_URL` points at a privileged Postgres; otherwise they skip with a
  clear message. They cover: append-only UPDATE/DELETE rejection, hash-chain
  rejection (wrong `prevHash` → 409), challenge/verify happy path + bad-signature
  rejection, and closeShift deleting only helper wrappers.
