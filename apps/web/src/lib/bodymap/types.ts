/**
 * bodymap/types.ts — injury body-map data model + photo blob labelling.
 *
 * Body-map markers ride along in the encrypted record payload under the stable
 * key `bodymap: BodyMarker[]` (structured value → inherits the record's E2E
 * encryption, no new upload path).
 *
 * Photos are NOT in the payload: they are binary blobs encrypted under the record
 * DEK and attached via the EXISTING blob-ticket/outbox flow (see finalize.ts).
 * We mark a blob as a body-map photo with the label prefix below so a reader can
 * map blobs back to this feature (mirrors the signature-label convention).
 */

/** The stable payload key under which markers are persisted. */
export const BODYMAP_KEY = 'bodymap' as const;

/** Blob-label prefix that tags an attachment as a body-map / record photo. */
export const PHOTO_LABEL_PREFIX = 'photo:';

/** Build the blob label for a captured photo (id is the in-draft photo id). */
export function photoLabel(photoId: string): string {
  return PHOTO_LABEL_PREFIX + photoId;
}

/** Recover the photo id from a blob label, or null if it is not a photo label. */
export function photoIdFromLabel(label: string | undefined): string | null {
  if (!label || !label.startsWith(PHOTO_LABEL_PREFIX)) return null;
  return label.slice(PHOTO_LABEL_PREFIX.length);
}

export type BodySide = 'front' | 'back';

/** Severity drives the marker tone (ok / warning / danger). */
export type InjurySeverity = 'leicht' | 'mittel' | 'schwer';

/** A short, stable, vendor-neutral set of injury types. */
export type InjuryType = 'wunde' | 'fraktur' | 'verbrennung' | 'prellung' | 'schmerz' | 'sonstiges';

/** One injury marker placed on the silhouette. x/y are 0..1 fractions of the SVG. */
export interface BodyMarker {
  id: string;
  /** 0..1 horizontal fraction within the chosen side's silhouette. */
  x: number;
  /** 0..1 vertical fraction within the chosen side's silhouette. */
  y: number;
  side: BodySide;
  type: InjuryType;
  severity: InjurySeverity;
  note?: string;
}

export const INJURY_TYPES: InjuryType[] = [
  'wunde',
  'fraktur',
  'verbrennung',
  'prellung',
  'schmerz',
  'sonstiges',
];

export const SEVERITIES: InjurySeverity[] = ['leicht', 'mittel', 'schwer'];

/** Map severity to a design-token tone for badges / marker fills. */
export function severityTone(s: InjurySeverity): 'ok' | 'warning' | 'danger' {
  return s === 'leicht' ? 'ok' : s === 'mittel' ? 'warning' : 'danger';
}

/** The CSS color (rgb-triplet token) used to fill a marker for a severity. */
export function severityColor(s: InjurySeverity): string {
  return s === 'leicht'
    ? 'rgb(var(--ok))'
    : s === 'mittel'
      ? 'rgb(var(--warning))'
      : 'rgb(var(--danger))';
}

/** Type guard: narrow an unknown payload value to BodyMarker[]. */
export function asMarkers(value: unknown): BodyMarker[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is BodyMarker =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as BodyMarker).id === 'string' &&
      typeof (m as BodyMarker).x === 'number' &&
      typeof (m as BodyMarker).y === 'number',
  );
}

export function newMarkerId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * A captured photo held in the editor before/while it becomes a record blob.
 * `data` is the downscaled JPEG/PNG bytes (encrypted only at finalize, like
 * signatures). For an already-finalized record, `data` is the decrypted preview.
 */
export interface DraftPhoto {
  id: string;
  mediaType: string;
  data: Uint8Array;
  capturedAt: string;
}
