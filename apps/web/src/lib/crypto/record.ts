/**
 * crypto/record.ts — build, sign, and decrypt ProtocolRecords on the client.
 *
 * This is the heart of the zero-knowledge guarantee: the form data is validated,
 * canonicalised, encrypted, sealed to recipients, hashed, and signed HERE, on
 * the device. Only the resulting ciphertext envelope (a `ProtocolRecord`) ever
 * leaves the client. No plaintext / DEK / secret key crosses the wire.
 *
 * All crypto goes through `@aidlog/crypto-core`.
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import {
  ALGORITHMS,
  ENVELOPE_VERSION,
  type EncryptedBlobRef,
  type EncryptedPayload,
  type ProtocolRecord,
  type PublicIdentity,
  type SchemaDefinition,
  type SealedKey,
  type SignableRecord,
} from '@aidlog/contracts';

/** A binary attachment captured in the form (e.g. an image-capture field). */
export interface PendingBlob {
  /** Stable key matching the form field that produced it. */
  field: string;
  mediaType: string;
  data: Uint8Array;
  label?: string;
}

/** Plaintext blob recovered after decryption, for display. */
export interface DecryptedBlob {
  blobId: string;
  mediaType: string;
  label?: string;
  data: Uint8Array;
}

/** A UUID v4. Uses the platform RNG (Web Crypto), NOT for content secrecy. */
function uuid(): string {
  // crypto.randomUUID exists in browsers and Node 19+. The DEK and all content
  // randomness comes from crypto-core; this id is non-secret routing metadata.
  return globalThis.crypto.randomUUID();
}

export interface BuildRecordArgs {
  deploymentId: string;
  seq: number;
  /** base64 hash of the previous record in this deployment, null for seq 0. */
  prevHash: string | null;
  /** The author's unwrapped identity (helper). */
  author: IdentityKeyPair;
  /** Org public identity — DEK is ALWAYS sealed to this. */
  org: PublicIdentity;
  /**
   * Helper public identity — DEK is additionally sealed to this WHILE the shift
   * is open, so the helper can read their own entries until shift close. Omit
   * (or pass null) to seal to the org only.
   */
  helper?: PublicIdentity | null;
  /**
   * Supervisor public identities (active admins + leads). The DEK is ALSO sealed
   * to each as `recipientType: 'supervisor'`, so a lead/admin can later read this
   * deployment's records for statistics using THEIR OWN box key — without the org
   * password. Forward-only; omit/empty to skip (e.g. when the list is offline).
   */
  supervisors?: PublicIdentity[] | null;
  schema: Pick<SchemaDefinition, 'schemaId' | 'version'>;
  /** The validated form data (validated against `schema` BEFORE this call). */
  payload: unknown;
  blobs?: PendingBlob[];
  /** Correction support: id of the record this one supersedes. */
  supersedes?: string | null;
  /** Override the client clock (testing/determinism). */
  createdAt?: string;
}

/** What the builder returns: the wire record plus the blob ciphertexts to upload. */
export interface BuiltRecord {
  record: ProtocolRecord;
  /** Ciphertext bodies keyed by blobId, to push to object storage. */
  blobCiphertexts: { blobId: string; ciphertext: Uint8Array }[];
}

/**
 * Build a fully-sealed, signed, hash-chained ProtocolRecord from validated
 * form data. Generates a fresh DEK, encrypts payload + blobs under it, seals
 * the DEK to the org (and optionally the helper), then hashes + signs.
 */
export async function buildRecord(args: BuildRecordArgs): Promise<BuiltRecord> {
  await crypto.ready();

  // 1. Fresh per-record data key.
  const dek = crypto.randomDek();
  try {
    // 2. Encrypt the canonical JSON payload.
    const payloadBytes = crypto.utf8(stableStringify(args.payload));
    const aead = crypto.encryptPayload(payloadBytes, dek);
    const payload: EncryptedPayload = {
      alg: aead.alg,
      nonce: crypto.toBase64(aead.nonce),
      ciphertext: crypto.toBase64(aead.ciphertext),
      schemaId: args.schema.schemaId,
      schemaVersion: args.schema.version,
    };

    // 3. Encrypt blobs (streaming AEAD) under the SAME DEK.
    const blobs: EncryptedBlobRef[] = [];
    const blobCiphertexts: { blobId: string; ciphertext: Uint8Array }[] = [];
    for (const b of args.blobs ?? []) {
      const { header, ciphertext } = crypto.encryptBlob(b.data, dek);
      const blobId = uuid();
      blobs.push({
        blobId,
        alg: ALGORITHMS.aead,
        header: crypto.toBase64(header),
        size: ciphertext.length,
        hash: crypto.toBase64(crypto.hash(ciphertext)),
        mediaType: b.mediaType,
        ...(b.label !== undefined ? { label: b.label } : {}),
      });
      blobCiphertexts.push({ blobId, ciphertext });
    }

    // 4. Seal the DEK to recipients. Org always; helper while shift open.
    const recipients: { type: 'org' | 'helper'; identity: PublicIdentity }[] = [
      { type: 'org', identity: args.org },
    ];
    if (args.helper) recipients.push({ type: 'helper', identity: args.helper });
    const sealedKeys: SealedKey[] = crypto.buildSealedKeys(dek, recipients);

    // Additionally seal to active supervisors (admins + leads) so they can read
    // this deployment's records for statistics with their own box key. Skip any
    // whose keyId already has a wrapper (e.g. the author is themselves a lead and
    // got a 'helper' wrapper) to avoid a redundant duplicate.
    const present = new Set(sealedKeys.map((k) => k.recipientKeyId));
    const supervisors = (args.supervisors ?? []).filter((s) => !present.has(s.keyId));
    if (supervisors.length > 0) {
      sealedKeys.push(...buildExtraSealedKeys(dek, 'supervisor', supervisors));
    }

    // 5. Assemble the signable record (everything except hash + signature).
    const authorPub = crypto.toPublicIdentity(args.author);
    const signable: SignableRecord = {
      envelopeVersion: ENVELOPE_VERSION,
      id: uuid(),
      deploymentId: args.deploymentId,
      seq: args.seq,
      createdAt: args.createdAt ?? new Date().toISOString(),
      authorKeyId: authorPub.keyId,
      payload,
      blobs,
      sealedKeys,
      prevHash: args.prevHash,
      alg: { aead: ALGORITHMS.aead, sign: ALGORITHMS.sign, hash: ALGORITHMS.hash },
      supersedes: args.supersedes ?? null,
    };

    // 6. Hash + sign.
    const recordHashBytes = crypto.computeRecordHash(signable);
    const signature = crypto.sign(recordHashBytes, args.author.sign.secretKey);

    const record: ProtocolRecord = {
      ...signable,
      recordHash: crypto.toBase64(recordHashBytes),
      signature: crypto.toBase64(signature),
    };

    return { record, blobCiphertexts };
  } finally {
    // Wipe the DEK as soon as we are done sealing/encrypting.
    try {
      dek.fill(0);
    } catch {
      /* detached buffer — ignore */
    }
  }
}

/**
 * Seal the DEK to additional non-org/helper recipients (e.g. supervisors), each
 * tagged with the given `recipientType`. crypto-core's `buildSealedKeys` only
 * types the 'org'/'helper' recipients, so for 'supervisor' (and other future
 * types) we wrap `crypto.sealDek` directly here — same x25519-sealedbox, just a
 * different `recipientType` label. PUBLIC keys only; the DEK is sealed, never
 * exposed.
 */
export function buildExtraSealedKeys(
  dek: Uint8Array,
  recipientType: SealedKey['recipientType'],
  recipients: PublicIdentity[],
): SealedKey[] {
  return recipients.map((identity) => ({
    recipientType,
    recipientKeyId: identity.keyId,
    alg: ALGORITHMS.seal,
    ciphertext: crypto.toBase64(crypto.sealDek(dek, crypto.fromBase64(identity.boxPublicKey))),
  }));
}

export interface DecryptResult {
  payload: unknown;
  blobs: DecryptedBlob[];
}

/**
 * Decrypt a record for display. The caller supplies the recipient identity
 * whose sealed DEK we can open (org identity for the org lead, helper identity
 * for own-entry read-back). Fetching blob ciphertext from storage is the
 * caller's job; pass it in keyed by blobId.
 */
export async function decryptRecord(
  record: ProtocolRecord,
  recipient: IdentityKeyPair,
  blobCiphertexts: Record<string, Uint8Array> = {},
): Promise<DecryptResult> {
  await crypto.ready();

  const recipientPub = crypto.toPublicIdentity(recipient);
  const sealed = record.sealedKeys.find((k) => k.recipientKeyId === recipientPub.keyId);
  if (!sealed) {
    throw new Error('No sealed DEK for this identity (not a recipient, or shift closed).');
  }

  const dek = crypto.openSealedDek(crypto.fromBase64(sealed.ciphertext), recipient.box);
  try {
    const payloadBytes = crypto.decryptPayload(
      {
        alg: record.payload.alg,
        nonce: crypto.fromBase64(record.payload.nonce),
        ciphertext: crypto.fromBase64(record.payload.ciphertext),
      },
      dek,
    );
    const payload: unknown = JSON.parse(crypto.fromUtf8(payloadBytes));

    const blobs: DecryptedBlob[] = [];
    for (const ref of record.blobs) {
      const ct = blobCiphertexts[ref.blobId];
      if (!ct) continue; // not fetched; skip (UI can lazy-load on demand)
      const data = crypto.decryptBlob(crypto.fromBase64(ref.header), ct, dek);
      blobs.push({
        blobId: ref.blobId,
        mediaType: ref.mediaType,
        ...(ref.label !== undefined ? { label: ref.label } : {}),
        data,
      });
    }
    return { payload, blobs };
  } finally {
    try {
      dek.fill(0);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Deterministic JSON stringify with sorted keys, so the encrypted payload is
 * canonical and reproducible (matches crypto-core's record canonicalisation
 * philosophy). The record envelope itself is canonicalised by crypto-core;
 * this only governs the inner form-data bytes.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortDeep((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
