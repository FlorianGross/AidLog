/**
 * store/db.ts — IndexedDB schema (via `idb`).
 *
 * What we persist at rest:
 *   - `outbox`     : encrypted records + blob ciphertext awaiting upload.
 *   - `records`    : ciphertext ProtocolRecords pulled/synced (for offline view).
 *   - `chainHeads` : per-deployment {seq,prevHash} so we can chain offline.
 *   - `deployments`: lightweight summaries for the list UI.
 *
 * SECURITY: only CIPHERTEXT and non-sensitive metadata live here. No plaintext,
 * no DEK, no password, no unwrapped secret key is ever stored (ARCHITECTURE §8).
 * Sensitive material stays in memory in the crypto session.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ProtocolRecord } from '@aidlog/contracts';

export interface OutboxItem {
  /** Local queue id (= record.id for dedupe). */
  id: string;
  deploymentId: string;
  seq: number;
  record: ProtocolRecord;
  /** Blob ciphertexts to upload before/with the record. base64-encoded bodies. */
  blobs: { blobId: string; mediaType: string; ciphertextB64: string }[];
  createdAt: string;
  /** Number of failed flush attempts (for backoff / surfacing errors). */
  attempts: number;
  lastError?: string;
}

export interface ChainHead {
  deploymentId: string;
  lastSeq: number;
  lastRecordHash: string;
}

export interface DeploymentMeta {
  deploymentId: string;
  title: string;
  createdAt: string;
  /** open while the shift is active; closed disables helper read-back. */
  status: 'open' | 'closed';
  recordCount: number;
  /**
   * The protocol category this deployment was created under (Sanitätsdienst /
   * HvO / EGB …). Selects which DocSchema the documentation editor renders.
   * OPTIONAL for backward compatibility: deployments created before categories
   * existed have no `categoryId` and fall back to the org-active / ABCDE schema.
   * It is non-sensitive routing metadata (org config, not patient data).
   */
  categoryId?: string;
  /**
   * ÜBUNGS-/DEMO-MODUS: when true this deployment is a TRAINING/exercise, so its
   * records are stamped `__training__: true` in their payload and excluded from
   * statistics/analytics/exports as real data. OPTIONAL for backward
   * compatibility: deployments created before this flag existed have no
   * `training` property and are treated as REAL. Non-sensitive operational
   * metadata; adding it does NOT require an IndexedDB version bump.
   */
  training?: boolean;
  /**
   * VERANSTALTUNGS-STAMMDATEN (optional): nicht-sensible, operative Metadaten
   * einer Veranstaltung. Wird LOKAL PRO GERÄT auf der DeploymentMeta gehalten
   * (keine Server-Synchronisation), additiv/optional — KEIN IndexedDB-Versions-
   * sprung. Enthält bewusst KEINE Patienten-/Gesundheitsdaten (Zero-Knowledge
   * bleibt unberührt).
   */
  ort?: string;
  /** Beginn der Veranstaltung als ISO-8601-Zeitstempel (datetime-local). */
  beginn?: string;
  /** Ende der Veranstaltung als ISO-8601-Zeitstempel (datetime-local). */
  ende?: string;
  /** Art der Veranstaltung (Freitext, z. B. "Stadtfest", "Fußballspiel"). */
  veranstaltungsart?: string;
  /** Erwartete Besucherzahl. */
  erwarteteBesucher?: number;
  /** Veranstalter (Organisation/Firma/Person). */
  veranstalter?: string;
  /** Name der/des (Gesamt-)Einsatzleiterin/Einsatzleiters. */
  einsatzleiterName?: string;
}

interface AidlogDB extends DBSchema {
  outbox: {
    key: string;
    value: OutboxItem;
    indexes: { 'by-deployment': string };
  };
  records: {
    key: string; // record.id
    value: ProtocolRecord;
    indexes: { 'by-deployment': string };
  };
  chainHeads: {
    key: string; // deploymentId
    value: ChainHead;
  };
  deployments: {
    key: string; // deploymentId
    value: DeploymentMeta;
  };
}

const DB_NAME = 'aidlog';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<AidlogDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<AidlogDB>> {
  if (!dbPromise) {
    dbPromise = openDB<AidlogDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        outbox.createIndex('by-deployment', 'deploymentId');

        const records = db.createObjectStore('records', { keyPath: 'id' });
        records.createIndex('by-deployment', 'deploymentId');

        db.createObjectStore('chainHeads', { keyPath: 'deploymentId' });
        db.createObjectStore('deployments', { keyPath: 'deploymentId' });
      },
    });
  }
  return dbPromise;
}

/** Test hook: reset the cached connection (does not delete data). */
export function _resetDbForTests(): void {
  dbPromise = null;
}
