/**
 * Tabbed documentation schema. This drives the drawer-navigated, multi-tab
 * editor: each `DocSection` is one tab (with a badge like A/B/C/D/E), and each
 * `DocField` is rendered by the dynamic form. Extending the protocol = editing
 * a schema, never the components.
 *
 * The decrypted form payload is a flat `Record<string, unknown>` keyed by
 * `DocField.key`. It is validated client-side and then encrypted as the
 * `EncryptedPayload` of a `ProtocolRecord` (see @aidlog/contracts).
 */
import type { Qualification } from '@aidlog/contracts';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'boolean'
  | 'date'
  | 'time'
  | 'datetime'
  | 'scale'
  | 'signature'
  /** Read-only value derived from sibling fields (see {@link ComputeSpec}). */
  | 'computed'
  /** Repeatable structured sub-records (see {@link DocField.itemFields}). */
  | 'group';

export interface FieldOption {
  value: string;
  label: string;
}

/**
 * Declarative recipe for a `'computed'` field. Intentionally trivial — NOT an
 * expression engine. Only `'sum'` is implemented now; `kind` is a union so it
 * can grow. A computed value is a PASSIVE documentation aid (e.g. a GCS total),
 * never advice. The result is clamped to `[min, max]` when those are set.
 */
export interface ComputeSpec {
  kind: 'sum';
  /** sibling `DocField.key`s whose numeric values are summed. */
  from: string[];
  min?: number;
  max?: number;
}

/**
 * Neutral, age-aware plausibility hint for a numeric field. A value outside the
 * resolved `[min, max]` is flagged as "out of normal range" — a passive visual
 * cue only, never a diagnosis or advice.
 *
 * Resolution: if `ageField` + `bands` are set, the renderer reads
 * `values[ageField]`, picks the matching band, and uses its `[min, max]`;
 * otherwise the flat top-level `[min, max]` is used. Band selection is left to
 * the pure `resolveBand` helper (the content phase defines the band keys).
 */
export interface PlausibilitySpec {
  /** sibling field key holding the age used to pick a band. */
  ageField?: string;
  /** named bands → range, e.g. { saeugling: { min: 100, max: 160 } }. */
  bands?: Record<string, { min?: number; max?: number }>;
  /** flat fallback range when no age band applies. */
  min?: number;
  max?: number;
}

export interface DocField {
  key: string;
  label: string;
  type: FieldType;
  options?: FieldOption[];
  /** unit suffix shown next to numeric inputs, e.g. '/min', 'mmHg', '%'. */
  unit?: string;
  help?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  required?: boolean;
  /** layout hint: 1 = half width, 2 = full width. */
  span?: 1 | 2;
  /**
   * For `type: 'group'` — the per-row sub-fields. Only SIMPLE leaf types are
   * allowed (text/textarea/number/select/multiselect/boolean/date/time/
   * datetime); no nested `group`/`signature`/`computed`. The stored value is an
   * array of objects keyed by each itemField.key.
   */
  itemFields?: DocField[];
  /** For `type: 'group'` — label for the "add row" button. */
  addLabel?: string;
  /** For `type: 'group'` — minimum/maximum number of rows. */
  minItems?: number;
  maxItems?: number;
  /** For `type: 'computed'` — how the read-only value is derived. */
  compute?: ComputeSpec;
  /** For numeric fields — optional neutral plausibility range/hint. */
  plausibility?: PlausibilitySpec;
}

export interface DocSection {
  key: string;
  title: string;
  /** short badge for the drawer tab, e.g. 'A','B','C','D','E','S'. */
  badge?: string;
  description?: string;
  fields: DocField[];
  /**
   * OPTIONAL minimum Sanitätsdienst qualification required to EDIT this section.
   * Additive + backward-compatible: when unset (the default for every existing
   * schema), the section is editable by anyone. When set, a user whose
   * qualification ranks BELOW it sees the section's fields READ-ONLY with a note
   * — a SOFT, documented gate (the whole protocol is never hard-blocked). The
   * value is a {@link Qualification} from `@aidlog/contracts`.
   */
  minQualification?: Qualification;
}

export interface DocSchema {
  schemaId: string;
  version: number;
  title: string;
  sections: DocSection[];
}
