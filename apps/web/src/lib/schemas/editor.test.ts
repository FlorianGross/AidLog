/**
 * Unit tests for the schema-editor pure helpers (no Svelte/DOM needed).
 */
import { describe, it, expect } from 'vitest';
import {
  slugifyKey,
  isValidKey,
  suggestKey,
  move,
  validateSchema,
  typeNeedsOptions,
  FIELD_TYPES,
} from './editor';
import { abcdeSchema } from './abcde';
import type { DocSchema } from './types';

describe('slugifyKey', () => {
  it('lowercases, transliterates umlauts and replaces separators', () => {
    expect(slugifyKey('Atemfrequenz / min')).toBe('atemfrequenz_min');
    expect(slugifyKey('Größe')).toBe('groesse');
    expect(slugifyKey('Übergabe an')).toBe('uebergabe_an');
  });
  it('prefixes a leading digit so the key is a valid identifier', () => {
    expect(slugifyKey('1. Wert')).toBe('f_1_wert');
    expect(isValidKey(slugifyKey('1. Wert'))).toBe(true);
  });
  it('returns empty for non-alphanumeric input', () => {
    expect(slugifyKey('---')).toBe('');
  });
});

describe('isValidKey', () => {
  it('accepts identifiers, rejects bad starts/chars', () => {
    expect(isValidKey('a_field1')).toBe(true);
    expect(isValidKey('_x')).toBe(true);
    expect(isValidKey('1x')).toBe(false);
    expect(isValidKey('has space')).toBe(false);
    expect(isValidKey('hä')).toBe(false);
  });
});

describe('suggestKey', () => {
  it('appends a numeric suffix on collision', () => {
    expect(suggestKey('Puls', ['puls'])).toBe('puls_2');
    expect(suggestKey('Puls', ['puls', 'puls_2'])).toBe('puls_3');
  });
  it('falls back when the label slugifies to nothing', () => {
    expect(suggestKey('***', [])).toBe('feld');
  });
});

describe('move', () => {
  it('moves an item and clamps at the edges', () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});

describe('typeNeedsOptions / FIELD_TYPES', () => {
  it('only select/multiselect need options', () => {
    expect(typeNeedsOptions('select')).toBe(true);
    expect(typeNeedsOptions('multiselect')).toBe(true);
    expect(typeNeedsOptions('text')).toBe(false);
  });
  it('exposes all 11 supported field types', () => {
    expect(FIELD_TYPES).toHaveLength(11);
  });
});

describe('validateSchema', () => {
  it('passes for a clean, fully-unique schema', () => {
    const clean: DocSchema = {
      schemaId: 'x',
      version: 1,
      title: 'X',
      sections: [
        { key: 's1', title: 'S1', fields: [{ key: 'a', label: 'A', type: 'text' }] },
        { key: 's2', title: 'S2', fields: [{ key: 'b', label: 'B', type: 'number' }] },
      ],
    };
    expect(validateSchema(clean).ok).toBe(true);
  });

  it('accepts the built-in ABCDE template (all field keys unique across sections)', () => {
    // The payload is a FLAT record keyed by field key, so keys must be unique
    // across ALL sections. The shipped template satisfies this (the former
    // m_medikamente collision was renamed to m_medikamentengabe).
    const r = validateSchema(abcdeSchema);
    expect(r.ok).toBe(true);
  });
  it('flags no sections, empty sections, duplicate and invalid keys, missing options', () => {
    const bad: DocSchema = {
      schemaId: '',
      version: 1,
      title: 'x',
      sections: [
        { key: 's1', title: 'S1', fields: [] },
        {
          key: 's2',
          title: 'S2',
          fields: [
            { key: 'dup', label: 'A', type: 'text' },
            { key: 'dup', label: 'B', type: 'text' },
            { key: '1bad', label: 'C', type: 'text' },
            { key: 'sel', label: 'D', type: 'select', options: [] },
          ],
        },
      ],
    };
    const r = validateSchema(bad);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'schemaId',
        'emptySection',
        'duplicateKey',
        'invalidKey',
        'missingOptions',
      ]),
    );
  });
});
