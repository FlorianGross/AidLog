/**
 * Pure helpers for the in-app PROTOCOL SCHEMA EDITOR (admin UI under
 * `src/routes/admin/schema`). These operate on the `DocSchema` shape from
 * `./types` and never touch patient data — a schema is FIELD DEFINITIONS only.
 *
 * Kept framework-free (no Svelte) so the editor page stays thin and these are
 * unit-testable. `store.ts`/`types.ts`/`abcde.ts` are CONSUMED, never modified.
 */
import type { DocField, DocSchema, DocSection, FieldType } from './types';

/**
 * The SIMPLE leaf field types the picker offers and that may appear as group
 * sub-fields. Mirrors a subset of the `FieldType` union in `./types`; the
 * `satisfies` annotation makes a drift in that union break this build. The
 * engine-only types `computed` and `group` are deliberately NOT listed here yet
 * — they have no admin builder UI (optional follow-up). `validateSchema` still
 * ACCEPTS them on imported/programmatic schemas.
 */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'boolean',
  'date',
  'time',
  'datetime',
  'scale',
  'signature',
] as const satisfies readonly FieldType[];

/** Leaf field types allowed inside a `group` field's `itemFields`. */
export const GROUP_ITEM_FIELD_TYPES: readonly FieldType[] = [
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'boolean',
  'date',
  'time',
  'datetime',
];

/** Field types that carry a list of options. */
export const OPTION_FIELD_TYPES: readonly FieldType[] = ['select', 'multiselect'];

export function typeNeedsOptions(type: FieldType): boolean {
  return OPTION_FIELD_TYPES.includes(type);
}

/**
 * Slugify a human label into a valid, stable field/section key:
 * lowercase, umlauts/ß transliterated, non-alphanumerics → underscores, and a
 * leading letter guaranteed (identifiers may not start with a digit).
 */
export function slugifyKey(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip remaining combining diacritics
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
  if (!base) return '';
  // Identifiers may not start with a digit.
  return /^[0-9]/.test(base) ? `f_${base}` : base;
}

/** A valid key: starts with a letter/underscore, then word chars only. */
export function isValidKey(key: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

/**
 * Suggest a unique key for `label`, avoiding everything in `taken`. Appends
 * `_2`, `_3`, … on collision. Returns a guaranteed-non-empty fallback if the
 * label slugifies to nothing.
 */
export function suggestKey(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugifyKey(label) || 'feld';
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/** Collect the keys of every field across every section (for uniqueness checks). */
export function allFieldKeys(schema: DocSchema): string[] {
  return schema.sections.flatMap((s) => s.fields.map((f) => f.key));
}

/** Keys used by fields OTHER than `field` (so a field can keep its own key). */
export function otherFieldKeys(schema: DocSchema, field: DocField): string[] {
  return schema.sections
    .flatMap((s) => s.fields)
    .filter((f) => f !== field)
    .map((f) => f.key);
}

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}`;
}

/** A blank section with a unique placeholder key the admin can rename. */
export function newSection(taken: Iterable<string>): DocSection {
  const key = suggestKey('abschnitt', taken);
  return {
    key: key || `abschnitt_${uniqueSuffix()}`,
    title: 'Neuer Abschnitt',
    badge: '',
    fields: [],
  };
}

/** A blank text field with a unique placeholder key. */
export function newField(taken: Iterable<string>): DocField {
  const key = suggestKey('feld', taken);
  return { key: key || `feld_${uniqueSuffix()}`, label: 'Neues Feld', type: 'text', span: 2 };
}

/** Move item at `index` by `delta` (clamped). Returns a new array. */
export function move<T>(arr: readonly T[], index: number, delta: number): T[] {
  const next = arr.slice();
  const target = index + delta;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

export interface ValidationResult {
  ok: boolean;
  /** i18n keys (under `schemaEditor.errors`) describing each problem. */
  errors: string[];
}

/**
 * Validate a `DocSchema` before saving: at least one section, every section has
 * at least one field, all field keys are valid identifiers, and all field keys
 * are unique across the whole schema. Returns i18n keys, not prose, so the page
 * can localise. Mirrors the server's shape guard but is stricter on the client.
 */
export function validateSchema(schema: DocSchema): ValidationResult {
  const errors: string[] = [];
  if (!schema.schemaId || !schema.schemaId.trim()) errors.push('schemaId');
  if (schema.sections.length === 0) errors.push('noSections');

  const seen = new Set<string>();
  let hasEmptySection = false;
  let hasInvalidKey = false;
  let hasDuplicate = false;
  let hasMissingOptions = false;
  let hasBadGroup = false;

  for (const section of schema.sections) {
    if (section.fields.length === 0) hasEmptySection = true;
    for (const field of section.fields) {
      if (!isValidKey(field.key)) hasInvalidKey = true;
      if (seen.has(field.key)) hasDuplicate = true;
      seen.add(field.key);
      if (typeNeedsOptions(field.type) && (!field.options || field.options.length === 0)) {
        hasMissingOptions = true;
      }
      if (field.type === 'group') {
        const items = field.itemFields ?? [];
        if (items.length === 0) hasBadGroup = true;
        const innerSeen = new Set<string>();
        for (const sub of items) {
          // Group sub-keys are local to each row (not in the flat payload), so
          // they must be valid identifiers and unique WITHIN the group, and may
          // only be simple leaf types (no nested group/signature/computed).
          if (!isValidKey(sub.key) || innerSeen.has(sub.key)) hasBadGroup = true;
          innerSeen.add(sub.key);
          if (!GROUP_ITEM_FIELD_TYPES.includes(sub.type)) hasBadGroup = true;
          if (typeNeedsOptions(sub.type) && (!sub.options || sub.options.length === 0)) {
            hasMissingOptions = true;
          }
        }
      }
    }
  }

  if (hasEmptySection) errors.push('emptySection');
  if (hasInvalidKey) errors.push('invalidKey');
  if (hasDuplicate) errors.push('duplicateKey');
  if (hasMissingOptions) errors.push('missingOptions');
  if (hasBadGroup) errors.push('invalidGroup');

  return { ok: errors.length === 0, errors };
}
