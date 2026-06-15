/**
 * store/outbox.ts — offline-first outbox queue.
 *
 * Records built offline (encrypted client-side) are enqueued to IndexedDB and
 * flushed to the API when connectivity returns. Everything stored is CIPHERTEXT
 * — the queue holds sealed `ProtocolRecord`s and encrypted blob bodies only.
 *
 * Flush order matters: blob ciphertext is uploaded first (so the record's blob
 * refs resolve server-side), then the record is appended. Append-only semantics
 * mean a 409/duplicate on the record is treated as already-delivered (idempotent
 * by record.id) and the item is dropped from the queue.
 */
import { getDB, type OutboxItem } from './db';
import { ApiClient, ApiClientError, api as defaultApi } from '../api';
import { crypto } from '@aidlog/crypto-core';
import type { ProtocolRecord } from '@aidlog/contracts';

export interface EnqueueArgs {
  record: ProtocolRecord;
  blobCiphertexts: { blobId: string; mediaType: string; ciphertext: Uint8Array }[];
}

/** Add a freshly-built encrypted record (+ blob ciphertext) to the outbox. */
export async function enqueue(args: EnqueueArgs): Promise<void> {
  await crypto.ready();
  const db = await getDB();
  const item: OutboxItem = {
    id: args.record.id,
    deploymentId: args.record.deploymentId,
    seq: args.record.seq,
    record: args.record,
    blobs: args.blobCiphertexts.map((b) => ({
      blobId: b.blobId,
      mediaType: b.mediaType,
      ciphertextB64: crypto.toBase64(b.ciphertext),
    })),
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await db.put('outbox', item);
}

export async function pending(): Promise<OutboxItem[]> {
  const db = await getDB();
  const items = await db.getAll('outbox');
  // Deliver in chain order so prevHash links validate server-side.
  return items.sort((a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt));
}

export async function pendingCount(): Promise<number> {
  const db = await getDB();
  return db.count('outbox');
}

export interface FlushResult {
  delivered: number;
  remaining: number;
  failed: number;
}

/**
 * Attempt to flush every queued item. Resilient: a failure on one item records
 * the error and moves on, so one bad record cannot wedge the whole queue.
 * Returns counts for the UI/connectivity store to surface.
 */
export async function flush(client: ApiClient = defaultApi): Promise<FlushResult> {
  await crypto.ready();
  const db = await getDB();
  const items = await pending();

  let delivered = 0;
  let failed = 0;

  for (const item of items) {
    try {
      // 1. Upload blob ciphertext via pre-authorised tickets.
      for (const blob of item.blobs) {
        const ciphertext = crypto.fromBase64(blob.ciphertextB64);
        const ticket = await client.blobTicket(blob.blobId, ciphertext.length);
        await client.uploadBlob(ticket, ciphertext);
      }

      // 2. Append the record.
      await client.appendRecord(item.record);

      // 3. Success → move to local read cache, drop from outbox.
      await db.put('records', item.record);
      await db.delete('outbox', item.id);
      delivered++;
    } catch (err) {
      // A 409 means the server already has this record.id (append-only,
      // idempotent) — treat as delivered and drop it.
      if (err instanceof ApiClientError && err.status === 409) {
        await db.put('records', item.record);
        await db.delete('outbox', item.id);
        delivered++;
        continue;
      }
      failed++;
      const updated: OutboxItem = {
        ...item,
        attempts: item.attempts + 1,
        lastError: err instanceof Error ? err.message : String(err),
      };
      await db.put('outbox', updated);
    }
  }

  const remaining = await pendingCount();
  return { delivered, remaining, failed };
}
