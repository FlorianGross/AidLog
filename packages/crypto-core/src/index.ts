/**
 * @aidlog/crypto-core
 * -------------------
 * The ONLY package permitted to import a crypto primitive library
 * (`libsodium-wrappers-sumo`). `api` and `web` consume this module; they must
 * never import a crypto primitive directly (enforced by the crypto-lint gate).
 *
 * This file implements the {@link CryptoCore} interface defined in
 * `./interface.ts`, using the algorithms pinned by `@aidlog/contracts`:
 *
 *   | concern              | primitive                                   |
 *   | -------------------- | ------------------------------------------- |
 *   | password → key (KDF) | Argon2id (`crypto_pwhash`, ALG_ARGON2ID13)  |
 *   | DEK / payload AEAD   | XChaCha20-Poly1305 IETF                      |
 *   | blob AEAD (chunked)  | secretstream XChaCha20-Poly1305             |
 *   | DEK wrapping         | crypto_box_seal (X25519 anonymous sealed box)|
 *   | signatures           | Ed25519 (detached)                          |
 *   | hashing / chaining   | BLAKE2b-256 (`crypto_generichash`)          |
 *
 * ===========================================================================
 * CONTRACT-NOTE (authorKeyId / signing-pubkey convention) — READ THIS
 * ===========================================================================
 * `@aidlog/contracts` defines `KeyId` as "base64 of the public key, or a stable
 * hash thereof" and `PublicIdentity.keyId` is that opaque id. A `ProtocolRecord`
 * carries only `authorKeyId` (the *signing* identity id) — NOT the raw signing
 * public key. To verify a signature you need the actual Ed25519 public key.
 *
 * `verifyRecord(record, expectedPrevHash)` as written in the interface takes no
 * signing public key. We therefore adopt the SIMPLEST consistent convention:
 *
 *   PublicIdentity.keyId === base64(signPublicKey)   (standard, padded base64)
 *
 * i.e. an identity's `keyId` IS the base64 of its Ed25519 signing public key.
 * `toPublicIdentity` produces ids this way, so any record whose `authorKeyId`
 * came from a `PublicIdentity` we minted can be verified by base64-decoding
 * `authorKeyId` back into the signing public key. `verifyRecord` does exactly
 * that.
 *
 * If the contracts owner later switches `keyId` to a *hash* of the key (so the
 * pubkey can no longer be recovered from the id), `verifyRecord` can no longer
 * self-source the key. For that future, an OPTIONAL third parameter
 * `signPublicKey?: Uint8Array` is accepted: when supplied it overrides the
 * decode-from-keyId path. This keeps the mandated 2-arg call site working today
 * while leaving a clean upgrade path. The contracts owner must reconcile the
 * `keyId` convention with this note.
 * ===========================================================================
 *
 * Memory hygiene: we `sodium.memzero` derived symmetric keys and unwrapped
 * secret keys once we are done with them, where the lifetime is fully under our
 * control. We CANNOT zero:
 *   - secret keys we *return* to the caller (IdentityKeyPair, opened DEKs) —
 *     their lifetime belongs to the caller; the caller must zero them.
 *   - intermediate JS strings (passwords, base64) — JS strings are immutable
 *     and not zeroable; minimising their lifetime is the best we can do.
 * These limits are inherent to a managed runtime and are documented here.
 */

/**
 * The published ESM build of `libsodium-wrappers-sumo` is broken: its
 * `dist/modules-sumo-esm/libsodium-wrappers.mjs` imports a sibling
 * `./libsodium-sumo.mjs` that the package does NOT ship (only the CommonJS build
 * is complete). A top-level static ESM import therefore crashes under plain Node
 * at runtime (e.g. the api server: ERR_MODULE_NOT_FOUND). Bundlers (Vite) alias
 * the bare specifier to the complete CJS build; under Node we load that same CJS
 * build via `createRequire`. Hence libsodium is loaded LAZILY in `ready()`.
 */
type SodiumApi = typeof import('libsodium-wrappers-sumo');
let sodium!: SodiumApi;
let sodiumLoaded = false;

async function loadSodium(): Promise<SodiumApi> {
  const g = globalThis as { process?: { versions?: { node?: string } } };
  if (g.process?.versions?.node) {
    // Node: force the package's `require` condition -> complete CJS build.
    // Variable specifier keeps TS from resolving (no @types/node needed) and
    // keeps Vite from bundling node:module into the browser graph.
    const nodeModuleSpecifier = 'node:module';
    const { createRequire } = (await import(nodeModuleSpecifier)) as {
      createRequire: (path: string) => (id: string) => unknown;
    };
    const require = createRequire(import.meta.url);
    return require('libsodium-wrappers-sumo') as SodiumApi;
  }
  // Browser/bundler: Vite aliases the bare specifier to the complete CJS build.
  const mod = (await import('libsodium-wrappers-sumo')) as SodiumApi & {
    default?: SodiumApi;
  };
  return mod.default ?? mod;
}
import {
  ALGORITHMS,
  ENVELOPE_VERSION,
  type AeadAlg,
  type KdfParams,
  type ProtocolRecord,
  type PublicIdentity,
  type SealedKey,
  type SignableRecord,
  type WrappedSecretKey,
} from '@aidlog/contracts';

import type {
  AeadCiphertext,
  CryptoCore,
  IdentityKeyPair,
  KeyPair,
  ShamirShare,
} from './interface.js';

export type {
  AeadCiphertext,
  CryptoCore,
  IdentityKeyPair,
  KeyPair,
  ShamirShare,
} from './interface.js';

/**
 * The public crypto-core surface. Structurally a superset of {@link CryptoCore}
 * — every method matches the pinned interface signatures EXACTLY — but it
 * surfaces the optional `signPublicKey` override on `verifyRecord` so callers
 * can type-safely use the forward-compat path described in the file header
 * CONTRACT-NOTE. Because the extra parameter is optional, this still satisfies
 * `CryptoCore` and the mandated 2-arg call site keeps working unchanged.
 */
export interface CryptoCoreExt extends Omit<CryptoCore, 'verifyRecord'> {
  verifyRecord(
    record: ProtocolRecord,
    expectedPrevHash: string | null,
    signPublicKey?: Uint8Array,
  ): boolean;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/** Base class for all errors thrown by crypto-core. Never carries secrets. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * Thrown when an AEAD/sealed-box authentication tag fails to verify. For
 * `unwrapIdentity` this almost always means a WRONG PASSWORD (or corrupted /
 * tampered ciphertext). The message intentionally contains no secret material.
 */
export class DecryptionError extends CryptoError {
  constructor(message = 'authentication failed (wrong password or corrupted ciphertext)') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Thrown when `ready()` has not completed before a primitive is used. */
export class NotReadyError extends CryptoError {
  constructor() {
    super('crypto-core not initialised — await crypto.ready() first');
    this.name = 'NotReadyError';
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const AEAD_ALG: AeadAlg = ALGORITHMS.aead; // 'xchacha20poly1305-ietf'

/**
 * The expected raw-key length for {@link CryptoCoreImpl.wrapIdentityWithKey} —
 * 32 bytes, the XChaCha20-Poly1305 key size (also a WebAuthn PRF output size).
 */
const RAW_WRAP_KEYBYTES = 32;

/**
 * PASSTHROUGH-KDF sentinel marking a {@link WrappedSecretKey} that was sealed
 * with a RAW key (no Argon2). The combination opsLimit=0, memLimit=0, salt=''
 * is impossible for a real Argon2id wrap (Argon2 needs a non-empty salt and
 * positive limits), so it unambiguously flags a key-wrap vs a password-wrap.
 * Code that must distinguish the two checks `isPassthroughKdf(wrapped.kdf)`.
 */
function passthroughKdf(): KdfParams {
  return { alg: ALGORITHMS.kdf, salt: '', opsLimit: 0, memLimit: 0 };
}

/** True iff `kdf` is the raw-key passthrough sentinel (see {@link passthroughKdf}). */
function isPassthroughKdf(kdf: KdfParams): boolean {
  return kdf.salt === '' && kdf.opsLimit === 0 && kdf.memLimit === 0;
}

let initialised = false;

function assertReady(): void {
  if (!initialised) throw new NotReadyError();
}

/** Standard padded base64, matching the contracts' "all binary is base64" rule. */
function b64(bytes: Uint8Array): string {
  return sodium.to_base64(bytes, sodium.base64_variants.ORIGINAL);
}
function unb64(s: string): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.ORIGINAL);
}

/**
 * Wrapped-secret plaintext layout. We serialise the two secret keys as a small
 * JSON object of base64 strings. Self-describing and stable; the whole blob is
 * AEAD-protected, so it never appears outside this module in the clear.
 */
interface SecretKeyBundle {
  v: 1;
  boxSecretKey: string; // base64
  signSecretKey: string; // base64
}

/**
 * Deterministic serialization of an identity's secret keys → bundle bytes.
 * This is the SINGLE source of truth for the on-disk/on-wire secret layout:
 * `wrapIdentity` AEAD-encrypts exactly these bytes, and `exportIdentitySecret`
 * returns exactly these bytes, so wrap/unwrap and export/split/combine/import
 * round-trips are byte-for-byte consistent.
 */
function serializeIdentitySecret(id: IdentityKeyPair): Uint8Array {
  const bundle: SecretKeyBundle = {
    v: 1,
    boxSecretKey: b64(id.box.secretKey),
    signSecretKey: b64(id.sign.secretKey),
  };
  return sodium.from_string(JSON.stringify(bundle));
}

/**
 * Inverse of {@link serializeIdentitySecret}. Re-derives the public keys from
 * the secret keys so the returned IdentityKeyPair is complete and self-checking.
 */
function deserializeIdentitySecret(bytes: Uint8Array): IdentityKeyPair {
  let bundle: SecretKeyBundle;
  try {
    bundle = JSON.parse(sodium.to_string(bytes)) as SecretKeyBundle;
  } catch {
    throw new CryptoError('importIdentitySecret: malformed identity-secret bytes');
  }
  if (bundle.v !== 1) {
    throw new CryptoError(`importIdentitySecret: unsupported bundle version ${bundle.v}`);
  }
  const boxSecretKey = unb64(bundle.boxSecretKey);
  const signSecretKey = unb64(bundle.signSecretKey);
  const boxPublicKey = sodium.crypto_scalarmult_base(boxSecretKey);
  const signPublicKey = sodium.crypto_sign_ed25519_sk_to_pk(signSecretKey);
  return {
    box: { publicKey: boxPublicKey, secretKey: boxSecretKey },
    sign: { publicKey: signPublicKey, secretKey: signSecretKey },
  };
}

// ===========================================================================
// Shamir secret sharing over GF(256)
// ===========================================================================
//
// We share a secret BYTEWISE: for each byte of the secret we build a random
// degree-(threshold-1) polynomial over GF(2^8) whose constant term is that
// byte, then evaluate it at each share's distinct x-index. `threshold` points
// uniquely determine the polynomial (Lagrange), so any `threshold` shares
// recover every constant term = the secret; `threshold-1` points leave the
// constant term information-theoretically undetermined.
//
// GF(256) is the AES field: reduction polynomial x^8 + x^4 + x^3 + x + 1 (0x11b).
// We use precomputed exp/log tables (generator 0x03) for constant-time-free but
// correct multiply/inverse. These tables hold no secret and are derived once.
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    // multiply x by the generator 0x03 in GF(256): x = x*2 ^ x, reduce by 0x11b.
    let next = x ^ ((x << 1) & 0xff);
    if (x & 0x80) next ^= 0x1b; // the (x<<1) overflow bit folds in 0x1b (0x11b w/o x^8)
    x = next & 0xff;
  }
  // duplicate the exp table so we can index up to 2*254 without modulo wrap.
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/** Multiplicative inverse in GF(256). `a` must be non-zero. */
function gfInv(a: number): number {
  // a^(254) = a^(-1) in GF(256). Via logs: exp(255 - log a).
  return GF_EXP[255 - GF_LOG[a]!]!;
}

/** Evaluate a polynomial (coeffs[0] = constant term) at `x` over GF(256). */
function gfPolyEval(coeffs: Uint8Array, x: number): number {
  // Horner's method from the highest-degree coefficient down.
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = gfMul(acc, x) ^ coeffs[i]!;
  }
  return acc;
}

// ===========================================================================
// Canonical JSON
// ===========================================================================
//
// Signatures depend on byte-for-byte reproducibility of the canonical form, so
// this serialiser must be deterministic and platform-independent. It does NOT
// rely on `JSON.stringify`'s key ordering. Rules:
//
//   - Objects: keys sorted ascending by UTF-16 code unit (JS default string
//     compare, identical on every platform), each serialised key:value joined
//     by ',' inside '{}'. `undefined`-valued properties are OMITTED (matching
//     JSON.stringify semantics) so optional fields like `supersedes` don't
//     change the hash when absent.
//   - Arrays: '[' + elements (in order) + ']'.
//   - Strings: JSON string escaping via JSON.stringify (RFC 8259 compliant and
//     deterministic for a given input).
//   - Numbers: must be finite; serialised with `String(n)` which yields the
//     shortest round-trippable decimal (ECMAScript Number-to-String, stable
//     across engines). NaN/Infinity are rejected.
//   - Booleans / null: literal `true` / `false` / `null`.
//   - The output is UTF-8 encoded bytes.
//
// This is intentionally a small, auditable serialiser rather than a dependency.
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'string') return JSON.stringify(value);

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new CryptoError('canonicalize: non-finite number is not serialisable');
    }
    return String(value as number);
  }

  if (t === 'boolean') return (value as boolean) ? 'true' : 'false';

  if (t === 'bigint') {
    // BigInt has no JSON representation; reject rather than guess.
    throw new CryptoError('canonicalize: bigint is not serialisable');
  }

  if (Array.isArray(value)) {
    return '[' + value.map((el) => canonicalJson(el)).join(',') + ']';
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue; // omit, like JSON.stringify
      parts.push(JSON.stringify(k) + ':' + canonicalJson(v));
    }
    return '{' + parts.join(',') + '}';
  }

  // undefined / function / symbol at the top level are not valid record fields.
  throw new CryptoError(`canonicalize: unsupported value of type ${t}`);
}

// ===========================================================================
// Implementation
// ===========================================================================

class CryptoCoreImpl implements CryptoCoreExt {
  // --- lifecycle ---------------------------------------------------------

  async ready(): Promise<void> {
    if (!sodiumLoaded) {
      sodium = await loadSodium();
      sodiumLoaded = true;
    }
    await sodium.ready;
    initialised = true;
  }

  // --- identity ----------------------------------------------------------

  generateIdentity(): IdentityKeyPair {
    assertReady();
    const box = sodium.crypto_box_keypair();
    const sign = sodium.crypto_sign_keypair();
    return {
      box: { publicKey: box.publicKey, secretKey: box.privateKey },
      sign: { publicKey: sign.publicKey, secretKey: sign.privateKey },
    };
  }

  toPublicIdentity(id: IdentityKeyPair): PublicIdentity {
    assertReady();
    // CONTRACT-NOTE: keyId === base64(signPublicKey). See file header.
    return {
      keyId: b64(id.sign.publicKey),
      boxPublicKey: b64(id.box.publicKey),
      signPublicKey: b64(id.sign.publicKey),
    };
  }

  // --- KDF / password-based protection -----------------------------------

  defaultKdfParams(): KdfParams {
    assertReady();
    // INTERACTIVE limits are the documented floor; we use MODERATE for a
    // stronger default at rest (org/helper unlock is not a hot path). Both are
    // >= INTERACTIVE as required.
    return {
      alg: ALGORITHMS.kdf, // 'argon2id'
      salt: b64(sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES)),
      opsLimit: sodium.crypto_pwhash_OPSLIMIT_MODERATE,
      memLimit: sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    };
  }

  async deriveKey(password: string, params: KdfParams): Promise<Uint8Array> {
    assertReady();
    const salt = unb64(params.salt);
    if (salt.length !== sodium.crypto_pwhash_SALTBYTES) {
      throw new CryptoError(
        `deriveKey: salt must be ${sodium.crypto_pwhash_SALTBYTES} bytes, got ${salt.length}`,
      );
    }
    // 32-byte key for XChaCha20-Poly1305.
    return sodium.crypto_pwhash(
      sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES,
      password,
      salt,
      params.opsLimit,
      params.memLimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  }

  async wrapIdentity(
    id: IdentityKeyPair,
    password: string,
    params?: KdfParams,
  ): Promise<WrappedSecretKey> {
    assertReady();
    const kdf = params ?? this.defaultKdfParams();
    const key = await this.deriveKey(password, kdf);

    // SAME serialization `exportIdentitySecret` uses, so wrap/unwrap and
    // export/split/combine/import agree byte-for-byte.
    const plaintext = serializeIdentitySecret(id);
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      null, // no additional data
      null, // no secret nonce
      nonce,
      key,
    );

    sodium.memzero(key);
    sodium.memzero(plaintext);

    return {
      alg: AEAD_ALG,
      kdf,
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
    };
  }

  async unwrapIdentity(wrapped: WrappedSecretKey, password: string): Promise<IdentityKeyPair> {
    assertReady();
    const key = await this.deriveKey(password, wrapped.kdf);
    const nonce = unb64(wrapped.nonce);
    const ciphertext = unb64(wrapped.ciphertext);

    let plaintext: Uint8Array;
    try {
      plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null, // no secret nonce
        ciphertext,
        null, // no additional data
        nonce,
        key,
      );
    } catch {
      sodium.memzero(key);
      // Auth failure ⇒ almost certainly the wrong password.
      throw new DecryptionError();
    }
    sodium.memzero(key);

    // Deserialize via the SHARED helper (same layout as exportIdentitySecret),
    // re-deriving public keys from the secret keys. Zero the plaintext after.
    try {
      return deserializeIdentitySecret(plaintext);
    } finally {
      sodium.memzero(plaintext);
    }
  }

  // --- raw-key protection of secret keys (no Argon2) ---------------------

  wrapIdentityWithKey(id: IdentityKeyPair, key: Uint8Array): WrappedSecretKey {
    assertReady();
    if (key.length !== RAW_WRAP_KEYBYTES) {
      throw new CryptoError(
        `wrapIdentityWithKey: key must be ${RAW_WRAP_KEYBYTES} bytes, got ${key.length}`,
      );
    }
    // SAME serialization as wrapIdentity/exportIdentitySecret → byte-identical
    // secrets regardless of how the wrap key was obtained.
    const plaintext = serializeIdentitySecret(id);
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      null,
      null,
      nonce,
      key,
    );
    sodium.memzero(plaintext);
    // NB: we do NOT zero `key` — it is the caller's buffer (its lifetime and
    // any reuse belong to the caller, who must zero it after use).
    return {
      alg: AEAD_ALG,
      kdf: passthroughKdf(), // raw-key sentinel; never an Argon2 wrap
      nonce: b64(nonce),
      ciphertext: b64(ciphertext),
    };
  }

  unwrapIdentityWithKey(wrapped: WrappedSecretKey, key: Uint8Array): IdentityKeyPair {
    assertReady();
    if (!isPassthroughKdf(wrapped.kdf)) {
      // A password (Argon2) wrap reached the raw-key path — refuse rather than
      // silently treating the 32-byte key as if it were an Argon2 output.
      throw new CryptoError(
        'unwrapIdentityWithKey: wrapped secret is password-wrapped (Argon2), not key-wrapped',
      );
    }
    if (key.length !== RAW_WRAP_KEYBYTES) {
      throw new CryptoError(
        `unwrapIdentityWithKey: key must be ${RAW_WRAP_KEYBYTES} bytes, got ${key.length}`,
      );
    }
    const nonce = unb64(wrapped.nonce);
    const ciphertext = unb64(wrapped.ciphertext);

    let plaintext: Uint8Array;
    try {
      plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertext,
        null,
        nonce,
        key,
      );
    } catch {
      throw new DecryptionError();
    }
    try {
      return deserializeIdentitySecret(plaintext);
    } finally {
      sodium.memzero(plaintext);
    }
  }

  // --- identity (secret) export / import ---------------------------------

  exportIdentitySecret(id: IdentityKeyPair): Uint8Array {
    assertReady();
    return serializeIdentitySecret(id);
  }

  importIdentitySecret(bytes: Uint8Array): IdentityKeyPair {
    assertReady();
    return deserializeIdentitySecret(bytes);
  }

  // --- Shamir secret sharing (GF(256)) -----------------------------------

  splitSecret(secret: Uint8Array, shareCount: number, threshold: number): ShamirShare[] {
    assertReady();
    if (!Number.isInteger(shareCount) || !Number.isInteger(threshold)) {
      throw new CryptoError('splitSecret: shareCount and threshold must be integers');
    }
    if (threshold < 2 || shareCount < threshold || shareCount > 255) {
      throw new CryptoError(
        `splitSecret: require 2 <= threshold(${threshold}) <= shareCount(${shareCount}) <= 255`,
      );
    }
    if (secret.length === 0) {
      throw new CryptoError('splitSecret: secret must be non-empty');
    }

    // Distinct x-indices 1..255 (x=0 is reserved for the secret itself).
    const indices: number[] = [];
    for (let i = 1; i <= shareCount; i++) indices.push(i);

    const shares: ShamirShare[] = indices.map((index) => ({
      index,
      data: new Uint8Array(secret.length),
    }));

    // One random degree-(threshold-1) polynomial per secret byte. coeffs[0] is
    // the secret byte; the other (threshold-1) coefficients are random.
    const coeffs = new Uint8Array(threshold);
    for (let bytePos = 0; bytePos < secret.length; bytePos++) {
      coeffs[0] = secret[bytePos]!;
      const randomTail = sodium.randombytes_buf(threshold - 1);
      coeffs.set(randomTail, 1);
      for (let s = 0; s < shares.length; s++) {
        shares[s]!.data[bytePos] = gfPolyEval(coeffs, shares[s]!.index);
      }
      sodium.memzero(randomTail);
    }
    sodium.memzero(coeffs);
    return shares;
  }

  combineSecret(shares: ShamirShare[]): Uint8Array {
    assertReady();
    if (shares.length < 2) {
      throw new CryptoError('combineSecret: need at least 2 shares');
    }
    const len = shares[0]!.data.length;
    const seenIndices = new Set<number>();
    for (const sh of shares) {
      if (sh.index < 1 || sh.index > 255 || !Number.isInteger(sh.index)) {
        throw new CryptoError(`combineSecret: invalid share index ${sh.index}`);
      }
      if (sh.data.length !== len) {
        throw new CryptoError('combineSecret: shares have differing lengths');
      }
      if (seenIndices.has(sh.index)) {
        throw new CryptoError(`combineSecret: duplicate share index ${sh.index}`);
      }
      seenIndices.add(sh.index);
    }

    // Precompute the Lagrange basis weights L_i(0) once (independent of byte).
    //   L_i(0) = Π_{j!=i} x_j / (x_j - x_i)   in GF(256) (subtraction == XOR).
    const xs = shares.map((s) => s.index);
    const weights = new Uint8Array(shares.length);
    for (let i = 0; i < shares.length; i++) {
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (j === i) continue;
        num = gfMul(num, xs[j]!);
        den = gfMul(den, xs[i]! ^ xs[j]!); // x_i - x_j == x_i XOR x_j in GF(2^8)
      }
      weights[i] = gfMul(num, gfInv(den));
    }

    const out = new Uint8Array(len);
    for (let bytePos = 0; bytePos < len; bytePos++) {
      let acc = 0;
      for (let i = 0; i < shares.length; i++) {
        acc ^= gfMul(shares[i]!.data[bytePos]!, weights[i]!);
      }
      out[bytePos] = acc;
    }
    return out;
  }

  // --- human-transferable share encoding ---------------------------------
  //
  // Format (single line, dot-separated):
  //   "aidlog-share.1.<index>.<base64(data)>.<checksum>"
  // where:
  //   - "aidlog-share" is a fixed tag, "1" the encoding version,
  //   - <index> is the decimal x-index (1..255),
  //   - <base64(data)> is the ORIGINAL (padded) base64 of the share bytes,
  //   - <checksum> is the first 4 bytes of BLAKE2b-256 over the canonical
  //     "<index>:<base64(data)>" string, base64url, so a mistyped index OR a
  //     mangled data field is detected on decode (throws on mismatch).

  encodeShare(share: ShamirShare): string {
    assertReady();
    if (share.index < 1 || share.index > 255 || !Number.isInteger(share.index)) {
      throw new CryptoError(`encodeShare: invalid share index ${share.index}`);
    }
    const dataB64 = b64(share.data);
    const checksum = this.shareChecksum(share.index, dataB64);
    return `aidlog-share.1.${share.index}.${dataB64}.${checksum}`;
  }

  decodeShare(text: string): ShamirShare {
    assertReady();
    const parts = text.trim().split('.');
    if (parts.length !== 5 || parts[0] !== 'aidlog-share' || parts[1] !== '1') {
      throw new CryptoError('decodeShare: unrecognised share format');
    }
    const index = Number(parts[2]);
    if (!Number.isInteger(index) || index < 1 || index > 255) {
      throw new CryptoError('decodeShare: invalid share index');
    }
    const dataB64 = parts[3]!;
    const want = parts[4]!;
    const got = this.shareChecksum(index, dataB64);
    if (got !== want) {
      throw new CryptoError('decodeShare: checksum mismatch (share is corrupted or mistyped)');
    }
    let data: Uint8Array;
    try {
      data = unb64(dataB64);
    } catch {
      throw new CryptoError('decodeShare: invalid base64 share data');
    }
    return { index, data };
  }

  /** First 4 bytes of BLAKE2b over "<index>:<dataB64>", base64url. */
  private shareChecksum(index: number, dataB64: string): string {
    const digest = sodium.crypto_generichash(32, this.utf8(`${index}:${dataB64}`), null);
    return sodium.to_base64(digest.subarray(0, 4), sodium.base64_variants.URLSAFE_NO_PADDING);
  }

  // --- per-record data key (DEK) -----------------------------------------

  randomDek(): Uint8Array {
    assertReady();
    return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  }

  sealDek(dek: Uint8Array, recipientBoxPublicKey: Uint8Array): Uint8Array {
    assertReady();
    return sodium.crypto_box_seal(dek, recipientBoxPublicKey);
  }

  openSealedDek(sealed: Uint8Array, recipientBox: KeyPair): Uint8Array {
    assertReady();
    try {
      return sodium.crypto_box_seal_open(sealed, recipientBox.publicKey, recipientBox.secretKey);
    } catch {
      throw new DecryptionError('openSealedDek: sealed box failed to open (wrong key or tampered)');
    }
  }

  buildSealedKeys(
    dek: Uint8Array,
    recipients: { type: 'org' | 'helper'; identity: PublicIdentity }[],
  ): SealedKey[] {
    assertReady();
    return recipients.map(({ type, identity }) => {
      const boxPub = unb64(identity.boxPublicKey);
      const sealed = this.sealDek(dek, boxPub);
      return {
        recipientType: type,
        recipientKeyId: identity.keyId,
        alg: ALGORITHMS.seal, // 'x25519-sealedbox'
        ciphertext: b64(sealed),
      };
    });
  }

  // --- payload (structured JSON) -----------------------------------------

  encryptPayload(plaintext: Uint8Array, dek: Uint8Array): AeadCiphertext {
    assertReady();
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      null,
      null,
      nonce,
      dek,
    );
    return { alg: AEAD_ALG, nonce, ciphertext };
  }

  decryptPayload(ct: AeadCiphertext, dek: Uint8Array): Uint8Array {
    assertReady();
    try {
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ct.ciphertext,
        null,
        ct.nonce,
        dek,
      );
    } catch {
      throw new DecryptionError('decryptPayload: AEAD authentication failed');
    }
  }

  // --- blobs (streaming) -------------------------------------------------

  encryptBlob(data: Uint8Array, dek: Uint8Array): { header: Uint8Array; ciphertext: Uint8Array } {
    assertReady();
    const { state, header } = sodium.crypto_secretstream_xchacha20poly1305_init_push(dek);
    // Single push with the FINAL tag. For very large blobs a caller could chunk
    // this, but the interface hands us the whole buffer, so we emit one frame.
    const ciphertext = sodium.crypto_secretstream_xchacha20poly1305_push(
      state,
      data,
      null, // no additional data
      sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL,
    );
    return { header, ciphertext };
  }

  decryptBlob(header: Uint8Array, ciphertext: Uint8Array, dek: Uint8Array): Uint8Array {
    assertReady();
    let state: ReturnType<typeof sodium.crypto_secretstream_xchacha20poly1305_init_pull>;
    try {
      state = sodium.crypto_secretstream_xchacha20poly1305_init_pull(header, dek);
    } catch {
      throw new DecryptionError('decryptBlob: invalid secretstream header or key');
    }
    const result = sodium.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext, null);
    if (result === false) {
      throw new DecryptionError('decryptBlob: secretstream authentication failed');
    }
    if (result.tag !== sodium.crypto_secretstream_xchacha20poly1305_TAG_FINAL) {
      throw new DecryptionError('decryptBlob: stream did not terminate with FINAL tag');
    }
    return result.message;
  }

  // --- signing & hashing -------------------------------------------------

  hash(data: Uint8Array): Uint8Array {
    assertReady();
    return sodium.crypto_generichash(32, data, null); // BLAKE2b-256, unkeyed
  }

  canonicalize(record: SignableRecord): Uint8Array {
    assertReady();
    return this.utf8(canonicalJson(record));
  }

  computeRecordHash(record: SignableRecord): Uint8Array {
    assertReady();
    return this.hash(this.canonicalize(record));
  }

  sign(message: Uint8Array, signSecretKey: Uint8Array): Uint8Array {
    assertReady();
    return sodium.crypto_sign_detached(message, signSecretKey);
  }

  verify(signature: Uint8Array, message: Uint8Array, signPublicKey: Uint8Array): boolean {
    assertReady();
    try {
      return sodium.crypto_sign_verify_detached(signature, message, signPublicKey);
    } catch {
      // Malformed signature/key length ⇒ not a valid verification.
      return false;
    }
  }

  /**
   * Verify a record end-to-end:
   *   1. recompute recordHash from the signable fields; must equal record.recordHash
   *   2. record.prevHash must equal expectedPrevHash (chain linkage)
   *   3. Ed25519 signature over recordHash must verify under the author's key
   *
   * @param signPublicKey optional override (see CONTRACT-NOTE). When omitted,
   *   the signing public key is base64-decoded from `record.authorKeyId`.
   */
  verifyRecord(
    record: ProtocolRecord,
    expectedPrevHash: string | null,
    signPublicKey?: Uint8Array,
  ): boolean {
    assertReady();

    // 2. chain linkage first (cheap, catches reordering / forks).
    if (record.prevHash !== expectedPrevHash) return false;

    // 1. recompute the hash over the canonical signable form.
    const { recordHash: _rh, signature: _sig, ...signable } = record;
    void _rh;
    void _sig;
    const recomputed = this.computeRecordHash(signable as SignableRecord);
    const recomputedB64 = b64(recomputed);
    if (recomputedB64 !== record.recordHash) return false;

    // 3. signature over the recordHash bytes by the author's signing key.
    let pub: Uint8Array;
    if (signPublicKey) {
      pub = signPublicKey;
    } else {
      // CONTRACT-NOTE: authorKeyId is base64(signPublicKey). See file header.
      try {
        pub = unb64(record.authorKeyId);
      } catch {
        return false;
      }
    }
    if (pub.length !== sodium.crypto_sign_PUBLICKEYBYTES) return false;

    let signature: Uint8Array;
    try {
      signature = unb64(record.signature);
    } catch {
      return false;
    }
    return this.verify(signature, recomputed, pub);
  }

  // --- encoding helpers --------------------------------------------------

  toBase64(b: Uint8Array): string {
    assertReady();
    return b64(b);
  }
  fromBase64(s: string): Uint8Array {
    assertReady();
    return unb64(s);
  }
  utf8(s: string): Uint8Array {
    return sodium.from_string(s);
  }
  fromUtf8(b: Uint8Array): string {
    return sodium.to_string(b);
  }
}

/**
 * The single shared crypto-core instance. Await `crypto.ready()` once.
 *
 * Typed as {@link CryptoCoreExt} (a structural superset of {@link CryptoCore})
 * so the `verifyRecord` override is visible; it is assignable anywhere a
 * `CryptoCore` is expected.
 */
export const crypto: CryptoCoreExt = new CryptoCoreImpl();

export default crypto;
