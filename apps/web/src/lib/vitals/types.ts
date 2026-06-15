/**
 * vitals/types.ts — the "Vitalparameter-Verlauf" data model.
 *
 * A record's payload may carry a repeatable series of timestamped vital-sign
 * readings under the stable key `vitalverlauf: VitalReading[]`. This rides along
 * inside the SAME encrypted payload as the rest of the form data (it is just a
 * structured value), so it inherits the record's E2E encryption — no new upload
 * path, no plaintext leaves the device.
 *
 * Numeric fields are optional: a reading may capture only some parameters. Empty
 * strings from inputs are normalised to `undefined` on store.
 */

/** The stable payload key under which the series is persisted. */
export const VITALVERLAUF_KEY = 'vitalverlauf' as const;

/** One timestamped set of vital signs. */
export interface VitalReading {
  /** stable id for list keying / editing (non-secret, client-generated). */
  id: string;
  /** time of measurement — "HH:mm" local clock string (Uhrzeit). */
  time: string;
  /** RR systolic, mmHg. */
  rrSys?: number;
  /** RR diastolic, mmHg. */
  rrDia?: number;
  /** heart rate, /min. */
  hf?: number;
  /** respiratory rate, /min. */
  af?: number;
  /** SpO₂, %. */
  spo2?: number;
  /** blood glucose, mg/dl. */
  bz?: number;
  /** temperature, °C. */
  temp?: number;
  /** Glasgow Coma Scale total (3–15). */
  gcs?: number;
}

/** A plottable numeric series descriptor. */
export interface VitalParamDef {
  /** key on VitalReading. */
  key: Exclude<keyof VitalReading, 'id' | 'time'>;
  /** short i18n key suffix (vitals.param.<short>). */
  short: string;
  unit: string;
  /** axis tone token used for the line stroke. */
  tone: 'brand' | 'danger' | 'warning' | 'ok' | 'fg';
}

/**
 * The parameters we offer in the chart legend / editor, in display order.
 * RR is plotted as systolic (the clinically dominant trend line); diastolic is
 * shown in the table but kept off the chart to avoid clutter.
 */
export const VITAL_PARAMS: VitalParamDef[] = [
  { key: 'rrSys', short: 'rrSys', unit: 'mmHg', tone: 'danger' },
  { key: 'hf', short: 'hf', unit: '/min', tone: 'brand' },
  { key: 'af', short: 'af', unit: '/min', tone: 'warning' },
  { key: 'spo2', short: 'spo2', unit: '%', tone: 'ok' },
  { key: 'bz', short: 'bz', unit: 'mg/dl', tone: 'fg' },
  { key: 'temp', short: 'temp', unit: '°C', tone: 'warning' },
  { key: 'gcs', short: 'gcs', unit: '', tone: 'brand' },
];

/** Type guard: narrow an unknown payload value to a VitalReading[]. */
export function asReadings(value: unknown): VitalReading[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (r): r is VitalReading =>
      !!r && typeof r === 'object' && typeof (r as VitalReading).id === 'string',
  );
}

/** A short, non-secret id for a reading row. */
export function newReadingId(): string {
  return globalThis.crypto.randomUUID();
}

/** Current "HH:mm" local time, used to prefill a new reading. */
export function nowHHmm(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
