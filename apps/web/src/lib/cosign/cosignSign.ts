/**
 * cosign/cosignSign.ts — submit a co-signature (sign or reject).
 *
 * Signing:
 *   - Ed25519-sign the record's recordHash with my in-memory signing key
 *     (crypto.sign over the raw recordHash bytes — the same bytes the author
 *     signed; the co-signature is an independent attestation over the SAME hash).
 *   - Optionally encrypt my hand-drawn signature image under the RECORD DEK
 *     (crypto.encryptBlob) and upload the ciphertext via the existing blob ticket
 *     flow, attaching it as an EncryptedBlobRef.
 *   - POST SubmitCosignatureRequest to ROUTES.cosignSubmit.
 *
 * Rejecting: POST decision 'rejected' with a reason carried in the signature
 * field's place is not appropriate (signature is required by the contract), so a
 * rejection still sends an Ed25519 signature over the recordHash as proof of
 * authenticity, plus the reason via a follow-up note is out of contract scope —
 * we send decision 'rejected' with the signature as the authenticated marker.
 *
 * Only signatures + ciphertext leave the device.
 */
import { crypto } from '@aidlog/crypto-core';
import {
  ALGORITHMS,
  type EncryptedBlobRef,
  type ProtocolRecord,
  type SubmitCosignatureRequest,
} from '@aidlog/contracts';
import { getSession } from '$lib/crypto';
import { api } from '$lib/api';
import { submitCosign } from './cosignApi';

function uuid(): string {
  return globalThis.crypto.randomUUID();
}

/** Sign the recordHash and (optionally) upload an encrypted signature image. */
export async function signCosign(args: {
  requestId: string;
  record: ProtocolRecord;
  /** record DEK (in-memory) to encrypt the signature image, if provided. */
  dek?: Uint8Array;
  signatureImage?: Uint8Array | null;
}): Promise<void> {
  await crypto.ready();
  const s = getSession();
  if (!s) throw new Error('locked');

  const recordHashBytes = crypto.fromBase64(args.record.recordHash);
  const signature = crypto.toBase64(crypto.sign(recordHashBytes, s.identity.sign.secretKey));

  let signatureImage: EncryptedBlobRef | undefined;
  if (args.signatureImage && args.dek) {
    const { header, ciphertext } = crypto.encryptBlob(args.signatureImage, args.dek);
    const blobId = uuid();
    const ref: EncryptedBlobRef = {
      blobId,
      alg: ALGORITHMS.aead,
      header: crypto.toBase64(header),
      size: ciphertext.length,
      hash: crypto.toBase64(crypto.hash(ciphertext)),
      mediaType: 'image/png',
      label: `cosign-sig:${s.publicIdentity.keyId}`,
    };
    // Upload ciphertext via the shared blob ticket flow (best-effort; the record
    // co-signature still records even if blob upload is unavailable offline).
    try {
      const ticket = await api.blobTicket(blobId, ciphertext.length);
      await api.uploadBlob(ticket, ciphertext);
      signatureImage = ref;
    } catch {
      /* image upload failed — submit the cryptographic co-signature without it */
    }
  }

  const req: SubmitCosignatureRequest = {
    requestId: args.requestId,
    decision: 'signed',
    signature,
    ...(signatureImage ? { signatureImage } : {}),
  };
  await submitCosign(req);
}

/** Reject a co-signature request with a reason. */
export async function rejectCosign(args: {
  requestId: string;
  record: ProtocolRecord;
  reason: string;
}): Promise<void> {
  await crypto.ready();
  const s = getSession();
  if (!s) throw new Error('locked');
  // An Ed25519 signature over the recordHash authenticates the rejection too.
  const signature = crypto.toBase64(
    crypto.sign(crypto.fromBase64(args.record.recordHash), s.identity.sign.secretKey),
  );
  const req: SubmitCosignatureRequest = {
    requestId: args.requestId,
    decision: 'rejected',
    signature,
  };
  await submitCosign(req);
}
