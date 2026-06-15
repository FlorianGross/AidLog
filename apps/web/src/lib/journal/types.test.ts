/**
 * journal/types.test.ts — pure journal payload helpers (no crypto / I/O).
 */
import { describe, it, expect } from 'vitest';
import {
  buildJournalPayload,
  isJournalPayload,
  JOURNAL_FLAG_KEY,
  JOURNAL_CATEGORY_VALUES,
  type JournalEntryInput,
} from './types';
import { handoverSchema } from '$lib/schemas/handover';
import { validateSchema } from '$lib/schemas/editor';

function input(over: Partial<JournalEntryInput> = {}): JournalEntryInput {
  return {
    time: over.time ?? '2026-06-12T10:30:00.000Z',
    category: over.category ?? 'lagemeldung',
    text: over.text ?? 'Lage stabil, keine Nachforderung.',
    authorName: over.authorName,
  };
}

describe('buildJournalPayload', () => {
  it('stamps the journal marker flag and stable keys', () => {
    const p = buildJournalPayload(input());
    expect(p[JOURNAL_FLAG_KEY]).toBe(true);
    expect(p.j_time).toBe('2026-06-12T10:30:00.000Z');
    expect(p.j_category).toBe('lagemeldung');
    expect(p.j_text).toBe('Lage stabil, keine Nachforderung.');
  });

  it('trims the text and omits an empty author', () => {
    const p = buildJournalPayload(input({ text: '  Material angefordert  ', authorName: '   ' }));
    expect(p.j_text).toBe('Material angefordert');
    expect('j_author_name' in p).toBe(false);
  });

  it('keeps a non-empty author (trimmed)', () => {
    const p = buildJournalPayload(input({ authorName: '  ELW 1  ' }));
    expect(p.j_author_name).toBe('ELW 1');
  });

  it('accepts every defined category', () => {
    for (const c of JOURNAL_CATEGORY_VALUES) {
      expect(buildJournalPayload(input({ category: c })).j_category).toBe(c);
    }
  });
});

describe('isJournalPayload', () => {
  it('detects the marker flag and rejects others', () => {
    expect(isJournalPayload(buildJournalPayload(input()))).toBe(true);
    expect(isJournalPayload({})).toBe(false);
    expect(isJournalPayload({ __quick__: true })).toBe(false);
    expect(isJournalPayload(null)).toBe(false);
    expect(isJournalPayload(undefined)).toBe(false);
  });
});

describe('handoverSchema', () => {
  it('is a valid DocSchema', () => {
    expect(validateSchema(handoverSchema)).toEqual({ ok: true, errors: [] });
  });

  it('has the expected id, version and ISOBAR + signature sections', () => {
    expect(handoverSchema.schemaId).toBe('handover');
    expect(handoverSchema.version).toBe(1);
    const sig = handoverSchema.sections.find((s) => s.key === 'unterschriften');
    expect(sig?.fields.filter((f) => f.type === 'signature')).toHaveLength(2);
  });
});
