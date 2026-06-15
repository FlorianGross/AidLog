/**
 * Unit tests for the protocol-category pure helpers (no Svelte/DOM needed).
 */
import { describe, it, expect } from 'vitest';
import {
  roleSatisfies,
  sortCategories,
  categoriesForRole,
  categoryById,
  schemaForCategory,
  isDocSchema,
} from './helpers';
import { abcdeSchema } from '$lib/schemas/abcde';
import type { ProtocolCategory } from '@aidlog/contracts';
import type { DocSchema } from '$lib/schemas/types';

function cat(partial: Partial<ProtocolCategory> & { id: string }): ProtocolCategory {
  return {
    orgId: 'org',
    name: partial.name ?? partial.id,
    createPermission: 'all',
    schema: null,
    sortOrder: 0,
    active: true,
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedByKeyId: 'k',
    ...partial,
  };
}

const miniSchema: DocSchema = {
  schemaId: 'mini',
  version: 1,
  title: 'Mini',
  sections: [{ key: 's', title: 'S', fields: [{ key: 'f', label: 'F', type: 'text' }] }],
};

describe('roleSatisfies', () => {
  it("'all' admits every role", () => {
    expect(roleSatisfies('all', 'helper')).toBe(true);
    expect(roleSatisfies('all', 'lead')).toBe(true);
    expect(roleSatisfies('all', 'admin')).toBe(true);
  });
  it("'lead' admits lead and admin only", () => {
    expect(roleSatisfies('lead', 'helper')).toBe(false);
    expect(roleSatisfies('lead', 'lead')).toBe(true);
    expect(roleSatisfies('lead', 'admin')).toBe(true);
  });
  it("'admin' admits admin only", () => {
    expect(roleSatisfies('admin', 'helper')).toBe(false);
    expect(roleSatisfies('admin', 'lead')).toBe(false);
    expect(roleSatisfies('admin', 'admin')).toBe(true);
  });
  it('a null/locked role may create nothing', () => {
    expect(roleSatisfies('all', null)).toBe(false);
    expect(roleSatisfies('all', undefined)).toBe(false);
  });
});

describe('sortCategories', () => {
  it('orders by sortOrder, then name', () => {
    const list = [
      cat({ id: 'b', name: 'B', sortOrder: 1 }),
      cat({ id: 'a2', name: 'A2', sortOrder: 0 }),
      cat({ id: 'a1', name: 'A1', sortOrder: 0 }),
    ];
    expect(sortCategories(list).map((c) => c.id)).toEqual(['a1', 'a2', 'b']);
  });
  it('does not mutate the input', () => {
    const list = [cat({ id: 'b', sortOrder: 1 }), cat({ id: 'a', sortOrder: 0 })];
    const before = list.map((c) => c.id);
    sortCategories(list);
    expect(list.map((c) => c.id)).toEqual(before);
  });
});

describe('categoriesForRole', () => {
  const list = [
    cat({ id: 'all', createPermission: 'all', sortOrder: 0 }),
    cat({ id: 'lead', createPermission: 'lead', sortOrder: 1 }),
    cat({ id: 'admin', createPermission: 'admin', sortOrder: 2 }),
    cat({ id: 'inactive', createPermission: 'all', active: false, sortOrder: 3 }),
  ];
  it('helper sees only all-permission active categories', () => {
    expect(categoriesForRole(list, 'helper').map((c) => c.id)).toEqual(['all']);
  });
  it('lead sees all + lead', () => {
    expect(categoriesForRole(list, 'lead').map((c) => c.id)).toEqual(['all', 'lead']);
  });
  it('admin sees all + lead + admin', () => {
    expect(categoriesForRole(list, 'admin').map((c) => c.id)).toEqual(['all', 'lead', 'admin']);
  });
  it('excludes inactive categories', () => {
    expect(categoriesForRole(list, 'admin').some((c) => c.id === 'inactive')).toBe(false);
  });
});

describe('categoryById', () => {
  const list = [cat({ id: 'x' }), cat({ id: 'y' })];
  it('finds a category by id', () => {
    expect(categoryById(list, 'y')?.id).toBe('y');
  });
  it('returns undefined for missing/empty ids', () => {
    expect(categoryById(list, 'z')).toBeUndefined();
    expect(categoryById(list, undefined)).toBeUndefined();
    expect(categoryById(list, '')).toBeUndefined();
  });
});

describe('schemaForCategory fallback chain', () => {
  it('uses the category schema when present and valid', () => {
    const c = cat({ id: 'c', schema: miniSchema });
    expect(schemaForCategory(c, abcdeSchema).schemaId).toBe('mini');
  });
  it('falls back to the org-active schema when the category has none', () => {
    const c = cat({ id: 'c', schema: null });
    expect(schemaForCategory(c, miniSchema).schemaId).toBe('mini');
  });
  it('falls back to ABCDE when neither is available (old deployments)', () => {
    expect(schemaForCategory(undefined, null).schemaId).toBe(abcdeSchema.schemaId);
    expect(schemaForCategory(null).schemaId).toBe(abcdeSchema.schemaId);
  });
  it('ignores an invalid (empty) category schema', () => {
    const c = cat({ id: 'c', schema: { nope: true } });
    expect(schemaForCategory(c, miniSchema).schemaId).toBe('mini');
  });
});

describe('isDocSchema', () => {
  it('accepts a real DocSchema and rejects junk', () => {
    expect(isDocSchema(miniSchema)).toBe(true);
    expect(isDocSchema(null)).toBe(false);
    expect(isDocSchema({})).toBe(false);
    expect(isDocSchema({ schemaId: 'x' })).toBe(false);
  });
});
