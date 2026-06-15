/**
 * doc/draftStore.ts — encrypted, offline draft persistence for the editor.
 *
 * The in-progress documentation payload is auto-saved to IndexedDB so a refresh,
 * crash or offline period never loses work. SECURITY: the draft is stored as
 * CIPHERTEXT, never plaintext. A per-draft DEK encrypts the payload (and any
 * captured signature images) and is sealed (crypto_box_seal) to the LOCAL
 * unlocked identity's own X25519 box key — the draft is a private, device-local
 * artifact only its author can reopen. The DEK is never persisted in the clear.
 *
 * This is distinct from the finalised ProtocolRecord, whose DEK is sealed to the
 * ORG (see crypto/record.ts). Drafts never leave the device.
 *
 * Uses its own small IndexedDB so it is independent of the synced `aidlog` DB
 * (which we must not migrate — it is owned by the store layer).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { crypto } from '@aidlog/crypto-core';
import { getSession } from '$lib/crypto';

/** A signature image captured in the editor, kept as raw bytes in memory. */
export interface DraftSignature {
  /** the schema field key, e.g. 'sig_patient'. */
  field: string;
  mediaType: string;
  /** PNG bytes of the drawn signature. */
  data: Uint8Array;
  capturedAt: string;
}

/**
 * A record photo (body-map feature) captured in the editor, kept as raw bytes in
 * memory. Persisted in the draft alongside signatures so a refresh never loses a
 * pending photo; at finalize each is encrypted under the record DEK and uploaded
 * via the existing blob/outbox flow.
 */
export interface DraftPhotoEntry {
  /** stable client id (becomes the blob label `photo:<id>`). */
  id: string;
  mediaType: string;
  data: Uint8Array;
  capturedAt: string;
}

/** Decrypted draft as used by the editor at runtime. */
export interface Draft {
  deploymentId: string;
  schemaId: string;
  schemaVersion: number;
  /** flat field-key → value map (matches DocField.key). */
  values: Record<string, unknown>;
  signatures: DraftSignature[];
  /** pending record photos (body-map feature). */
  photos?: DraftPhotoEntry[];
  finalized: boolean;
  updatedAt: string;
}

/** Encrypted at-rest shape. Only ciphertext + the self-sealed DEK are stored. */
interface StoredDraft {
  deploymentId: string;
  schemaId: string;
  schemaVersion: number;
  finalized: boolean;
  updatedAt: string;
  /** crypto_box_seal(DEK, selfBoxPublicKey), base64. */
  sealedDek: string;
  /** keyId the DEK was sealed to (must match the unlocked identity to reopen). */
  sealedFor: string;
  /** AEAD over canonical JSON {values, signatures(b64)}. */
  nonce: string;
  ciphertext: string;
}

interface DraftDB extends DBSchema {
  drafts: { key: string; value: StoredDraft };
}

const DB_NAME = 'aidlog-drafts';
let dbPromise: Promise<IDBPDatabase<DraftDB>> | null = null;

function db(): Promise<IDBPDatabase<DraftDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DraftDB>(DB_NAME, 1, {
      upgrade(d) {
        d.createObjectStore('drafts', { keyPath: 'deploymentId' });
      },
    });
  }
  return dbPromise;
}

interface InnerPlain {
  values: Record<string, unknown>;
  signatures: { field: string; mediaType: string; data: string; capturedAt: string }[];
  photos?: { id: string; mediaType: string; data: string; capturedAt: string }[];
}

/** Persist (encrypt) the draft for a deployment. */
export async function saveDraft(draft: Draft): Promise<void> {
  await crypto.ready();
  const s = getSession();
  if (!s) throw new Error('locked');

  const dek = crypto.randomDek();
  try {
    const inner: InnerPlain = {
      values: draft.values,
      signatures: draft.signatures.map((sig) => ({
        field: sig.field,
        mediaType: sig.mediaType,
        data: crypto.toBase64(sig.data),
        capturedAt: sig.capturedAt,
      })),
      photos: (draft.photos ?? []).map((p) => ({
        id: p.id,
        mediaType: p.mediaType,
        data: crypto.toBase64(p.data),
        capturedAt: p.capturedAt,
      })),
    };
    const aead = crypto.encryptPayload(crypto.utf8(JSON.stringify(inner)), dek);
    const sealed = crypto.sealDek(dek, crypto.fromBase64(s.publicIdentity.boxPublicKey));

    const stored: StoredDraft = {
      deploymentId: draft.deploymentId,
      schemaId: draft.schemaId,
      schemaVersion: draft.schemaVersion,
      finalized: draft.finalized,
      updatedAt: draft.updatedAt,
      sealedDek: crypto.toBase64(sealed),
      sealedFor: s.publicIdentity.keyId,
      nonce: crypto.toBase64(aead.nonce),
      ciphertext: crypto.toBase64(aead.ciphertext),
    };
    const d = await db();
    await d.put('drafts', stored);
  } finally {
    try {
      dek.fill(0);
    } catch {
      /* ignore */
    }
  }
}

/** Load + decrypt the draft for a deployment, or undefined if none/unreadable. */
export async function loadDraft(deploymentId: string): Promise<Draft | undefined> {
  await crypto.ready();
  const s = getSession();
  if (!s) return undefined;
  const d = await db();
  const stored = await d.get('drafts', deploymentId);
  if (!stored) return undefined;
  if (stored.sealedFor !== s.publicIdentity.keyId) return undefined; // not ours

  const dek = crypto.openSealedDek(crypto.fromBase64(stored.sealedDek), s.identity.box);
  try {
    const plain = crypto.decryptPayload(
      {
        alg: 'xchacha20poly1305-ietf',
        nonce: crypto.fromBase64(stored.nonce),
        ciphertext: crypto.fromBase64(stored.ciphertext),
      },
      dek,
    );
    const inner = JSON.parse(crypto.fromUtf8(plain)) as InnerPlain;
    return {
      deploymentId: stored.deploymentId,
      schemaId: stored.schemaId,
      schemaVersion: stored.schemaVersion,
      values: inner.values ?? {},
      signatures: (inner.signatures ?? []).map((sig) => ({
        field: sig.field,
        mediaType: sig.mediaType,
        data: crypto.fromBase64(sig.data),
        capturedAt: sig.capturedAt,
      })),
      photos: (inner.photos ?? []).map((p) => ({
        id: p.id,
        mediaType: p.mediaType,
        data: crypto.fromBase64(p.data),
        capturedAt: p.capturedAt,
      })),
      finalized: stored.finalized,
      updatedAt: stored.updatedAt,
    };
  } catch {
    return undefined;
  } finally {
    try {
      dek.fill(0);
    } catch {
      /* ignore */
    }
  }
}

/** Mark the persisted draft finalised (keeps it for read-back history). */
export async function markDraftFinalized(deploymentId: string): Promise<void> {
  const d = await db();
  const stored = await d.get('drafts', deploymentId);
  if (stored) await d.put('drafts', { ...stored, finalized: true });
}

export async function deleteDraft(deploymentId: string): Promise<void> {
  const d = await db();
  await d.delete('drafts', deploymentId);
}
