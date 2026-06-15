/**
 * journal/types.ts — the EINSATZTAGEBUCH (event journal / ELW-Logbuch) model.
 *
 * A journal entry is a REAL signed ProtocolRecord (sealed to org + supervisors,
 * riding the same encrypted outbox/sync as a full protocol) but with a MINIMAL,
 * OPERATIONAL payload describing an event of the whole Einsatz — NOT a patient
 * contact. It is marked by `schemaId === EVENT_JOURNAL_SCHEMA_ID` AND a reserved
 * payload flag `__journal__: true`, so readers/aggregators can tell a journal
 * entry apart from quick contacts and full protocols.
 *
 * Keys are stable/whitelistable (`j_` prefix) so a reader can map them without
 * the schema: j_time, j_category, j_text, j_author_name.
 */

/** schemaId stamped on a journal entry's encrypted payload. */
export const EVENT_JOURNAL_SCHEMA_ID = 'event-journal';
export const EVENT_JOURNAL_SCHEMA_VERSION = 1;

/** Reserved payload flag marking a record as a journal entry. */
export const JOURNAL_FLAG_KEY = '__journal__';

/** Operational categories of a journal entry (stable ids; labels via i18n). */
export type JournalCategory =
  | 'alarmierung'
  | 'lagemeldung'
  | 'nachforderung'
  | 'wetter_umfeld'
  | 'material'
  | 'sonstiges';

/** Category options in display order. Labels resolved via i18n. */
export const JOURNAL_CATEGORY_VALUES: readonly JournalCategory[] = [
  'alarmierung',
  'lagemeldung',
  'nachforderung',
  'wetter_umfeld',
  'material',
  'sonstiges',
] as const;

/** The flat values a responder fills in the journal form. */
export interface JournalEntryInput {
  /** Zeitpunkt (ISO 8601) — defaults to now. */
  time: string;
  category: JournalCategory;
  /** Free-text description of the event. */
  text: string;
  /** Optional author display name. */
  authorName?: string;
}

/** A decrypted journal entry reduced to what the timeline view needs. */
export interface JournalEntry {
  /** record id (immutable). */
  id: string;
  seq: number;
  /** server/record creation timestamp (ISO). */
  createdAt: string;
  /** entered event time (ISO), from `j_time`; falls back to createdAt. */
  time: string;
  category: string;
  text: string;
  authorName: string | null;
}

/**
 * Build the minimal, canonical journal payload. Keys are stable so a reader can
 * map them without the schema. `j_text` and `j_author_name` are trimmed.
 */
export function buildJournalPayload(input: JournalEntryInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    [JOURNAL_FLAG_KEY]: true,
    j_time: input.time,
    j_category: input.category,
    j_text: input.text.trim(),
  };
  const author = input.authorName?.trim();
  if (author) payload.j_author_name = author;
  return payload;
}

/** True if a decrypted payload is a journal entry (marker flag). */
export function isJournalPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return !!payload && payload[JOURNAL_FLAG_KEY] === true;
}
