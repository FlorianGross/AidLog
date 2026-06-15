/**
 * scores/ — pure, framework-free helpers for derived scores and neutral
 * plausibility hints used by the protocol schema engine. No DOM, no crypto, no
 * network. All outputs are PASSIVE documentation aids (no advice/diagnosis).
 */
export { gcsTotal, gcsBand } from './gcs';
export { computeValue } from './compute';
export { resolveBand, vitalStatus, type Band, type VitalStatus } from './plausibility';
export { NACA_OPTIONS } from './naca';
