/**
 * Public surface of the EINSATZTAGEBUCH (event journal / ELW-Logbuch) feature.
 *
 * A journal entry is a REAL signed ProtocolRecord with a minimal OPERATIONAL
 * payload (events of the whole Einsatz, not patient-specific), marked by
 * `schemaId: 'event-journal'` + `__journal__: true`, sealed to org + supervisors
 * and ridden through the same encrypted outbox/sync as a full protocol. The
 * reader distinguishes it via {@link isJournalPayload}; the Einsatzleitung
 * (lead/admin) decrypts it with their own supervisor-sealed DEK.
 */
export {
  EVENT_JOURNAL_SCHEMA_ID,
  EVENT_JOURNAL_SCHEMA_VERSION,
  JOURNAL_FLAG_KEY,
  JOURNAL_CATEGORY_VALUES,
  buildJournalPayload,
  isJournalPayload,
  type JournalCategory,
  type JournalEntryInput,
  type JournalEntry,
} from './types';
export { saveJournalEntry, type SaveJournalEntryResult } from './save';
export { loadJournal, type JournalLoadResult } from './load';
