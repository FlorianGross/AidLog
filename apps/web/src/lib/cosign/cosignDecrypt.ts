/**
 * cosign/cosignDecrypt.ts — open a record for co-signature review.
 *
 * A co-signer was granted read access by the requester sealing the record DEK to
 * their box key (recipientType 'cosigner'). Here we:
 *   - locate the cosigner-sealed (or any openable) DEK on the record,
 *   - open it with our in-memory box secret key,
 *   - decrypt the structured payload to a flat values map,
 *   - return the DEK so signature blobs can be decrypted lazily by SignatureView.
 *
 * Blob CIPHERTEXT download is best-effort: contracts expose an upload ticket but
 * no canonical download route yet, so we try a conventional GET and skip on
 * failure (the review still renders the textual payload). When the backend ships
 * a download route, wire it into `fetchBlobCiphertext`.
 */
import { crypto } from '@aidlog/crypto-core';
import type { EncryptedBlobRef, ProtocolRecord } from '@aidlog/contracts';
import { getSession } from '$lib/crypto';
import { api } from '$lib/api';
import { getApiBase } from '$lib/config/serverUrl';
import { fieldKeyFromLabel } from '$lib/doc/finalize';

export interface OpenedRecord {
  values: Record<string, unknown>;
  /** record DEK (in-memory) — caller must wipe when done. */
  dek: Uint8Array;
  /** signature blob refs + ciphertext keyed by field key (when fetchable). */
  signatureBlobs: Record<string, { ref: EncryptedBlobRef; ciphertext: Uint8Array }>;
}

/** Open the DEK sealed to our identity (cosigner / helper / org wrapper). */
export function openRecordDek(record: ProtocolRecord): Uint8Array {
  const s = getSession();
  if (!s) throw new Error('locked');
  const sealed = record.sealedKeys.find((k) => k.recipientKeyId === s.publicIdentity.keyId);
  if (!sealed) throw new Error('No sealed DEK for this identity (read access not granted).');
  return crypto.openSealedDek(crypto.fromBase64(sealed.ciphertext), s.identity.box);
}

/** Best-effort blob download. Returns null if no download route is available. */
async function fetchBlobCiphertext(blobId: string): Promise<Uint8Array | null> {
  const base = getApiBase();
  const token = api.getToken();
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${base}/api/blobs/${encodeURIComponent(blobId)}`, { headers });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function openRecordForReview(record: ProtocolRecord): Promise<OpenedRecord> {
  await crypto.ready();
  const dek = openRecordDek(record);

  const payloadBytes = crypto.decryptPayload(
    {
      alg: record.payload.alg,
      nonce: crypto.fromBase64(record.payload.nonce),
      ciphertext: crypto.fromBase64(record.payload.ciphertext),
    },
    dek,
  );
  const values = JSON.parse(crypto.fromUtf8(payloadBytes)) as Record<string, unknown>;

  const signatureBlobs: Record<string, { ref: EncryptedBlobRef; ciphertext: Uint8Array }> = {};
  for (const ref of record.blobs) {
    const fieldKey = fieldKeyFromLabel(ref.label);
    if (!fieldKey) continue;
    const ct = await fetchBlobCiphertext(ref.blobId);
    if (ct) signatureBlobs[fieldKey] = { ref, ciphertext: ct };
  }

  return { values, dek, signatureBlobs };
}
