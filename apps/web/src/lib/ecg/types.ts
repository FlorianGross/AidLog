/**
 * ecg/types.ts — 12-lead ECG & device/defibrillator findings data model.
 *
 * The whole ECG record rides along inside the SAME encrypted record payload as
 * the rest of the documentation, under the stable key `ekg: EcgRecord`. It is a
 * plain structured value, so it inherits the record's E2E encryption and the
 * offline draft persistence (doc/draftStore) — no new upload path, no plaintext
 * ever leaves the device, and finalize via the unchanged buildRecord flow works
 * without any crypto changes.
 *
 * STRIP IMAGES: captured 12-lead printout photos are downscaled + EXIF-stripped
 * on-device (REUSING `$lib/bodymap/photo.ts` → downscaleImage) and held as raw
 * bytes. Because ECG detail matters and a reader must be able to zoom into the
 * trace, every strip is base64-encoded and carried INSIDE this structured
 * payload (`EcgStrip.data`), so it is encrypted under the record DEK together
 * with the rest of the payload — exactly like body-map markers, but for binary
 * image content. Each strip carries a stable client id; the canonical blob-label
 * convention for a strip is `ecg:<id>` (see `ecgStripLabel`), kept here so a
 * reader can map a strip back to this feature and so the naming is consistent
 * with the body-map `photo:<id>` / signature `sig-field:<key>` conventions.
 */

/** The stable payload key under which the ECG record is persisted. */
export const EKG_KEY = 'ekg' as const;

/** Blob-label prefix that tags an attachment as a 12-lead ECG strip image. */
export const ECG_LABEL_PREFIX = 'ecg:';

/** Build the blob label for a captured ECG strip (id is the in-draft strip id). */
export function ecgStripLabel(stripId: string): string {
  return ECG_LABEL_PREFIX + stripId;
}

/** Recover the strip id from a blob label, or null if it is not an ECG label. */
export function stripIdFromLabel(label: string | undefined): string | null {
  if (!label || !label.startsWith(ECG_LABEL_PREFIX)) return null;
  return label.slice(ECG_LABEL_PREFIX.length);
}

/** Generate a stable, client-side, non-secret id for a strip. */
export function newEcgId(): string {
  return globalThis.crypto.randomUUID();
}

// --- Structured findings vocabulary -----------------------------------------

/** Cardiac rhythm. Stable string ids (used as i18n suffix under `ecg.rhythm`). */
export type EcgRhythm =
  | 'sinus'
  | 'sinusbrady'
  | 'sinustachy'
  | 'af' // Vorhofflimmern
  | 'aflutter' // Vorhofflattern
  | 'svt'
  | 'vt'
  | 'vf'
  | 'asystolie'
  | 'pea' // pulslose elektrische Aktivität
  | 'avblock'
  | 'schrittmacher' // Schrittmacherrhythmus
  | 'sonstiges';

export const ECG_RHYTHMS: EcgRhythm[] = [
  'sinus',
  'sinusbrady',
  'sinustachy',
  'af',
  'aflutter',
  'svt',
  'vt',
  'vf',
  'asystolie',
  'pea',
  'avblock',
  'schrittmacher',
  'sonstiges',
];

/** Electrical axis (Lagetyp). */
export type EcgAxis = 'links' | 'indifferent' | 'steil' | 'rechts' | 'ueberdreht';

export const ECG_AXES: EcgAxis[] = ['links', 'indifferent', 'steil', 'rechts', 'ueberdreht'];

/** ST-segment change direction. */
export type StChange = 'keine' | 'hebung' | 'senkung';

export const ST_CHANGES: StChange[] = ['keine', 'hebung', 'senkung'];

/** QRS width classification. */
export type QrsWidth = 'schmal' | 'breit';

export const QRS_WIDTHS: QrsWidth[] = ['schmal', 'breit'];

/** Interpretation / suspicion (Verdacht). */
export type EcgVerdacht =
  | 'unauffaellig'
  | 'stemi'
  | 'nstemi'
  | 'ischaemie'
  | 'arrhythmie'
  | 'sonstiges';

export const ECG_VERDACHTE: EcgVerdacht[] = [
  'unauffaellig',
  'stemi',
  'nstemi',
  'ischaemie',
  'arrhythmie',
  'sonstiges',
];

/** The 12 standard leads, used for the ST-change multiselect. */
export type EcgLead =
  | 'I'
  | 'II'
  | 'III'
  | 'aVR'
  | 'aVL'
  | 'aVF'
  | 'V1'
  | 'V2'
  | 'V3'
  | 'V4'
  | 'V5'
  | 'V6';

export const ECG_LEADS: EcgLead[] = [
  'I',
  'II',
  'III',
  'aVR',
  'aVL',
  'aVF',
  'V1',
  'V2',
  'V3',
  'V4',
  'V5',
  'V6',
];

/**
 * One captured 12-lead ECG printout photo. `data` is the downscaled JPEG bytes
 * (EXIF-stripped via the canvas re-encode in bodymap/photo.ts). It rides inside
 * the encrypted payload — see the file header for why it is in-payload (zoomable
 * detail) rather than a separate blob. For a finalized record `data` is the
 * decrypted preview bytes.
 */
export interface EcgStrip {
  /** stable client id; canonical blob label is `ecg:<id>` (see ecgStripLabel). */
  id: string;
  mediaType: string;
  /** base64 of the downscaled, EXIF-stripped image bytes. */
  data: string;
  capturedAt: string;
}

/** Structured 12-lead ECG findings + device/defibrillator values. */
export interface EcgRecord {
  /** Captured 12-lead printout photos (zoomable in the viewer). */
  strips: EcgStrip[];

  // --- 12-lead interpretation -----------------------------------------------
  rhythm?: EcgRhythm;
  /** Heart rate in /min. */
  frequenz?: number;
  /** Electrical axis (Lagetyp). */
  lagetyp?: EcgAxis;
  /** ST-segment change direction. */
  stChange?: StChange;
  /** Leads affected by the ST change (multiselect). */
  stLeads?: EcgLead[];
  qrsWidth?: QrsWidth;
  verdacht?: EcgVerdacht;
  /** Free-text remark. */
  bemerkung?: string;

  // --- Device / defibrillator values ----------------------------------------
  /** Number of delivered shocks. */
  schocks?: number;
  /** Defibrillation energy in Joule. */
  energie?: number;
  /** Pacing (Schrittmacher) used. */
  schrittmacher?: boolean;
  /**
   * Device operating mode — e.g. "4-Stellig" (manual/monitor) vs "AED"
   * (automated). Stable string id used as i18n suffix under `ecg.mode`.
   */
  modus?: EcgMode;
}

/** Defi/monitor operating mode. */
export type EcgMode = 'aed' | 'manuell' | 'monitor';

export const ECG_MODES: EcgMode[] = ['aed', 'manuell', 'monitor'];

/** An empty ECG record (no strips, no findings). */
export function emptyEcgRecord(): EcgRecord {
  return { strips: [] };
}

/** Type guard: narrow an unknown payload value to a well-formed EcgRecord. */
export function asEcgRecord(value: unknown): EcgRecord {
  if (!value || typeof value !== 'object') return emptyEcgRecord();
  const v = value as Partial<EcgRecord>;
  const strips = Array.isArray(v.strips)
    ? v.strips.filter(
        (s): s is EcgStrip =>
          !!s &&
          typeof s === 'object' &&
          typeof (s as EcgStrip).id === 'string' &&
          typeof (s as EcgStrip).data === 'string',
      )
    : [];
  return { ...v, strips };
}

/** True when an ECG record carries any meaningful content (for tab counts). */
export function ecgItemCount(rec: EcgRecord): number {
  let n = rec.strips.length;
  if (rec.rhythm || rec.frequenz != null || rec.verdacht || rec.lagetyp) n += 1;
  return n;
}

/** Map a verdacht to a design-token badge tone. */
export function verdachtTone(v: EcgVerdacht | undefined): 'ok' | 'warning' | 'danger' | 'muted' {
  if (v === 'unauffaellig') return 'ok';
  if (v === 'stemi') return 'danger';
  if (v === 'nstemi' || v === 'ischaemie') return 'warning';
  return 'muted';
}

/** Map a rhythm to a design-token badge tone (shockable / arrest → danger). */
export function rhythmTone(r: EcgRhythm | undefined): 'ok' | 'warning' | 'danger' | 'muted' {
  if (!r) return 'muted';
  if (r === 'vf' || r === 'vt' || r === 'asystolie' || r === 'pea') return 'danger';
  if (r === 'svt' || r === 'af' || r === 'aflutter' || r === 'avblock') return 'warning';
  if (r === 'sinus') return 'ok';
  return 'muted';
}
