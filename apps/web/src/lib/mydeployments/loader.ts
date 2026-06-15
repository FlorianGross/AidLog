/**
 * mydeployments/loader.ts — assemble the "Meine Einsätze" list (cross-device).
 *
 * "Meine Einsätze" lists the deployments the logged-in user AUTHORED, on ANY
 * device. The cross-device source of truth is the server (api.myDeployments),
 * which returns NON-secret metadata only: deployment ids, the caller's record
 * count, and the first/last client timestamps — it knows no titles/categories.
 *
 * To produce nice labels we MERGE three local sources, all best-effort:
 *   1. The server list (authoritative for which deployments + counts + dates).
 *   2. The client-local DeploymentMeta (IndexedDB) — present only on the device
 *      that created the deployment; gives the human title, category, training
 *      flag, and event master-data. Never synced, so absent on a new device.
 *   3. A best-effort DECRYPT of that deployment's latest cached record with the
 *      viewer's OWN identity (possible because every record is sealed to its
 *      author via the persistent 'author' wrapper). This recovers the category id
 *      (embedded in the payload under CATEGORY_ID_KEY) and the training flag even
 *      when there is no local DeploymentMeta — so a new device still shows more
 *      than a bare id.
 *
 * FORWARD-ONLY CAVEAT: records created BEFORE the 'author' wrapper existed are
 * NOT sealed to the author, so on a new device they cannot be decrypted here
 * (only org/admin can). Such entries still LIST (id + date + count) but carry no
 * decrypted category/training hint — surfaced honestly in the UI.
 *
 * All decryption happens in memory via the existing crypto wrapper; nothing is
 * sent anywhere and no plaintext is persisted.
 */
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import type { MyDeploymentSummary } from '@aidlog/contracts';
import { decryptRecord } from '$lib/crypto';
import { getDeployment, getDeploymentRecords, type DeploymentMeta } from '$lib/store';
import { CATEGORY_ID_KEY } from '$lib/categories';
import { isTrainingPayload } from '$lib/training';

/** One row in the "Meine Einsätze" list, merged from server + local sources. */
export interface MyDeploymentEntry {
  deploymentId: string;
  /** Records the caller authored in this deployment (from the server). */
  recordCount: number;
  /** Earliest / latest client timestamp (ISO 8601) of the caller's records. */
  firstCreatedAt: string;
  lastCreatedAt: string;
  /** Human title — only if a local DeploymentMeta exists on THIS device. */
  title?: string;
  /** Category id — local meta first, else recovered from a decrypted record. */
  categoryId?: string;
  /** True if this deployment is an ÜBUNG (training) — local flag or payload flag. */
  training: boolean;
  /** True when a local DeploymentMeta was found (this device created it). */
  hasLocalMeta: boolean;
  /**
   * True when at least one of this deployment's records could be DECRYPTED with
   * the viewer's own identity. False for FORWARD-ONLY legacy records (no 'author'
   * wrapper) seen on a device that lacks the local meta — the UI flags those.
   */
  decryptable: boolean;
}

/**
 * Recover non-secret display hints (category id, training flag) from a
 * deployment's cached records by decrypting the LATEST one the viewer can open.
 * Returns `decryptable: false` if no cached record could be decrypted (e.g.
 * forward-only legacy records with no 'author' wrapper, or nothing synced yet).
 */
async function recoverFromRecords(
  deploymentId: string,
  identity: IdentityKeyPair,
): Promise<{ categoryId?: string; training: boolean; decryptable: boolean }> {
  const records = await getDeploymentRecords(deploymentId);
  // Newest first — the latest record carries the most current category/flags.
  for (const record of [...records].reverse()) {
    try {
      const { payload } = await decryptRecord(record, identity);
      const values = (payload && typeof payload === 'object' ? payload : {}) as Record<
        string,
        unknown
      >;
      const cat = values[CATEGORY_ID_KEY];
      return {
        categoryId: typeof cat === 'string' ? cat : undefined,
        training: isTrainingPayload(values),
        decryptable: true,
      };
    } catch {
      // Not decryptable with this identity (forward-only legacy record) — try the
      // next-older record; some may predate and some follow the 'author' wrapper.
      continue;
    }
  }
  return { training: false, decryptable: false };
}

/**
 * Merge ONE server summary with local meta + a best-effort record decrypt into a
 * display entry. Pure-ish: reads IndexedDB + decrypts in memory, writes nothing.
 */
export async function buildEntry(
  summary: MyDeploymentSummary,
  identity: IdentityKeyPair,
): Promise<MyDeploymentEntry> {
  const meta: DeploymentMeta | undefined = await getDeployment(summary.deploymentId);
  const recovered = await recoverFromRecords(summary.deploymentId, identity);

  return {
    deploymentId: summary.deploymentId,
    recordCount: summary.recordCount,
    firstCreatedAt: summary.firstCreatedAt,
    lastCreatedAt: summary.lastCreatedAt,
    ...(meta?.title ? { title: meta.title } : {}),
    categoryId: meta?.categoryId ?? recovered.categoryId,
    training: meta?.training === true || recovered.training,
    hasLocalMeta: meta !== undefined,
    decryptable: recovered.decryptable,
  };
}

/**
 * Build the full "Meine Einsätze" list from the server summaries, newest first.
 * The server already orders by lastCreatedAt desc; we preserve that order.
 */
export async function buildEntries(
  summaries: MyDeploymentSummary[],
  identity: IdentityKeyPair,
): Promise<MyDeploymentEntry[]> {
  return Promise.all(summaries.map((s) => buildEntry(s, identity)));
}
