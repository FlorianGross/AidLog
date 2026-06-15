/**
 * Public surface of the QUICK PATIENT-CONTACT (Schnell-Erfassung) feature.
 *
 * A quick contact is a REAL signed ProtocolRecord with a minimal payload, marked
 * by `schemaId: 'quick-contact'` + `__quick__: true`, sealed to org + helper +
 * supervisors and ridden through the same encrypted outbox/sync as a full
 * protocol. The aggregator distinguishes it via {@link isQuickPayload}.
 */
export { default as QuickEntry } from './QuickEntry.svelte';
export { saveQuickContact, type SaveQuickContactResult } from './save';
export {
  QUICK_CONTACT_SCHEMA_ID,
  QUICK_CONTACT_SCHEMA_VERSION,
  QUICK_FLAG_KEY,
  isQuickPayload,
  buildQuickPayload,
  versorgungToVerbleib,
  VERSORGUNGSART_VALUES,
  VERBLEIB_VALUES,
  ALTERSGRUPPE_VALUES,
  GESCHLECHT_VALUES,
  ERSTEINDRUCK_VALUES,
  type QuickContactInput,
  type Versorgungsart,
} from './types';
