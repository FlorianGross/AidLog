import { describe, it, expect } from 'vitest';
import { validate } from './validate';
import { buildFields } from './schema-fields';
import { exampleSchema } from './example-schema';

describe('schema validation (AJV) against the example schema', () => {
  it('accepts a valid patient-contact payload', () => {
    const data = {
      timestamp: '2026-06-11T10:30:00.000Z',
      location: 'First-aid post A',
      patientPseudonym: 'Patient 3',
      ageBand: '18-39',
      sex: 'female',
      complaint: 'Dizziness after heat exposure',
      vitals: { rrSys: 120, rrDia: 80, hf: 88, spo2: 98, gcs: 15, avpu: 'A' },
      handoverTarget: 'self-care',
      transported: false,
    };
    const res = validate(exampleSchema, data);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('rejects a payload missing a required field', () => {
    const data = {
      timestamp: '2026-06-11T10:30:00.000Z',
      location: 'Post A',
      // patientPseudonym missing
      ageBand: '18-39',
      complaint: 'x',
    };
    const res = validate(exampleSchema, data);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.path === 'patientPseudonym')).toBe(true);
    expect(res.byField['patientPseudonym']?.length).toBeGreaterThan(0);
  });

  it('rejects an out-of-range vital and an unknown enum value', () => {
    const data = {
      timestamp: '2026-06-11T10:30:00.000Z',
      location: 'Post A',
      patientPseudonym: 'Patient 1',
      ageBand: 'not-a-band',
      complaint: 'x',
      vitals: { spo2: 250 },
    };
    const res = validate(exampleSchema, data);
    expect(res.valid).toBe(false);
    // both the enum and the maximum violations should surface
    const paths = res.errors.map((e) => e.path);
    expect(paths).toContain('ageBand');
    expect(paths.some((p) => p.startsWith('vitals'))).toBe(true);
  });
});

describe('dynamic field derivation drives the form (adding a field = schema edit)', () => {
  it('derives ordered renderable fields incl. flattened vitals group', () => {
    const fields = buildFields(exampleSchema.jsonSchema, exampleSchema.uiSchema);
    const byPath = Object.fromEntries(fields.map((f) => [f.path, f]));

    // order respected
    expect(fields[0]?.path).toBe('timestamp');
    // enum → select
    expect(byPath['ageBand']?.widget).toBe('select');
    expect(byPath['ageBand']?.enum).toContain('18-39');
    // nested object flattened into a group
    expect(byPath['vitals.spo2']?.group).toBe('Vital signs');
    expect(byPath['vitals.spo2']?.widget).toBe('integer');
    // uiSchema widget override
    expect(byPath['freeText']?.widget).toBe('textarea');
    expect(byPath['photo']?.widget).toBe('image-capture');
    // required propagated
    expect(byPath['complaint']?.required).toBe(true);
  });
});
