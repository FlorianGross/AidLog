# @aidlog/web

The Aidlog client: an **offline-first, zero-knowledge PWA** for documenting
emergency-medical / first-aid deployments in the field. Built with **SvelteKit
(Svelte 5)**, **Vite**, **TailwindCSS**, and `@vite-pwa/sveltekit`.

> **No plaintext ever leaves this client.** All encryption, decryption, signing,
> and hash-chaining happen on-device via `@aidlog/crypto-core`. The server is a
> blind append-only sync + blob store: it receives only ciphertext and
> non-sensitive routing metadata (ids, sequence numbers, signatures, hashes).
> It can verify integrity but can never read a patient record, a data key, a
> password, or a secret key. See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Run

From the monorepo root (`G:\Einsatzprotokoll`):

```bash
corepack pnpm install
corepack pnpm --filter @aidlog/web dev        # dev server (http://localhost:5173)
corepack pnpm --filter @aidlog/web build       # production build (static + service worker)
corepack pnpm --filter @aidlog/web preview      # preview the production build
corepack pnpm --filter @aidlog/web test         # vitest
corepack pnpm --filter @aidlog/web typecheck    # svelte-check
```

Point the client at an API with `VITE_API_BASE_URL` (defaults to same-origin, so
in production the PWA is served alongside `@aidlog/api`).

## Design

### Offline-first

- The app shell is a **static** bundle (`adapter-static`, SPA fallback) precached
  by a service worker, so the client boots and works with no connectivity.
- Records created offline are validated, encrypted, and **queued in an
  IndexedDB-backed outbox** (`src/lib/store/outbox.ts`). When connectivity
  returns, the outbox **flushes** to the API (blobs first, then the record) and
  pulls new records via `ROUTES.sync` (`src/lib/store/sync.ts`).
- Reactive Svelte stores (`src/lib/store/stores.ts`) expose connectivity, the
  outbox depth, the lock state, and the deployment list to the UI.
- **At rest in IndexedDB we store only ciphertext** (`ProtocolRecord`s, encrypted
  blob bodies) and the password-**wrapped** secret key. Never plaintext, never an
  unwrapped key, never a password. `localStorage` holds nothing sensitive; the
  session token lives in memory / `sessionStorage` at most.

### Dynamic, configurable protocol fields

The data-entry form is **rendered dynamically from a JSON-Schema** (draft
2020-12) + `uiSchema`, carried by a `SchemaDefinition`:

- `src/lib/forms/SchemaForm.svelte` renders text / number / select / date /
  boolean / textarea / **image-capture** inputs straight from the schema.
- `src/lib/forms/validate.ts` validates the collected data against the schema
  with **AJV — before encryption**. Invalid data is never encrypted or queued.
- `src/lib/forms/example-schema.ts` is a realistic **starter template** for a
  sanitary patient contact (timestamp, location, pseudonym/age-band/sex,
  complaint, vitals [RR/HF/SpO2/BZ/GCS/AVPU], measures, handover, free text).

**Adding a protocol field requires only editing a schema** — no component
changes. New fields → a new schema version; existing records keep their
`schemaVersion`, so old data stays renderable.

### Crypto wrapper (`src/lib/crypto/`)

A thin client wrapper around `@aidlog/crypto-core` (the only package allowed to
touch a crypto primitive):

- `session.ts` — unlock the identity from the password (Argon2id → unwrap),
  hold the unwrapped keys **in memory only**, and **wipe on lock/logout**.
- `record.ts` — `buildRecord()` generates a per-record DEK, encrypts the payload
  - image blobs, **seals the DEK to the org public key (always) and the helper
    public key (while the shift is open)**, computes `prevHash` from the local
    chain head, hashes, and signs. `decryptRecord()` opens a record for display.

### Auth (`src/lib/api.ts`)

Proof-of-possession: the server issues a challenge, the client **signs it with
the in-memory Ed25519 key** and posts the signature; the server returns a
short-lived session token. **No password is ever sent.**

## Build note: libsodium ESM workaround

The published ESM build of `libsodium-wrappers-sumo@0.7.16` is broken (it imports
a sibling `libsodium-sumo.mjs` that the package does not ship). `vite.config.ts`
aliases the bare import to the working **CJS** entry (mirroring
`packages/crypto-core/vitest.config.ts`) and keeps it bundled via
`ssr.noExternal` / `optimizeDeps.include`. The library is import-style-agnostic
at runtime, so this is safe.

## Enforced boundaries

- No direct crypto-primitive imports — everything routes through
  `@aidlog/crypto-core`.
- No plaintext / DEK / password / secret key persisted to `localStorage` or sent
  to the server. Sensitive material is memory-only or encrypted-at-rest in
  IndexedDB.
- Accessibility: large touch targets (gloves), labelled controls, visible focus,
  one-handed phone layout.

## Tests

`vitest` covers: the dynamic form renders + validates the example schema
(rejects invalid, accepts valid), the crypto wrapper round-trips a record (build
→ decrypt, incl. a blob) through `@aidlog/crypto-core`, and the outbox queue
persists and flushes against a mocked API.

## Branding

`src/lib/branding.ts` is the single source of branding (name, colors, logo) and
is intentionally **neutral / vendor-agnostic** — not tied to any specific aid
organisation. Re-skin the whole client by editing that one file. Icons in
`static/icons/` are neutral placeholders; replace with real assets.
