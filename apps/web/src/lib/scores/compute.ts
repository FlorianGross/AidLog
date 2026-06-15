/**
 * scores/compute.ts — pure evaluation of a `'computed'` DocField.
 *
 * Trivial and declarative by design (currently only `kind: 'sum'`). A computed
 * value is a PASSIVE documentation aid derived from sibling fields; it is never
 * advice and never a diagnosis.
 */
import type { DocField } from '$lib/schemas/types';

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Evaluate `field.compute` against `values`. Returns the derived number, or
 * `null` when the field is not computed, has no spec, or any input is
 * missing/non-numeric. The `'sum'` kind sums `compute.from`, clamped to
 * `[compute.min, compute.max]` when set.
 */
export function computeValue(field: DocField, values: Record<string, unknown>): number | null {
  const spec = field.compute;
  if (field.type !== 'computed' || !spec) return null;

  if (spec.kind === 'sum') {
    if (spec.from.length === 0) return null;
    let sum = 0;
    for (const key of spec.from) {
      const n = toNumber(values[key]);
      if (n === null) return null;
      sum += n;
    }
    if (spec.min !== undefined && sum < spec.min) sum = spec.min;
    if (spec.max !== undefined && sum > spec.max) sum = spec.max;
    return sum;
  }

  return null;
}
