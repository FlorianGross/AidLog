/**
 * doc/finalize.ts — build the immutable, signed ProtocolRecord from a draft.
 *
 * Pipeline (all on-device, via @aidlog/crypto-core + crypto/record.ts):
 *   1. Collect the validated payload + captured signature images.
 *   2. buildRecord(): fresh DEK → encrypt payload → encrypt each signature image
 *      under the SAME DEK → seal the DEK to the ORG (+ helper while shift open) →
 *      chain off the local head (prevHash) → computeRecordHash → Ed25519 sign.
 *   3. Enqueue ciphertext (record + blob bodies) to the offline outbox.
 *
 * Signature images are linked to their schema field via `EncryptedBlobRef.label`
 * = the field key (e.g. 'sig_patient'), so a reader can map blobs back to fields.
 *
 * We seal the DEK to the ORG public identity (never to self as a placeholder).
 */
import { buildRecord, getSession, type PendingBlob } from '$lib/crypto';
import { enqueue } from '$lib/store';
import type { ProtocolRecord, PublicIdentity } from '@aidlog/contracts';
import { getCachedSupervisors } from '$lib/supervisors';
import { getOrgPublicIdentity } from './org';
import type { Draft, DraftSignature } from './draftStore';
import { photoLabel, type DraftPhoto } from '$lib/bodymap/types';
import { TRAINING_FLAG_KEY } from '$lib/training';

/** Prefix marking a blob label as a signature for field <key>. */
export const SIGNATURE_LABEL_PREFIX = 'sig-field:';

export function signatureLabel(fieldKey: string): string {
  return SIGNATURE_LABEL_PREFIX + fieldKey;
}

export function fieldKeyFromLabel(label: string | undefined): string | null {
  if (!label || !label.startsWith(SIGNATURE_LABEL_PREFIX)) return null;
  return label.slice(SIGNATURE_LABEL_PREFIX.length);
}

export interface FinalizeArgs {
  draft: Draft;
  /** local chain head for prevHash/seq (from store.getChainHead). */
  head: { lastSeq: number; lastRecordHash: string } | undefined;
  /** seal the DEK to the helper too (read-back) while the shift is open. */
  shiftOpen: boolean;
  /**
   * Record photos (body-map feature). Encrypted under the SAME record DEK and
   * attached via the existing blob/outbox flow, labelled `photo:<id>` so a
   * reader can map blobs back to the photo feature. Body-map markers themselves
   * ride along in the encrypted payload (draft.values.bodymap) — not as blobs.
   */
  photos?: DraftPhoto[];
  /**
   * ÜBUNGS-/DEMO-MODUS: when true, stamp the reserved marker `__training__: true`
   * into the encrypted payload so EVERY consumer (event statistics, admin
   * analytics, FHIR/DIVI export) — on any synced device — can exclude/flag this
   * as practice data. This is the SINGLE chokepoint covering the full-protocol
   * editor, quick-entry and journal paths. Defaults to a REAL record.
   */
  training?: boolean;
}

export interface FinalizeResult {
  record: ProtocolRecord;
}

function toPendingBlobs(signatures: DraftSignature[]): PendingBlob[] {
  return signatures.map((sig) => ({
    field: sig.field,
    mediaType: sig.mediaType || 'image/png',
    data: sig.data,
    label: signatureLabel(sig.field),
  }));
}

function photosToPendingBlobs(photos: DraftPhoto[]): PendingBlob[] {
  return photos.map((p) => ({
    field: p.id,
    mediaType: p.mediaType || 'image/jpeg',
    data: p.data,
    label: photoLabel(p.id),
  }));
}

/**
 * Finalize a draft: build + sign the record and enqueue it. Throws if the org
 * identity is unavailable (we must not seal to self) — the caller surfaces it.
 */
export async function finalizeDraft(args: FinalizeArgs): Promise<FinalizeResult> {
  const s = getSession();
  if (!s) throw new Error('locked');

  const org = await getOrgPublicIdentity();
  const seq = args.head ? args.head.lastSeq + 1 : 0;
  const prevHash = args.head?.lastRecordHash ?? null;

  // Seal the DEK ALSO to every cached active supervisor (admins + leads) so they
  // can later read this deployment's records for statistics with their own box
  // key — no org password needed. PUBLIC keys only. If the list is unavailable
  // (offline / endpoint not deployed / never loaded), this is [] and we seal to
  // org (+helper) only; the record stays valid, just not yet supervisor-readable.
  const supervisors: PublicIdentity[] = getCachedSupervisors().map((s) => s.identity);

  // Signature images do NOT belong in the structured payload (they are blobs).
  // Strip any signature field markers so the encrypted JSON stays clean.
  const payload = { ...args.draft.values };

  // ÜBUNGS-/DEMO-MODUS: stamp the training marker so any synced device can tell
  // this is practice data (the local DeploymentMeta does not travel with it).
  if (args.training) payload[TRAINING_FLAG_KEY] = true;

  // Signature blobs + record photos both ride the existing blob/outbox flow,
  // distinguished by their label prefix (sig-field: vs photo:).
  const blobs = [
    ...toPendingBlobs(args.draft.signatures),
    ...photosToPendingBlobs(args.photos ?? []),
  ];

  const { record, blobCiphertexts } = await buildRecord({
    deploymentId: args.draft.deploymentId,
    seq,
    prevHash,
    author: s.identity,
    org,
    helper: args.shiftOpen ? s.publicIdentity : null,
    supervisors,
    schema: { schemaId: args.draft.schemaId, version: args.draft.schemaVersion },
    payload,
    blobs,
  });

  await enqueue({
    record,
    blobCiphertexts: blobCiphertexts.map((b, i) => ({
      blobId: b.blobId,
      mediaType: blobs[i]?.mediaType ?? 'application/octet-stream',
      ciphertext: b.ciphertext,
    })),
  });

  return { record };
}
