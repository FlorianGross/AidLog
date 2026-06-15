/**
 * journal/load.ts — fetch + decrypt this deployment's EINSATZTAGEBUCH.
 *
 * Authorised for lead + admin (the Einsatzleitung), since journal entries are
 * sealed only to org + supervisors. It:
 *   1. pulls org-scope records via `api.syncOrg` (scope=org). With supervisor
 *      sealing in place the server returns the caller's OWN sealedKeys (the
 *      'supervisor' wrapper) for records sealed to them.
 *   2. filters to THIS deploymentId,
 *   3. decrypts each by opening the sealedKey addressed to the caller's own
 *      keyId with THEIR box secret key (mirrors eventstats/run decryptOwn) —
 *      NO org password needed,
 *   4. keeps only journal entries (`__journal__: true`) and maps them to the
 *      timeline shape, oldest-first (conventional for an Einsatztagebuch).
 *
 * SECURITY: decrypted payloads live in memory ONLY for this run; nothing is
 * persisted or logged. The DEK is zeroed immediately after each record. All
 * crypto goes through `@aidlog/crypto-core`.
 */
import { crypto } from '@aidlog/crypto-core';
import type { ProtocolRecord } from '@aidlog/contracts';
import { getSession } from '$lib/crypto';
import { api } from '$lib/api';
import { isJournalPayload, type JournalEntry } from './types';

export interface JournalLoadResult {
  /** Decrypted journal entries, oldest-first. */
  entries: JournalEntry[];
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

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Load + decrypt the journal of one deployment for the unlocked lead/admin.
 * Throws 'locked' if no session, or rethrows an ApiClientError (e.g. 403) so the
 * page can surface a clear notice.
 */
export async function loadJournal(deploymentId: string): Promise<JournalLoadResult> {
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

  // 2 + 3 + 4. Decrypt each with our own key; keep journal entries only. An
  // undecryptable record (old / not supervisor-sealed, or a patient protocol we
  // are not addressed on) is simply skipped — we cannot and need not classify
  // it. The page shows a static forward-only hint instead of a skipped count,
  // because only entries created after this feature are supervisor-sealed.
  const entries: JournalEntry[] = [];
  for (const r of records) {
    const payload = decryptOwn(r, s.publicIdentity.keyId, s.identity.box);
    if (!payload) continue;
    if (!isJournalPayload(payload)) continue;
    const time = asString(payload.j_time) ?? r.createdAt;
    entries.push({
      id: r.id,
      seq: r.seq,
      createdAt: r.createdAt,
      time,
      category: asString(payload.j_category) ?? 'sonstiges',
      text: asString(payload.j_text) ?? '',
      authorName: asString(payload.j_author_name),
    });
  }

  // Oldest-first (conventional chronological logbook order).
  entries.sort((a, b) => a.time.localeCompare(b.time) || a.seq - b.seq);

  return { entries };
}
