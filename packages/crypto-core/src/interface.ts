/**
 * crypto-core public interface (the contract Agent A implements in index.ts).
 *
 * Threat model in one line: the server and anyone who steals its database see
 * only ciphertext; only the holder of the org password (→ org secret key) can
 * read protocol data. Helpers can read their own entries until shift close.
 *
 * Primitives (libsodium-wrappers-sumo), pinned in @aidlog/contracts:
 *   - DEK / payload / blobs : XChaCha20-Poly1305 (AEAD) + secretstream for blobs
 *   - DEK wrapping          : crypto_box_seal (X25519 sealed box) to recipient
 *   - password → key        : Argon2id (crypto_pwhash)
 *   - secret-key at rest     : XChaCha20-Poly1305 under the Argon2id key
 *   - signatures            : Ed25519
 *   - hashing / chaining     : BLAKE2b-256 (crypto_generichash)
 */
import type {
  AeadAlg,
  KdfParams,
  ProtocolRecord,
  SealedKey,
  SignableRecord,
  WrappedSecretKey,
  PublicIdentity,
} from '@aidlog/contracts';

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** A full identity: one X25519 box pair (sealing) + one Ed25519 sign pair. */
export interface IdentityKeyPair {
  box: KeyPair;
  sign: KeyPair;
}

export interface AeadCiphertext {
  alg: AeadAlg;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * One Shamir secret-share. `index` is the share's distinct x-coordinate in
 * 1..255 (GF(256)); `data` is the per-byte y-coordinates, same length as the
 * shared secret. A share is NEVER sent to the server — it is exported to a human
 * trustee (see `encodeShare`/`decodeShare`).
 */
export interface ShamirShare {
  index: number;
  data: Uint8Array;
}

export interface CryptoCore {
  /** Must be awaited once before any other call (libsodium WASM init). */
  ready(): Promise<void>;

  // --- identity ----------------------------------------------------------
  generateIdentity(): IdentityKeyPair;
  toPublicIdentity(id: IdentityKeyPair): PublicIdentity;

  // --- identity (secret) export / import for recovery --------------------
  /**
   * Deterministic serialization of an identity's SECRET material
   * ({box.secretKey, sign.secretKey}) — the SAME bundle layout `wrapIdentity`
   * encrypts. Returns raw plaintext bytes; the caller is responsible for
   * splitting (Shamir) or otherwise protecting them. Zero the result when done.
   */
  exportIdentitySecret(id: IdentityKeyPair): Uint8Array;
  /**
   * Inverse of `exportIdentitySecret`. Public keys are re-derived from the
   * secret keys (X25519 scalarmult_base, Ed25519 sk_to_pk) so the full
   * IdentityKeyPair is reconstructed without trusting any stored public key.
   */
  importIdentitySecret(bytes: Uint8Array): IdentityKeyPair;

  // --- Shamir secret sharing (GF(256)) over arbitrary secret bytes -------
  /**
   * Split `secret` into `shareCount` shares, any `threshold` of which
   * reconstruct it (Shamir over GF(256), one polynomial per secret byte).
   * Requires 2 <= threshold <= shareCount <= 255. Each share gets a distinct
   * x-index in 1..255 and `data` the same length as `secret`.
   */
  splitSecret(secret: Uint8Array, shareCount: number, threshold: number): ShamirShare[];
  /**
   * Reconstruct the secret from `>= threshold` shares (Lagrange interpolation
   * at x=0 over GF(256)). Any sufficient subset works; fewer than `threshold`
   * shares yields a value unrelated to the real secret (Shamir's security
   * property), not the secret.
   */
  combineSecret(shares: ShamirShare[]): Uint8Array;
  /** Human-transferable text encoding of a share (index + base64 + checksum). */
  encodeShare(share: ShamirShare): string;
  /** Inverse of `encodeShare`; throws on a checksum mismatch (mistyped share). */
  decodeShare(text: string): ShamirShare;

  // --- password-based protection of secret keys --------------------------
  defaultKdfParams(): KdfParams; // sensible Argon2id defaults; salt freshly generated
  deriveKey(password: string, params: KdfParams): Promise<Uint8Array>;
  /** Encrypt {box.secretKey, sign.secretKey} under the password-derived key. */
  wrapIdentity(
    id: IdentityKeyPair,
    password: string,
    params?: KdfParams,
  ): Promise<WrappedSecretKey>;
  unwrapIdentity(wrapped: WrappedSecretKey, password: string): Promise<IdentityKeyPair>;

  // --- raw-key protection of secret keys (no Argon2) ---------------------
  /**
   * Encrypt {box.secretKey, sign.secretKey} directly under a RAW 32-byte key
   * (XChaCha20-Poly1305), WITHOUT running Argon2. The key is assumed to be
   * already high-entropy — e.g. a WebAuthn PRF output, or a one-time transfer
   * key. The returned {@link WrappedSecretKey} carries a PASSTHROUGH-KDF
   * sentinel (`kdf.opsLimit === 0 && kdf.memLimit === 0 && kdf.salt === ''`) so
   * it is unambiguously distinguishable from a password (Argon2) wrap and can
   * never be fed back into `unwrapIdentity` by mistake.
   *
   * The serialized secret layout is identical to `wrapIdentity`, so a key-wrap
   * and a password-wrap of the same identity decrypt to byte-identical secrets.
   * @param key exactly 32 bytes; throws CryptoError otherwise. NOT zeroed by
   *   this call — the caller owns the key buffer and must zero it.
   */
  wrapIdentityWithKey(id: IdentityKeyPair, key: Uint8Array): WrappedSecretKey;
  /**
   * Inverse of {@link wrapIdentityWithKey}. Requires the wrap to carry the
   * passthrough-KDF sentinel (rejects an Argon2/password wrap). Throws
   * `DecryptionError` on a wrong key or tampered ciphertext. The supplied key
   * is NOT zeroed — the caller owns it.
   */
  unwrapIdentityWithKey(wrapped: WrappedSecretKey, key: Uint8Array): IdentityKeyPair;

  // --- per-record data key (DEK) -----------------------------------------
  randomDek(): Uint8Array;
  /** crypto_box_seal: seal a DEK to a recipient's X25519 public key. */
  sealDek(dek: Uint8Array, recipientBoxPublicKey: Uint8Array): Uint8Array;
  openSealedDek(sealed: Uint8Array, recipientBox: KeyPair): Uint8Array;
  buildSealedKeys(
    dek: Uint8Array,
    recipients: { type: 'org' | 'helper'; identity: PublicIdentity }[],
  ): SealedKey[];

  // --- payload (structured JSON) -----------------------------------------
  encryptPayload(plaintext: Uint8Array, dek: Uint8Array): AeadCiphertext;
  decryptPayload(ct: AeadCiphertext, dek: Uint8Array): Uint8Array;

  // --- blobs (streaming, for large images) -------------------------------
  /** Returns header + a transform that encrypts chunks with the DEK. */
  encryptBlob(data: Uint8Array, dek: Uint8Array): { header: Uint8Array; ciphertext: Uint8Array };
  decryptBlob(header: Uint8Array, ciphertext: Uint8Array, dek: Uint8Array): Uint8Array;

  // --- signing & hashing (immutability) ----------------------------------
  hash(data: Uint8Array): Uint8Array; // BLAKE2b-256
  /** Deterministic canonical-JSON bytes for hashing/signing a record. */
  canonicalize(record: SignableRecord): Uint8Array;
  computeRecordHash(record: SignableRecord): Uint8Array;
  sign(message: Uint8Array, signSecretKey: Uint8Array): Uint8Array;
  verify(signature: Uint8Array, message: Uint8Array, signPublicKey: Uint8Array): boolean;
  /** Verify a record's signature AND that recordHash matches its content. */
  verifyRecord(record: ProtocolRecord, expectedPrevHash: string | null): boolean;

  // --- encoding helpers --------------------------------------------------
  toBase64(b: Uint8Array): string;
  fromBase64(s: string): Uint8Array;
  utf8(s: string): Uint8Array;
  fromUtf8(b: Uint8Array): string;
}

/** Implemented and default-exported from ./index.ts by crypto-core. */
export declare const crypto: CryptoCore;
