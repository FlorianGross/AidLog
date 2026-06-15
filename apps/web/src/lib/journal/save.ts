/**
 * journal/save.ts — turn a journal-entry form input into a REAL signed record.
 *
 * A journal entry is NOT a draft and does NOT touch the editor's full-protocol
 * draft for the deployment. It builds a transient `Draft` carrying only the
 * minimal journal payload (marker `schemaId: 'event-journal'` +
 * `__journal__: true`) and runs it through the SAME `finalizeDraft` path as a
 * full protocol: fresh DEK → encrypt payload → seal to org (+helper while shift
 * open) + supervisors → sign → enqueue to the encrypted outbox. It then bumps
 * the local deployment count and best-effort flushes when online.
 *
 * Sealing to the supervisors lets the Einsatzleitung (lead/admin) read the
 * journal of this deployment with their OWN box key (no org password) — exactly
 * like the quick-contact + event-statistics flow.
 *
 * Everything sensitive (DEK, payload) stays on-device; only ciphertext is
 * enqueued/synced. All crypto goes through finalize.ts → crypto-core.
 */
import { getChainHead, getDeployment, bumpDeploymentCount, flush } from '$lib/store';
import { finalizeDraft } from '$lib/doc/finalize';
import { loadSupervisors } from '$lib/supervisors';
import { api } from '$lib/api';
import type { ProtocolRecord } from '@aidlog/contracts';
import {
  buildJournalPayload,
  EVENT_JOURNAL_SCHEMA_ID,
  EVENT_JOURNAL_SCHEMA_VERSION,
  type JournalEntryInput,
} from './types';

export interface SaveJournalEntryResult {
  record: ProtocolRecord;
  /** true if the record was synced to the server, false if queued offline. */
  synced: boolean;
}

export interface SaveJournalEntryArgs {
  deploymentId: string;
  input: JournalEntryInput;
}

/**
 * Persist a journal entry as a signed record in the given deployment. Refreshes
 * the supervisor list first (best-effort) so the entry is sealed to current
 * leads/admins for the Einsatzleitung's read view. Throws if the session is
 * locked or the org identity is unavailable (surfaced by `finalizeDraft`).
 */
export async function saveJournalEntry({
  deploymentId,
  input,
}: SaveJournalEntryArgs): Promise<SaveJournalEntryResult> {
  // Best-effort refresh of the supervisor public keys so this entry is sealed
  // to the current leads/admins. finalize falls back to org(+helper) if empty.
  await loadSupervisors().catch(() => {});

  const meta = await getDeployment(deploymentId);
  const head = await getChainHead(deploymentId);

  const { record } = await finalizeDraft({
    draft: {
      deploymentId,
      // A journal entry is NOT a patient protocol → NO protocolId. The empty
      // string makes finalizeDraft skip the PROTOCOL_ID_KEY stamp, so journal
      // entries stay in the Tagebuch and never appear in the protocol list.
      protocolId: '',
      schemaId: EVENT_JOURNAL_SCHEMA_ID,
      schemaVersion: EVENT_JOURNAL_SCHEMA_VERSION,
      values: buildJournalPayload(input),
      signatures: [],
      photos: [],
      finalized: true,
      updatedAt: new Date().toISOString(),
    },
    head: head ? { lastSeq: head.lastSeq, lastRecordHash: head.lastRecordHash } : undefined,
    shiftOpen: meta?.status !== 'closed',
    training: meta?.training === true,
  });

  await bumpDeploymentCount(deploymentId);

  let synced = false;
  if (typeof navigator === 'undefined' || navigator.onLine) {
    try {
      await flush(api);
      synced = true;
    } catch {
      synced = false; // stays queued in the encrypted outbox
    }
  }

  return { record, synced };
}
