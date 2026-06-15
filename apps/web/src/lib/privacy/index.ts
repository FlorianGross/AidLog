/**
 * lib/privacy — CLIENT-SIDE GDPR data-protection helpers.
 *
 *  - retention : pure years↔days + cutoff helpers for the retention UI.
 *  - dsar      : Art. 15 subject-access export (on-device decrypt with the org key).
 *  - ropa      : Art. 30 record-of-processing-activities document (no personal data).
 *
 * The crypto-shredding ERASURE itself happens server-side (DELETE of sealed_keys
 * via api.purgeRetention); these helpers cover the parts the zero-knowledge
 * server cannot do (decrypt-to-export) and the pure document/maths builders.
 */
export { DAYS_PER_YEAR, yearsToDays, daysToYears, policyCutoff } from './retention';
export { buildDsarExport, dsarToJson, type DsarExport, type DsarRecord } from './dsar';
export { buildRopa, ropaToJson, type RopaDocument, type RopaInput, type RopaSection } from './ropa';
