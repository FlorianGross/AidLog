/**
 * doc/completeness.ts — derive per-section / overall completeness for the editor.
 *
 * "Completeness" is a soft progress indicator (how many fields have a value),
 * NOT validation. Signature fields count as filled when a signature image has
 * been captured for that field key.
 */
import type { DocField, DocSchema, DocSection } from '$lib/schemas/types';
import { computeValue } from '$lib/scores';

export interface SectionProgress {
  filled: number;
  total: number;
  /** 0..1 */
  ratio: number;
  complete: boolean;
}

/** True when a single group row has at least one non-empty leaf sub-value. */
function rowHasValue(row: unknown): boolean {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  for (const v of Object.values(row as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') {
      if (v.trim() !== '') return true;
    } else if (Array.isArray(v)) {
      if (v.length > 0) return true;
    } else if (typeof v === 'boolean') {
      if (v) return true;
    } else if (typeof v === 'number') {
      if (!Number.isNaN(v)) return true;
    } else {
      return true;
    }
  }
  return false;
}

/** Number of non-empty rows in a group field's value. */
function groupRowCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return value.filter(rowHasValue).length;
}

function hasValue(
  field: DocField,
  values: Record<string, unknown>,
  signedFields: Set<string>,
): boolean {
  if (field.type === 'signature') return signedFields.has(field.key);
  if (field.type === 'computed') return computeValue(field, values) !== null;
  if (field.type === 'group') return groupRowCount(values[field.key]) > 0;
  const v = values[field.key];
  if (v === undefined || v === null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'boolean') return true; // an explicit boolean is a value
  if (typeof v === 'number') return !Number.isNaN(v);
  return true;
}

export function sectionProgress(
  section: DocSection,
  values: Record<string, unknown>,
  signedFields: Set<string> = new Set(),
): SectionProgress {
  const total = section.fields.length;
  let filled = 0;
  for (const f of section.fields) if (hasValue(f, values, signedFields)) filled++;
  const ratio = total === 0 ? 1 : filled / total;
  return { filled, total, ratio, complete: filled === total };
}

export interface OverallProgress {
  filled: number;
  total: number;
  ratio: number;
  /** percentage 0..100 rounded. */
  percent: number;
}

export function overallProgress(
  schema: DocSchema,
  values: Record<string, unknown>,
  signedFields: Set<string> = new Set(),
): OverallProgress {
  let filled = 0;
  let total = 0;
  for (const section of schema.sections) {
    const p = sectionProgress(section, values, signedFields);
    filled += p.filled;
    total += p.total;
  }
  const ratio = total === 0 ? 1 : filled / total;
  return { filled, total, ratio, percent: Math.round(ratio * 100) };
}

export interface MissingField {
  key: string;
  label: string;
  sectionKey: string;
}

/**
 * HARD required-field gate (NOT soft progress): returns every `required` field
 * that has no value, using the same `hasValue` semantics. For `'group'` fields a
 * `minItems` requirement is also honoured (fewer non-empty rows than `minItems`
 * counts as missing even if one row is filled). Use this to gate finalization.
 */
export function missingRequired(
  schema: DocSchema,
  values: Record<string, unknown>,
  signedFields: Set<string> = new Set(),
): MissingField[] {
  const out: MissingField[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (!field.required) continue;
      let ok = hasValue(field, values, signedFields);
      if (ok && field.type === 'group' && field.minItems !== undefined) {
        ok = groupRowCount(values[field.key]) >= field.minItems;
      }
      if (!ok) out.push({ key: field.key, label: field.label, sectionKey: section.key });
    }
  }
  return out;
}
