/**
 * lib/eventstats — per-deployment EINSATZSTATISTIK (lead + admin).
 *
 * Counts BOTH full ABCDE protocols AND quick contacts of one Veranstaltung,
 * decrypting each record with the caller's OWN supervisor-sealed DEK (no org
 * password). Decrypted payloads live in memory only; nothing is persisted.
 */
export {
  aggregateEvent,
  isQuickContact,
  isTrainingContact,
  type DecryptedContact,
  type EventStats,
} from './aggregate';
export { runEventStats, type EventStatsResult } from './run';
