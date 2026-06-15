/**
 * protocols/list.ts — list the patient PROTOCOLS of one deployment.
 *
 * A deployment (Dienst/Veranstaltung) keeps ONE record hash-chain but can hold
 * MANY logical patient protocols, grouped by the reserved payload marker
 * {@link PROTOCOL_ID_KEY}. This module produces a flat, UI-ready summary list that
 * Phase 2 renders (a protocol hub). Phase 1 only builds the data helper.
 *
 * Sources, merged by protocolId:
 *   (a) LOCAL DRAFTS via `listDrafts(deploymentId)` → status 'draft'.
 *   (b) FINALIZED records from the local `records` store via `getDeploymentRecords`,
 *       decrypted on-device with the EXISTING `decryptRecord` path (the same one
 *       Verlauf/history uses — no new crypto), grouped by their payload's
 *       PROTOCOL_ID_KEY. For each protocolId the LATEST (highest seq, supersedes-
 *       resolved) record is the representative.
 *
 * Rules:
 *   - Journal entries (`__journal__`) are NOT patient protocols → excluded.
 *   - Quick contacts (`__quick__`) ARE tiny protocols → included, isQuick: true.
 *   - Records WITHOUT a PROTOCOL_ID_KEY (pre-Phase-1) fall back to a single legacy
 *     protocolId === the deploymentId, so old deployments show their one protocol.
 *   - Resilient: a record we cannot decrypt is still listed under a neutral label
 *     rather than crashing the list.
 */
import type { ProtocolRecord } from '@aidlog/contracts';
import { getSession, decryptRecord } from '$lib/crypto';
import { getDeploymentRecords } from '$lib/store';
import { listDrafts } from '$lib/doc/draftStore';
import { JOURNAL_FLAG_KEY } from '$lib/journal/types';
import { QUICK_FLAG_KEY } from '$lib/quickentry/types';
import { PROTOCOL_ID_KEY, protocolIdOf } from './marker';

export interface ProtocolSummary {
  /** Stable id grouping this protocol's record versions (+ its draft). */
  protocolId: string;
  status: 'draft' | 'final';
  /** A quick contact (tiny protocol) rather than a full protocol. */
  isQuick: boolean;
  /** Short human label (patient kennung / complaint / localized fallback). */
  label: string;
  /** ISO timestamp for ordering/display (draft.updatedAt or record.createdAt). */
  updatedAt: string;
  /** Representative record id for a finalized protocol (absent for drafts). */
  latestRecordId?: string;
}

/** i18n key for the neutral fallback label (resolved by the Phase 2 UI). */
export const PROTOCOL_FALLBACK_LABEL_KEY = 'protocols.fallbackLabel';

function trimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Pick a short human label from a decrypted payload: patient kennung/initials,
 * else complaint/symptom, else the fallback i18n KEY (caller resolves it).
 */
export function labelFromPayload(payload: Record<string, unknown> | null): string {
  if (payload) {
    const candidate =
      trimmedString(payload.patient_kennung) ??
      trimmedString(payload.q_beschwerde) ??
      trimmedString(payload.s_symptome);
    if (candidate) return candidate;
  }
  return PROTOCOL_FALLBACK_LABEL_KEY;
}

interface DecryptedFinal {
  record: ProtocolRecord;
  payload: Record<string, unknown> | null;
}

/** Decrypt one cached record with the viewer's own identity; null payload if not openable. */
async function decryptLocal(
  record: ProtocolRecord,
  identity: Parameters<typeof decryptRecord>[1],
): Promise<DecryptedFinal> {
  try {
    const { payload } = await decryptRecord(record, identity);
    const obj =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
    return { record, payload: obj };
  } catch {
    return { record, payload: null };
  }
}

/**
 * List a deployment's patient protocols (drafts + finalized), newest first.
 * Returns [] when locked. Never throws on a single undecryptable record.
 */
export async function listProtocols(deploymentId: string): Promise<ProtocolSummary[]> {
  const s = getSession();
  if (!s) return [];

  // (a) Local drafts.
  const drafts = await listDrafts(deploymentId).catch(() => []);
  const draftIds = new Set(drafts.map((d) => d.protocolId));
  const summaries = new Map<string, ProtocolSummary>();

  for (const d of drafts) {
    summaries.set(d.protocolId, {
      protocolId: d.protocolId,
      status: 'draft',
      isQuick: false, // the editor only authors full protocols; quick = finalized
      label: labelFromPayload(d.values as Record<string, unknown>),
      updatedAt: d.updatedAt,
    });
  }

  // (b) Finalized records (local cache), decrypted on-device. Group by protocolId
  //     and keep the representative with the HIGHEST seq (supersedes-resolved).
  const records = await getDeploymentRecords(deploymentId).catch(() => []);
  const best = new Map<string, DecryptedFinal>();
  for (const record of records) {
    const dec = await decryptLocal(record, s.identity);
    // Exclude journal entries entirely (not patient protocols).
    if (dec.payload && dec.payload[JOURNAL_FLAG_KEY] === true) continue;
    const pid = protocolIdOf(dec.payload, deploymentId); // legacy fallback = deploymentId
    const prev = best.get(pid);
    if (!prev || record.seq > prev.record.seq) best.set(pid, dec);
  }

  for (const [pid, dec] of best) {
    // A finalized protocol supersedes any still-open draft under the same id.
    draftIds.delete(pid);
    summaries.set(pid, {
      protocolId: pid,
      status: 'final',
      isQuick: dec.payload?.[QUICK_FLAG_KEY] === true,
      label: labelFromPayload(dec.payload),
      updatedAt: dec.record.createdAt,
      latestRecordId: dec.record.id,
    });
  }

  // Keep drafts that were superseded by a finalized record out of the list only
  // if the finalized version replaced them (handled above via summaries.set).
  void draftIds;

  return [...summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
