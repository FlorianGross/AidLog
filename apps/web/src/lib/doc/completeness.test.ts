/**
 * Unit tests for the hard required-field gate (`missingRequired`) and the
 * extended `hasValue` semantics for `group`/`computed` fields, exercised via
 * `sectionProgress`. No DOM/crypto.
 */
import { describe, it, expect } from 'vitest';
import { missingRequired, sectionProgress } from './completeness';
import type { DocSchema, DocSection } from '$lib/schemas/types';

const schema: DocSchema = {
  schemaId: 's',
  version: 1,
  title: 'T',
  sections: [
    {
      key: 'sec',
      title: 'Sec',
      fields: [
        { key: 'name', label: 'Name', type: 'text', required: true },
        { key: 'sig', label: 'Unterschrift', type: 'signature', required: true },
        {
          key: 'meds',
          label: 'Maßnahmen',
          type: 'group',
          required: true,
          minItems: 2,
          itemFields: [{ key: 'm', label: 'Medikament', type: 'text' }],
        },
        { key: 'note', label: 'Notiz', type: 'text' }, // not required
      ],
    },
  ],
};

describe('missingRequired', () => {
  it('lists a required text field that is empty', () => {
    const r = missingRequired(schema, {}, new Set());
    expect(r.map((m) => m.key)).toContain('name');
    expect(r[0]).toMatchObject({ key: 'name', label: 'Name', sectionKey: 'sec' });
  });

  it('does not list a filled required text field', () => {
    const r = missingRequired(schema, { name: 'Mustermann' }, new Set());
    expect(r.map((m) => m.key)).not.toContain('name');
  });

  it('lists a required signature with no capture, not one with a capture', () => {
    expect(missingRequired(schema, {}, new Set()).map((m) => m.key)).toContain('sig');
    expect(missingRequired(schema, {}, new Set(['sig'])).map((m) => m.key)).not.toContain('sig');
  });

  it('lists a group whose non-empty rows are below minItems', () => {
    const oneRow = { meds: [{ m: 'A' }] };
    expect(missingRequired(schema, oneRow, new Set()).map((m) => m.key)).toContain('meds');
    const twoRows = { meds: [{ m: 'A' }, { m: 'B' }] };
    expect(missingRequired(schema, twoRows, new Set()).map((m) => m.key)).not.toContain('meds');
  });

  it('ignores empty group rows when counting', () => {
    const padded = { meds: [{ m: 'A' }, { m: '' }, {}] };
    expect(missingRequired(schema, padded, new Set()).map((m) => m.key)).toContain('meds');
  });
});

describe('sectionProgress with group/computed', () => {
  const section: DocSection = {
    key: 's',
    title: 'S',
    fields: [
      { key: 'a', label: 'A', type: 'number' },
      { key: 'b', label: 'B', type: 'number' },
      {
        key: 'total',
        label: 'Summe',
        type: 'computed',
        compute: { kind: 'sum', from: ['a', 'b'] },
      },
      {
        key: 'g',
        label: 'G',
        type: 'group',
        itemFields: [{ key: 'x', label: 'X', type: 'text' }],
      },
    ],
  };

  it('counts a computed field as filled only when its value is present', () => {
    expect(sectionProgress(section, {}).filled).toBe(0);
    expect(sectionProgress(section, { a: 3, b: 4 }).filled).toBe(3); // a, b, total
  });

  it('counts a group as filled with at least one non-empty row', () => {
    expect(sectionProgress(section, { g: [] }).filled).toBe(0);
    expect(sectionProgress(section, { g: [{ x: 'hi' }] }).filled).toBe(1);
    expect(sectionProgress(section, { g: [{ x: '' }] }).filled).toBe(0);
  });
});
