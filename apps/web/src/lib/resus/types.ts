/**
 * resus/types.ts — the "Reanimation" (CPR) data model.
 *
 * The whole resuscitation record rides along inside the SAME encrypted record
 * payload as the rest of the documentation, under the stable key
 * `reanimation: ResusLog`. It is a plain structured value, so it inherits the
 * record's E2E encryption and the offline draft persistence — no new upload
 * path, no plaintext ever leaves the device.
 *
 * The log is an append-style list of timestamped events plus a few derived
 * counters (shocks, adrenaline doses) and the settings the assistant was run
 * with. Times are stored as ISO-8601 strings so they survive (de)serialisation
 * and a page refresh.
 */

/** The stable payload key under which the resus record is persisted. */
export const REANIMATION_KEY = 'reanimation' as const;

/** Kinds of timestamped CPR events. Stable string ids (used as i18n suffix). */
export type ResusEventType =
  | 'start' // Reanimationsbeginn
  | 'shock' // Defibrillation / Schock
  | 'adrenalin' // Adrenalingabe
  | 'medication' // sonstige Medikamentengabe
  | 'rhythm' // Rhythmuskontrolle
  | 'rosc' // ROSC (return of spontaneous circulation)
  | 'abort' // Abbruch der Reanimation
  | 'note'; // freie Notiz

/** One timestamped entry in the resuscitation event log. */
export interface ResusEvent {
  /** stable id for list keying (non-secret, client-generated). */
  id: string;
  type: ResusEventType;
  /** ISO-8601 timestamp of when the event was logged. */
  at: string;
  /** optional free-text note (always present for type 'note'). */
  note?: string;
}

/** Assistant settings, persisted so a refresh restores the same configuration. */
export interface ResusSettings {
  /** metronome rate in compressions per minute (100–120). */
  bpm: number;
  /** adrenaline reminder interval in minutes (3–5). */
  adrenalinIntervalMin: number;
}

/** The full resuscitation record stored under REANIMATION_KEY. */
export interface ResusLog {
  /** ISO-8601 timestamp of CPR start, or null if not started. */
  startedAt: string | null;
  /** ISO-8601 timestamp of the end (ROSC/Abbruch), or null if ongoing. */
  endedAt: string | null;
  /** running shock counter. */
  shocks: number;
  /** running adrenaline-dose counter. */
  adrenalinDoses: number;
  /** the timestamped event log, in insertion order. */
  events: ResusEvent[];
  settings: ResusSettings;
}

/** Sensible defaults: 110/min metronome, 4-min adrenaline interval. */
export const DEFAULT_RESUS_SETTINGS: ResusSettings = {
  bpm: 110,
  adrenalinIntervalMin: 4,
};

/** An empty, not-yet-started resuscitation record. */
export function emptyResusLog(): ResusLog {
  return {
    startedAt: null,
    endedAt: null,
    shocks: 0,
    adrenalinDoses: 0,
    events: [],
    settings: { ...DEFAULT_RESUS_SETTINGS },
  };
}

function isEventType(v: unknown): v is ResusEventType {
  return (
    v === 'start' ||
    v === 'shock' ||
    v === 'adrenalin' ||
    v === 'medication' ||
    v === 'rhythm' ||
    v === 'rosc' ||
    v === 'abort' ||
    v === 'note'
  );
}

/**
 * Type guard / normaliser: narrow an unknown payload value to a ResusLog,
 * filling in any missing fields with safe defaults. Returns a fresh empty log
 * for anything unrecognised so the editor never throws on a stale payload.
 */
export function asResusLog(value: unknown): ResusLog {
  if (!value || typeof value !== 'object') return emptyResusLog();
  const v = value as Partial<ResusLog>;
  const events = Array.isArray(v.events)
    ? v.events.filter(
        (e): e is ResusEvent =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as ResusEvent).id === 'string' &&
          typeof (e as ResusEvent).at === 'string' &&
          isEventType((e as ResusEvent).type),
      )
    : [];
  const s = (v.settings ?? {}) as Partial<ResusSettings>;
  return {
    startedAt: typeof v.startedAt === 'string' ? v.startedAt : null,
    endedAt: typeof v.endedAt === 'string' ? v.endedAt : null,
    shocks: typeof v.shocks === 'number' && v.shocks >= 0 ? Math.floor(v.shocks) : 0,
    adrenalinDoses:
      typeof v.adrenalinDoses === 'number' && v.adrenalinDoses >= 0
        ? Math.floor(v.adrenalinDoses)
        : 0,
    events,
    settings: {
      bpm: clampBpm(typeof s.bpm === 'number' ? s.bpm : DEFAULT_RESUS_SETTINGS.bpm),
      adrenalinIntervalMin: clampInterval(
        typeof s.adrenalinIntervalMin === 'number'
          ? s.adrenalinIntervalMin
          : DEFAULT_RESUS_SETTINGS.adrenalinIntervalMin,
      ),
    },
  };
}

/** True when the record carries any meaningful resuscitation data. */
export function hasResusData(log: ResusLog): boolean {
  return (
    log.startedAt !== null || log.events.length > 0 || log.shocks > 0 || log.adrenalinDoses > 0
  );
}

/** A short, non-secret id for an event row. */
export function newResusEventId(): string {
  return globalThis.crypto.randomUUID();
}

/** Clamp metronome rate to the supported 100–120/min band. */
export function clampBpm(bpm: number): number {
  return Math.min(120, Math.max(100, Math.round(bpm)));
}

/** Clamp adrenaline interval to the supported 3–5 min band. */
export function clampInterval(min: number): number {
  return Math.min(5, Math.max(3, Math.round(min)));
}
