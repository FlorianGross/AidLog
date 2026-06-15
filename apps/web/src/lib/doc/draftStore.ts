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
import { newProtocolId } from '$lib/protocols/marker';

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
  /**
   * Stable id of the logical patient PROTOCOL this draft belongs to. A deployment
   * can hold MANY drafts (one per protocol). Phase 1 backward-compat: the existing
   * editor uses a default protocolId === deploymentId so its single in-progress
   * protocol is preserved byte-for-byte until Phase 2 splits the UI.
   */
  protocolId: string;
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
  /** Composite key `${deploymentId}:${protocolId}` (keyPath 'key'). */
  key: string;
  deploymentId: string;
  protocolId: string;
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
  drafts: {
    key: string;
    value: StoredDraft;
    indexes: { 'by-deployment': string };
  };
}

const DB_NAME = 'aidlog-drafts';
/**
 * v2 re-keys the `drafts` store from one-per-deployment (keyPath 'deploymentId')
 * to many-per-deployment via a COMPOSITE string key `${deploymentId}:${protocolId}`
 * (keyPath 'key') plus a `by-deployment` index. The upgrade MIGRATES every legacy
 * single-per-deployment draft WITHOUT data loss: each gets a deterministic default
 * protocolId === its deploymentId, so the existing in-progress protocol is
 * preserved exactly (and matches the editor's default protocolId).
 */
const DRAFT_DB_VERSION = 2;

/** The composite key for a (deployment, protocol) draft. */
export function draftKey(deploymentId: string, protocolId: string): string {
  return `${deploymentId}:${protocolId}`;
}

let dbPromise: Promise<IDBPDatabase<DraftDB>> | null = null;

function db(): Promise<IDBPDatabase<DraftDB>> {
  if (!dbPromise) {
    dbPromise = openDB<DraftDB>(DB_NAME, DRAFT_DB_VERSION, {
      async upgrade(d, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          // Fresh DB: create the v2 store directly.
          const store = d.createObjectStore('drafts', { keyPath: 'key' });
          store.createIndex('by-deployment', 'deploymentId');
          return;
        }
        if (oldVersion < 2) {
          // Migrate v1 (keyPath 'deploymentId') → v2 (keyPath 'key' + index).
          // Read all legacy rows, drop the old store, recreate with the new shape,
          // then re-insert each legacy draft under a default protocolId === its
          // deploymentId so nothing is lost and the in-progress protocol is kept.
          const legacy = (await tx.objectStore('drafts').getAll()) as unknown as Array<
            Record<string, unknown>
          >;
          d.deleteObjectStore('drafts');
          const store = d.createObjectStore('drafts', { keyPath: 'key' });
          store.createIndex('by-deployment', 'deploymentId');
          for (const row of legacy) {
            const deploymentId = String(row.deploymentId ?? '');
            if (!deploymentId) continue;
            const protocolId = deploymentId; // deterministic legacy default
            store.put({
              ...row,
              deploymentId,
              protocolId,
              key: draftKey(deploymentId, protocolId),
            } as unknown as StoredDraft);
          }
        }
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
      key: draftKey(draft.deploymentId, draft.protocolId),
      deploymentId: draft.deploymentId,
      protocolId: draft.protocolId,
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

/** Decrypt one stored draft with the unlocked identity, or undefined if not ours/unreadable. */
function decryptStored(
  stored: StoredDraft,
  s: NonNullable<ReturnType<typeof getSession>>,
): Draft | undefined {
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
      protocolId: stored.protocolId,
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

/** Load + decrypt one protocol's draft, or undefined if none/unreadable. */
export async function loadDraft(
  deploymentId: string,
  protocolId: string,
): Promise<Draft | undefined> {
  await crypto.ready();
  const s = getSession();
  if (!s) return undefined;
  const d = await db();
  const stored = await d.get('drafts', draftKey(deploymentId, protocolId));
  if (!stored) return undefined;
  return decryptStored(stored, s);
}

/** List + decrypt all of a deployment's drafts (newest first). Unreadable ones are skipped. */
export async function listDrafts(deploymentId: string): Promise<Draft[]> {
  await crypto.ready();
  const s = getSession();
  if (!s) return [];
  const d = await db();
  const rows = await d.getAllFromIndex('drafts', 'by-deployment', deploymentId);
  const out: Draft[] = [];
  for (const row of rows) {
    const draft = decryptStored(row, s);
    if (draft) out.push(draft);
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

/** Build a fresh, empty draft for a (deployment, protocol) pair. */
export function emptyDraft(
  deploymentId: string,
  protocolId: string,
  schemaId: string,
  schemaVersion: number,
): Draft {
  return {
    deploymentId,
    protocolId,
    schemaId,
    schemaVersion,
    values: {},
    signatures: [],
    photos: [],
    finalized: false,
    updatedAt: new Date().toISOString(),
  };
}

/** Re-export so callers mint protocolIds via one canonical path. */
export { newProtocolId };

/** Mark one protocol's persisted draft finalised (keeps it for read-back history). */
export async function markDraftFinalized(deploymentId: string, protocolId: string): Promise<void> {
  const d = await db();
  const stored = await d.get('drafts', draftKey(deploymentId, protocolId));
  if (stored) await d.put('drafts', { ...stored, finalized: true });
}

export async function deleteDraft(deploymentId: string, protocolId: string): Promise<void> {
  const d = await db();
  await d.delete('drafts', draftKey(deploymentId, protocolId));
}

/** Test hook: drop the cached connection so a fresh IndexedDB realm is reopened. */
export function _resetDraftDbForTests(): void {
  dbPromise = null;
}
