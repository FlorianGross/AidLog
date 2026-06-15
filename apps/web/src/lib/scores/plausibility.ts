/**
 * scores/plausibility.ts — pure, neutral plausibility-range helpers.
 *
 * A resolved band is just a `[min, max]` window for a numeric vital value. A
 * value outside it is "out of normal range" — a PASSIVE visual hint only. No
 * diagnosis, no advice, no dosing. Band selection is a plain range/age lookup.
 */
import type { PlausibilitySpec } from '$lib/schemas/types';

export type Band = { min?: number; max?: number };
export type VitalStatus = 'ok' | 'low' | 'high' | 'unknown';

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Resolve the active plausibility band for a field's spec against `values`.
 *
 * - If `ageField` + `bands` are set, read the age from `values[ageField]` and
 *   pick the band whose key the age maps to. The band KEYS are defined by the
 *   protocol content; we select numerically by treating each band key as an
 *   inclusive lower-age bound when it parses as a number, otherwise we fall back
 *   to the flat `[min, max]`. Bands whose key parses as a number are sorted
 *   ascending and the highest bound `<= age` wins.
 * - Otherwise (or when no band matches) the flat top-level `[min, max]` is used.
 *
 * Returns `null` when no usable range exists at all.
 */
export function resolveBand(
  spec: PlausibilitySpec | undefined,
  values: Record<string, unknown>,
): Band | null {
  if (!spec) return null;

  const flat: Band | null =
    spec.min !== undefined || spec.max !== undefined ? { min: spec.min, max: spec.max } : null;

  if (spec.ageField && spec.bands) {
    const age = toNumber(values[spec.ageField]);
    if (age !== null) {
      // Numeric band keys = inclusive lower age bounds; pick the highest <= age.
      const numeric = Object.keys(spec.bands)
        .map((k) => ({ k, bound: Number(k) }))
        .filter((e) => Number.isFinite(e.bound))
        .sort((a, b) => a.bound - b.bound);
      let chosen: string | null = null;
      for (const e of numeric) {
        if (age >= e.bound) chosen = e.k;
      }
      if (chosen !== null) {
        const b = spec.bands[chosen];
        if (b && (b.min !== undefined || b.max !== undefined)) return { min: b.min, max: b.max };
      }
    }
  }

  return flat;
}

/**
 * Classify a numeric value against a resolved band. `'unknown'` when there is no
 * band or no comparable bound on the relevant side.
 */
export function vitalStatus(value: number, band: Band | null): VitalStatus {
  if (!band) return 'unknown';
  if (!Number.isFinite(value)) return 'unknown';
  if (band.min === undefined && band.max === undefined) return 'unknown';
  if (band.min !== undefined && value < band.min) return 'low';
  if (band.max !== undefined && value > band.max) return 'high';
  return 'ok';
}
