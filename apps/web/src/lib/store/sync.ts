/**
 * store/sync.ts — pull ciphertext records from the server into the local cache.
 *
 * Pull side of offline-first: fetch records the client is permitted to read
 * (server enforces by role/sealed-key presence) and persist the CIPHERTEXT to
 * IndexedDB so the UI can render offline. Decryption happens later, in memory,
 * via the crypto wrapper — never here.
 */
import { getDB, type ChainHead } from './db';
import { ApiClient, api as defaultApi } from '../api';
import type { ProtocolRecord } from '@aidlog/contracts';

const CURSOR_KEY = 'aidlog.sync-cursor';

function loadCursor(): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  return sessionStorage.getItem(CURSOR_KEY) ?? undefined;
}
function saveCursor(cursor: string): void {
  if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(CURSOR_KEY, cursor);
}

export interface SyncStats {
  pulled: number;
}

/** Incrementally pull records from `ROUTES.sync` and cache the ciphertext. */
export async function pull(client: ApiClient = defaultApi): Promise<SyncStats> {
  const db = await getDB();
  let cursor = loadCursor();
  let pulled = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await client.sync(cursor);
    const tx = db.transaction(['records', 'chainHeads'], 'readwrite');
    const chainStore = tx.objectStore('chainHeads');
    for (const record of res.records) {
      await tx.objectStore('records').put(record);
      const existing = await chainStore.get(record.deploymentId);
      if (!existing || record.seq >= existing.lastSeq) {
        await chainStore.put({
          deploymentId: record.deploymentId,
          lastSeq: record.seq,
          lastRecordHash: record.recordHash,
        } satisfies ChainHead);
      }
      pulled++;
    }
    await tx.done;
    cursor = res.cursor;
    saveCursor(cursor);
    hasMore = res.hasMore;
  }
  return { pulled };
}

/** The local chain head for a deployment, used to set prevHash on new records. */
export async function getChainHead(deploymentId: string): Promise<ChainHead | undefined> {
  const db = await getDB();
  return db.get('chainHeads', deploymentId);
}

/** All cached (ciphertext) records for a deployment, in chain order. */
export async function getDeploymentRecords(deploymentId: string): Promise<ProtocolRecord[]> {
  const db = await getDB();
  const records = await db.getAllFromIndex('records', 'by-deployment', deploymentId);
  return records.sort((a, b) => a.seq - b.seq);
}
