/**
 * quickentry/save.ts — turn a quick-contact form input into a REAL signed record.
 *
 * A quick contact is NOT a draft and does NOT touch the editor's full-protocol
 * draft for the deployment. It builds a transient `Draft` carrying only the
 * minimal quick payload (marker `schemaId: 'quick-contact'` + `__quick__: true`)
 * and runs it through the SAME `finalizeDraft` path as a full protocol: fresh
 * DEK → encrypt payload → seal to org (+helper while shift open) + supervisors →
 * sign → enqueue to the encrypted outbox. It then bumps the local deployment
 * count and best-effort flushes when online.
 *
 * Everything sensitive (DEK, payload) stays on-device; only ciphertext is
 * enqueued/synced. All crypto goes through finalize.ts → crypto-core.
 */
import { getChainHead, getDeployment, bumpDeploymentCount, flush } from '$lib/store';
import { finalizeDraft } from '$lib/doc/finalize';
import { newProtocolId } from '$lib/protocols/marker';
import { loadSupervisors } from '$lib/supervisors';
import { api } from '$lib/api';
import type { ProtocolRecord } from '@aidlog/contracts';
import {
  buildQuickPayload,
  QUICK_CONTACT_SCHEMA_ID,
  QUICK_CONTACT_SCHEMA_VERSION,
  type QuickContactInput,
} from './types';

export interface SaveQuickContactResult {
  record: ProtocolRecord;
  /** true if the record was synced to the server, false if queued offline. */
  synced: boolean;
}

/**
 * Persist a quick contact as a signed record in the given deployment. Refreshes
 * the supervisor list first (best-effort) so the record is sealed to current
 * leads/admins for statistics. Throws if the session is locked or the org
 * identity is unavailable (surfaced by `finalizeDraft`).
 */
export async function saveQuickContact(
  deploymentId: string,
  input: QuickContactInput,
): Promise<SaveQuickContactResult> {
  // Best-effort refresh of the supervisor public keys so this contact is sealed
  // to the current leads/admins. finalize falls back to org(+helper) if empty.
  await loadSupervisors().catch(() => {});

  const meta = await getDeployment(deploymentId);
  const head = await getChainHead(deploymentId);

  const { record } = await finalizeDraft({
    draft: {
      deploymentId,
      // Each quick contact is its OWN tiny protocol → a fresh protocolId so it
      // lists as a separate entry (vs. full protocols and other quick contacts).
      protocolId: newProtocolId(),
      schemaId: QUICK_CONTACT_SCHEMA_ID,
      schemaVersion: QUICK_CONTACT_SCHEMA_VERSION,
      values: buildQuickPayload(input),
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
