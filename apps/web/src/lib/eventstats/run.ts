/**
 * eventstats/run.ts — fetch + decrypt + aggregate ONE deployment's statistics.
 *
 * Authorised for lead + admin. It:
 *   1. pulls org-scope records via `api.syncOrg` (scope=org). With supervisor
 *      sealing in place the server returns the caller's OWN sealedKeys (the
 *      'supervisor' wrapper) for records sealed to them.
 *   2. filters to THIS deploymentId,
 *   3. decrypts each by opening the sealedKey addressed to the caller's own
 *      keyId with THEIR box secret key (mirrors cosignDecrypt.openRecordDek) —
 *      NO org password needed,
 *   4. aggregates protocols + quick contacts into {@link EventStats}.
 *
 * SECURITY: decrypted payloads live in memory ONLY for this run; nothing is
 * persisted or logged. The DEK is zeroed immediately after each record. All
 * crypto goes through `@aidlog/crypto-core`.
 */
import { crypto } from '@aidlog/crypto-core';
import type { ProtocolRecord } from '@aidlog/contracts';
import { getSession } from '$lib/crypto';
import { api } from '$lib/api';
import {
  aggregateEvent,
  isQuickContact,
  isTrainingContact,
  type DecryptedContact,
  type EventStats,
} from './aggregate';

export interface EventStatsResult {
  stats: EventStats;
  /** Records of this deployment the caller could NOT decrypt (e.g. old, not
   *  supervisor-sealed). Surfaced as "x Kontakte vor dieser Funktion …". */
  skipped: number;
  /** Total records seen for this deployment (decryptable + skipped). */
  seen: number;
}

const MAX_PAGES = 200; // safety bound on pagination

/** Decrypt one record with the caller's own sealedKey, or null if not addressed/openable. */
function decryptOwn(
  record: ProtocolRecord,
  keyId: string,
  boxSecret: Parameters<typeof crypto.openSealedDek>[1],
): Record<string, unknown> | null {
  const sealed = record.sealedKeys.find((k) => k.recipientKeyId === keyId);
  if (!sealed) return null; // not sealed to us (old record, pre-supervisor-sealing)
  let dek: Uint8Array | null = null;
  try {
    dek = crypto.openSealedDek(crypto.fromBase64(sealed.ciphertext), boxSecret);
    const bytes = crypto.decryptPayload(
      {
        alg: record.payload.alg,
        nonce: crypto.fromBase64(record.payload.nonce),
        ciphertext: crypto.fromBase64(record.payload.ciphertext),
      },
      dek,
    );
    return JSON.parse(crypto.fromUtf8(bytes)) as Record<string, unknown>;
  } catch {
    return null; // wrapper not openable with our key, or payload tampered
  } finally {
    if (dek) {
      try {
        dek.fill(0);
      } catch {
        /* detached — ignore */
      }
    }
  }
}

/**
 * Run per-deployment statistics for the unlocked lead/admin. Throws 'locked' if
 * no session, or rethrows an ApiClientError (e.g. 403) so the page can surface a
 * clear notice.
 */
export async function runEventStats(deploymentId: string): Promise<EventStatsResult> {
  await crypto.ready();
  const s = getSession();
  if (!s) throw new Error('locked');

  // 1. Pull org records (paginated). syncOrg returns the caller's own wrappers.
  const records: ProtocolRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.syncOrg(cursor);
    for (const r of res.records) {
      if (r.deploymentId === deploymentId) records.push(r);
    }
    if (!res.hasMore || !res.cursor) break;
    cursor = res.cursor;
  }

  // 2 + 3. Decrypt each with our own key; collect contacts + skipped count.
  const contacts: DecryptedContact[] = [];
  let skipped = 0;
  for (const r of records) {
    const payload = decryptOwn(r, s.publicIdentity.keyId, s.identity.box);
    if (!payload) {
      skipped++;
      continue;
    }
    contacts.push({
      id: r.id,
      seq: r.seq,
      createdAt: r.createdAt,
      supersedes: r.supersedes ?? null,
      quick: isQuickContact(payload),
      training: isTrainingContact(payload),
      payload,
    });
  }

  // 4. Aggregate.
  const stats = aggregateEvent(contacts);
  return { stats, skipped, seen: records.length };
}
