/**
 * Unit tests for the pure scores/plausibility helpers. No DOM, no crypto —
 * exercises gcsTotal (sum, missing→null, clamp), computeValue, resolveBand
 * (age-band pick + flat fallback) and vitalStatus (low/ok/high/unknown).
 */
import { describe, it, expect } from 'vitest';
import { gcsTotal, gcsBand } from './gcs';
import { computeValue } from './compute';
import { resolveBand, vitalStatus } from './plausibility';
import type { DocField } from '$lib/schemas/types';

describe('gcsTotal', () => {
  it('sums the numeric component values', () => {
    expect(gcsTotal({ eye: 4, verbal: 5, motor: 6 }, ['eye', 'verbal', 'motor'])).toBe(15);
  });
  it('coerces numeric strings (select option values are strings)', () => {
    expect(gcsTotal({ eye: '4', verbal: '5', motor: '6' }, ['eye', 'verbal', 'motor'])).toBe(15);
  });
  it('returns null when any component is missing or non-numeric', () => {
    expect(gcsTotal({ eye: 4, verbal: 5 }, ['eye', 'verbal', 'motor'])).toBeNull();
    expect(gcsTotal({ eye: 4, verbal: 'x', motor: 6 }, ['eye', 'verbal', 'motor'])).toBeNull();
  });
  it('clamps into [min,max]', () => {
    expect(gcsTotal({ a: 1, b: 1, c: 1 }, ['a', 'b', 'c'], { min: 3, max: 15 })).toBe(3);
    expect(gcsTotal({ a: 9, b: 9, c: 9 }, ['a', 'b', 'c'], { min: 3, max: 15 })).toBe(15);
  });
  it('returns null for an empty component list', () => {
    expect(gcsTotal({}, [])).toBeNull();
  });
});

describe('gcsBand', () => {
  it('buckets a total into a neutral severity key, null when no total', () => {
    expect(gcsBand(15)).toBe('leicht');
    expect(gcsBand(11)).toBe('mittel');
    expect(gcsBand(6)).toBe('schwer');
    expect(gcsBand(null)).toBeNull();
  });
});

describe('computeValue', () => {
  const field = (compute: DocField['compute']): DocField => ({
    key: 'gcs',
    label: 'GCS',
    type: 'computed',
    compute,
  });

  it('sums the referenced sibling values', () => {
    const f = field({ kind: 'sum', from: ['a', 'b'] });
    expect(computeValue(f, { a: 4, b: 5 })).toBe(9);
  });
  it('returns null on a missing input', () => {
    const f = field({ kind: 'sum', from: ['a', 'b'] });
    expect(computeValue(f, { a: 4 })).toBeNull();
  });
  it('clamps into [min,max]', () => {
    const f = field({ kind: 'sum', from: ['a', 'b'], min: 3, max: 15 });
    expect(computeValue(f, { a: 1, b: 1 })).toBe(3);
  });
  it('returns null when the field is not computed or has no spec', () => {
    expect(computeValue({ key: 'x', label: 'X', type: 'number' }, { x: 1 })).toBeNull();
    expect(computeValue(field(undefined), { a: 1, b: 1 })).toBeNull();
  });
});

describe('resolveBand', () => {
  it('picks the age band whose numeric key is the highest <= age', () => {
    const spec = {
      ageField: 'alter',
      bands: {
        '0': { min: 100, max: 160 },
        '1': { min: 90, max: 150 },
        '12': { min: 60, max: 100 },
      },
    };
    expect(resolveBand(spec, { alter: 0 })).toEqual({ min: 100, max: 160 });
    expect(resolveBand(spec, { alter: 5 })).toEqual({ min: 90, max: 150 });
    expect(resolveBand(spec, { alter: 40 })).toEqual({ min: 60, max: 100 });
  });
  it('falls back to the flat range when the age is missing or below all bounds', () => {
    const spec = {
      ageField: 'alter',
      bands: { '18': { min: 60, max: 100 } },
      min: 50,
      max: 120,
    };
    expect(resolveBand(spec, {})).toEqual({ min: 50, max: 120 });
    expect(resolveBand(spec, { alter: 5 })).toEqual({ min: 50, max: 120 });
  });
  it('uses the flat range when no age band is configured', () => {
    expect(resolveBand({ min: 60, max: 100 }, {})).toEqual({ min: 60, max: 100 });
  });
  it('returns null when there is no usable range', () => {
    expect(resolveBand(undefined, {})).toBeNull();
    expect(resolveBand({}, {})).toBeNull();
  });
});

describe('vitalStatus', () => {
  const band = { min: 60, max: 100 };
  it('classifies low/ok/high', () => {
    expect(vitalStatus(40, band)).toBe('low');
    expect(vitalStatus(80, band)).toBe('ok');
    expect(vitalStatus(140, band)).toBe('high');
  });
  it('is unknown without a band or comparable bound', () => {
    expect(vitalStatus(80, null)).toBe('unknown');
    expect(vitalStatus(80, {})).toBe('unknown');
  });
  it('honours a one-sided band', () => {
    expect(vitalStatus(120, { max: 100 })).toBe('high');
    expect(vitalStatus(80, { max: 100 })).toBe('ok');
    expect(vitalStatus(40, { min: 60 })).toBe('low');
  });
});
