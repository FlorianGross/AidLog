/**
 * analytics/labels.ts — map stable field keys / option values to human labels
 * using the active DocSchema. Labels are FIELD DEFINITIONS (org config), never
 * patient data, so using them in the export is safe.
 */
import type { DocSchema } from '$lib/schemas/types';
import type { LabelFn } from './export';

/** Build a label resolver from a DocSchema (field key → label, option value → label). */
export function schemaLabels(schema: DocSchema): LabelFn {
  const fieldLabel = new Map<string, string>();
  const optionLabel = new Map<string, string>(); // key: `${fieldKey}::${optionValue}`
  const vitalLabel = new Map<string, string>();

  for (const section of schema.sections) {
    for (const f of section.fields) {
      fieldLabel.set(f.key, f.label);
      vitalLabel.set(f.key, f.label);
      for (const opt of f.options ?? []) {
        optionLabel.set(`${f.key}::${opt.value}`, opt.label);
      }
      // Group sub-fields (e.g. the structured medication module) carry their own
      // coded selects (einheit/weg); register their labels + option labels under
      // the sub-field key so read views can resolve them too.
      for (const sub of f.itemFields ?? []) {
        fieldLabel.set(sub.key, sub.label);
        for (const opt of sub.options ?? []) {
          optionLabel.set(`${sub.key}::${opt.value}`, opt.label);
        }
      }
    }
  }

  return (kind, key, sub) => {
    if (kind === 'option') return optionLabel.get(`${key}::${sub}`) ?? sub ?? key;
    if (kind === 'vital') return vitalLabel.get(key) ?? key;
    return fieldLabel.get(key) ?? key;
  };
}
