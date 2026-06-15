/**
 * training/index.ts — the ÜBUNGS-/DEMO-MODUS (training/exercise) marker.
 *
 * A deployment (Einsatz/Veranstaltung) can be flagged as a TRAINING exercise so
 * that practice documentation never pollutes real statistics, the admin
 * Auswertung, or exports. The flag travels two complementary ways:
 *
 *   1. On the LOCAL {@link DeploymentMeta} (`training?: boolean`) so the creating
 *      device can show ÜBUNG badges/banners without decrypting anything.
 *   2. STAMPED into the encrypted record payload as a reserved marker
 *      `__training__: true` (set by `finalizeDraft`), so ANY device that syncs
 *      the records — which has no copy of the local DeploymentMeta — can still
 *      tell a training record apart and exclude/flag it.
 *
 * This mirrors the existing payload markers `__quick__` ($lib/quickentry) and
 * `__journal__` ($lib/journal). The marker is a NON-secret boolean that rides
 * the normal encrypted envelope; no crypto/signing logic is involved here.
 */

/** Reserved payload flag marking a record as TRAINING/exercise data. */
export const TRAINING_FLAG_KEY = '__training__';

/** True if a decrypted payload is a training/exercise record (marker flag). */
export function isTrainingPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return !!payload && payload[TRAINING_FLAG_KEY] === true;
}
