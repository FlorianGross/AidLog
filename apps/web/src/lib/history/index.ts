/**
 * Public surface of the change-history + integrity feature (Verlauf).
 *
 * Append-only model: corrections append a NEW record with `supersedes` set, so
 * the full history is reconstructable from the record chain. This module:
 *   - decrypts records locally (decryptEntries),
 *   - computes field-level diffs for corrections (buildCorrectionDiffs/buildDiff),
 *   - verifies the chain via crypto.verifyRecord (checkIntegrity).
 */
export {
  decryptEntries,
  buildDiff,
  buildCorrectionDiffs,
  supersededIds,
  checkIntegrity,
  inChainOrder,
  labelMap,
  shortKeyId,
} from './history';
export type {
  DecryptedEntry,
  FieldDiff,
  CorrectionDiff,
  RecordIntegrity,
  IntegrityReport,
} from './types';
export { default as IntegrityPanel } from './IntegrityPanel.svelte';
export { default as DiffView } from './DiffView.svelte';
