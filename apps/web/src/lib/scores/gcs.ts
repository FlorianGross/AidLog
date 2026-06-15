/**
 * scores/gcs.ts — pure Glasgow-Coma-Scale total helper.
 *
 * PASSIVE DOCUMENTATION AID ONLY: this sums the numeric component values a
 * clinician selected. It contains no diagnosis, no advice, no dosing. The
 * component keys + their option values are defined by the protocol content, not
 * here — this module just adds the picked numbers.
 */

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Sum the numeric values of `fromKeys` in `values`. Returns `null` if ANY
 * referenced value is missing or non-numeric (an incomplete GCS has no total).
 * When `min`/`max` are given the result is clamped into that range.
 */
export function gcsTotal(
  values: Record<string, unknown>,
  fromKeys: string[],
  opts?: { min?: number; max?: number },
): number | null {
  if (fromKeys.length === 0) return null;
  let sum = 0;
  for (const key of fromKeys) {
    const n = toNumber(values[key]);
    if (n === null) return null;
    sum += n;
  }
  if (opts?.min !== undefined && sum < opts.min) sum = opts.min;
  if (opts?.max !== undefined && sum > opts.max) sum = opts.max;
  return sum;
}

/**
 * Neutral, NON-advisory severity band key for a GCS total (e.g. for a label
 * lookup). Returns `null` when there is no total. The returned key is a plain
 * bucket name — it carries no recommendation. Standard GCS buckets:
 * 13–15 → 'leicht', 9–12 → 'mittel', 3–8 → 'schwer'.
 */
export function gcsBand(total: number | null): 'leicht' | 'mittel' | 'schwer' | null {
  if (total === null) return null;
  if (total >= 13) return 'leicht';
  if (total >= 9) return 'mittel';
  return 'schwer';
}
