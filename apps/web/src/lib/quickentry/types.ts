/**
 * quickentry/types.ts — the lightweight QUICK PATIENT-CONTACT model.
 *
 * A quick contact is a REAL signed ProtocolRecord (sealed to org + helper +
 * supervisors, riding the same encrypted outbox/sync as a full protocol) but
 * with a MINIMAL payload. It is marked by `schemaId === QUICK_CONTACT_SCHEMA_ID`
 * AND a reserved payload flag `__quick__: true`, so the aggregator can tell a
 * quick contact from a full ABCDE protocol and count both.
 *
 * The payload deliberately reuses the SAME field keys + option values as the
 * ABCDE schema for the analytics whitelist (`ersteindruck`, `altersgruppe`,
 * `geschlecht`, `u_verbleib`) so existing aggregation logic counts them with no
 * special-casing; quick-only fields use a `q_` prefix.
 */

/** schemaId stamped on a quick-contact record's encrypted payload. */
export const QUICK_CONTACT_SCHEMA_ID = 'quick-contact';
export const QUICK_CONTACT_SCHEMA_VERSION = 1;

/** Reserved payload flag marking a record as a quick contact (vs. a full protocol). */
export const QUICK_FLAG_KEY = '__quick__';

/** Versorgungsart — how the contact was handled. Maps onto `u_verbleib` values. */
export type Versorgungsart = 'bagatelle' | 'ambulant' | 'rtw' | 'notarzt' | 'verweigerung';

/** The flat values a responder fills in the quick-contact form. */
export interface QuickContactInput {
  /** Uhrzeit (ISO 8601) — defaults to now. */
  time: string;
  versorgungsart: Versorgungsart;
  /** Verbleib (free-ish short select) — where the patient ended up. */
  verbleib: string;
  altersgruppe: string;
  geschlecht: string;
  /** kurze Beschwerde (short complaint, free text). */
  beschwerde: string;
  /** Ersteindruck — optional severity. */
  ersteindruck?: string;
}

/** Versorgungsart options (value = stable id, label key resolved via i18n). */
export const VERSORGUNGSART_VALUES: readonly Versorgungsart[] = [
  'bagatelle',
  'ambulant',
  'rtw',
  'notarzt',
  'verweigerung',
] as const;

/** Verbleib options (where the patient ends up). Stable ids; labels via i18n. */
export const VERBLEIB_VALUES = ['vor_ort', 'rtw', 'notarzt', 'klinik', 'hausarzt'] as const;

/** Altersgruppe — mirrors the ABCDE `ageBand` option values. */
export const ALTERSGRUPPE_VALUES = [
  'saeugling',
  'kleinkind',
  'kind',
  'jugendlich',
  'erwachsen',
  'senior',
] as const;

/** Geschlecht — mirrors the ABCDE `sex` option values. */
export const GESCHLECHT_VALUES = ['w', 'm', 'd', 'unbekannt'] as const;

/** Ersteindruck — mirrors the ABCDE `ersteindruck` option values. */
export const ERSTEINDRUCK_VALUES = ['unauffaellig', 'kritisch', 'lebensbedrohlich'] as const;

/**
 * Map a Versorgungsart onto a `u_verbleib` value so the SHARED analytics
 * disposition logic (TRANSPORT_VALUES / REFUSAL_VALUES, $lib/analytics/types)
 * counts it without a special case. `bagatelle`/`ambulant` are on-site care →
 * `vor_ort` (neither transport nor refusal).
 */
export function versorgungToVerbleib(v: Versorgungsart): string {
  switch (v) {
    case 'rtw':
      return 'rtw';
    case 'notarzt':
      return 'notarzt';
    case 'verweigerung':
      return 'verweigerung';
    default:
      return 'vor_ort';
  }
}

/**
 * Build the minimal, canonical quick-contact payload. Reuses ABCDE field keys so
 * the analytics whitelist picks them up. `u_verbleib` is derived from the chosen
 * Versorgungsart (or the explicit Verbleib if it is a known disposition value).
 */
export function buildQuickPayload(input: QuickContactInput): Record<string, unknown> {
  const u_verbleib = input.verbleib?.trim()
    ? input.verbleib.trim()
    : versorgungToVerbleib(input.versorgungsart);
  const payload: Record<string, unknown> = {
    [QUICK_FLAG_KEY]: true,
    q_versorgungsart: input.versorgungsart,
    q_beschwerde: input.beschwerde.trim(),
    q_time: input.time,
    u_verbleib,
    altersgruppe: input.altersgruppe,
    geschlecht: input.geschlecht,
  };
  if (input.ersteindruck) payload.ersteindruck = input.ersteindruck;
  return payload;
}

/** True if a decrypted payload is a quick contact (marker flag). */
export function isQuickPayload(payload: Record<string, unknown> | null | undefined): boolean {
  return !!payload && payload[QUICK_FLAG_KEY] === true;
}
