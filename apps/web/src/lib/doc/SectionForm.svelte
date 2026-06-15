<!--
  SectionForm.svelte — render ONE DocSection's fields for the tabbed editor.

  Supports every FieldType in the ABCDE/SAMPLER schema:
    text · textarea · number · select · multiselect · boolean
    date · time · datetime · scale · signature
  plus two engine types:
    computed · group

  Values are read/written against a flat `values` map keyed by `DocField.key`.
  Editing emits `onchange(key, value)` so the parent owns persistence/auto-save.
  Signature fields render the SignaturePad and a per-field captured preview;
  capture is surfaced via `onsignature(key, pngBytes | null)`.

  A `'group'` field stores an array of row objects keyed by each itemField.key.
  A `'computed'` field writes its derived number back into `values[field.key]`
  so it persists in the payload and the print/export.

  Accessibility: every control has a <label>, large touch targets (min-h-touch),
  visible focus, units shown next to numeric inputs.
-->
<script lang="ts">
  import type { DocField, DocSection } from '$lib/schemas/types';
  import type { Qualification } from '@aidlog/contracts';
  import { computeValue, resolveBand, vitalStatus } from '$lib/scores';
  import { meetsQualification, qualificationLabel } from '$lib/qualifications';
  import SignaturePad from '$lib/signature/SignaturePad.svelte';
  import { Icon, ChipSelect, Toggle } from '$lib/ui';
  import { t } from '$lib/i18n';

  interface Props {
    section: DocSection;
    values: Record<string, unknown>;
    /** field keys that already have a captured signature image. */
    signedFields?: Set<string>;
    readonly?: boolean;
    /**
     * The CURRENT user's qualification, threaded from the editor host. Undefined
     * (the default) = no restriction, so existing usages are unaffected. When a
     * section sets `minQualification` and this user's rank is below it, the
     * section renders READ-ONLY with a note (a soft, documented gate).
     */
    userQualification?: Qualification | null;
    onchange?: (key: string, value: unknown) => void;
    onsignature?: (key: string, png: Uint8Array | null) => void;
  }

  let {
    section,
    values,
    signedFields = new Set(),
    readonly = false,
    userQualification = undefined,
    onchange,
    onsignature,
  }: Props = $props();

  // Qualifikationsabhängige Doku-Freigabe: if the section requires a minimum
  // qualification this user does not meet, gate it READ-ONLY (soft gate). When
  // `userQualification` is undefined the caller opted out of gating entirely.
  const gatedByQualification = $derived(
    section.minQualification !== undefined &&
      userQualification !== undefined &&
      !meetsQualification(userQualification, section.minQualification),
  );
  // Effective read-only: the host's `readonly` OR the qualification gate.
  const effectiveReadonly = $derived(readonly || gatedByQualification);

  function set(key: string, value: unknown): void {
    if (effectiveReadonly) return;
    onchange?.(key, value);
  }

  function toIsoDatetime(raw: string): string {
    if (!raw) return '';
    const d = new Date(raw);
    return isNaN(d.getTime()) ? raw : d.toISOString();
  }

  /** datetime-local needs "YYYY-MM-DDTHH:mm"; round-trip an ISO string back. */
  function isoToLocalInput(v: unknown): string {
    if (typeof v !== 'string' || v === '') return '';
    const d = new Date(v);
    if (isNaN(d.getTime())) return v;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toStr(v: unknown): string {
    return v === undefined || v === null ? '' : String(v);
  }

  // A `select` with a SHORT option list renders as tap-chips (fast on a tablet);
  // longer lists keep the native <select>. Threshold is inclusive.
  const CHIP_SELECT_MAX = 6;
  function isChipSelect(field: DocField): boolean {
    return field.type === 'select' && (field.options?.length ?? 0) <= CHIP_SELECT_MAX;
  }

  /** Current local time as "HH:mm" (for `time` fields). */
  function nowTime(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toMulti(v: unknown): string[] {
    return Array.isArray(v) ? (v as string[]) : [];
  }

  function scaleRange(field: DocField): number[] {
    const min = field.min ?? 0;
    const max = field.max ?? 10;
    const out: number[] = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }

  function span(field: DocField): string {
    return field.span === 2 ? 'sm:col-span-2' : 'sm:col-span-1';
  }

  // --- group rows (array of row objects) -----------------------------------
  function rows(field: DocField): Record<string, unknown>[] {
    const v = values[field.key];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  }

  function addRow(field: DocField): void {
    const max = field.maxItems;
    const cur = rows(field);
    if (max !== undefined && cur.length >= max) return;
    set(field.key, [...cur, {}]);
  }

  function removeRow(field: DocField, index: number): void {
    const cur = rows(field);
    set(
      field.key,
      cur.filter((_, i) => i !== index),
    );
  }

  function setRowValue(field: DocField, index: number, subKey: string, value: unknown): void {
    const cur = rows(field);
    const next = cur.map((r, i) => (i === index ? { ...r, [subKey]: value } : r));
    set(field.key, next);
  }

  // --- computed value: derive + persist into the flat payload --------------
  function computedDisplay(field: DocField): string {
    const v = computeValue(field, values);
    if (v === null) return $t('formx.computedEmpty');
    const max = field.compute?.max;
    return max !== undefined ? `${v} / ${max}` : String(v);
  }

  // Keep values[field.key] in sync with the derived value for every computed
  // field in this section, so it persists in the payload / export.
  $effect(() => {
    if (effectiveReadonly) return;
    for (const field of section.fields) {
      if (field.type !== 'computed') continue;
      const derived = computeValue(field, values);
      const stored = values[field.key];
      const next = derived === null ? '' : derived;
      const cur = stored === undefined || stored === null ? '' : stored;
      if (cur !== next) onchange?.(field.key, next);
    }
  });

  // --- plausibility hint for a numeric value -------------------------------
  function rangeText(min?: number, max?: number): string {
    if (min !== undefined && max !== undefined) return `${min}–${max}`;
    if (max !== undefined) return `≤ ${max}`;
    if (min !== undefined) return `≥ ${min}`;
    return '';
  }

  function plausibilityHint(field: DocField, raw: unknown): string | null {
    if (!field.plausibility) return null;
    const n = typeof raw === 'number' ? raw : raw === '' || raw == null ? NaN : Number(raw);
    if (!Number.isFinite(n)) return null;
    const band = resolveBand(field.plausibility, values);
    const status = vitalStatus(n, band);
    if (status !== 'low' && status !== 'high') return null;
    return $t('formx.valueOutOfRange', {
      value: n,
      range: rangeText(band?.min, band?.max),
    });
  }
</script>

<!--
  leafField — the single editable widget for a simple (non-special) field. Used
  for top-level fields AND for group sub-fields. `value` is the current value,
  `onchange` writes it back, `idPrefix` namespaces the input id.
-->
{#snippet leafField(
  field: DocField,
  value: unknown,
  onChange: (v: unknown) => void,
  idPrefix: string,
)}
  {@const id = `${idPrefix}-${field.key}`}
  {#if field.type === 'textarea'}
    <textarea
      {id}
      class="field-input min-h-touch py-3"
      rows="3"
      disabled={effectiveReadonly}
      placeholder={field.placeholder}
      value={toStr(value)}
      oninput={(e) => onChange(e.currentTarget.value)}
    ></textarea>
  {:else if field.type === 'select' && isChipSelect(field)}
    <ChipSelect
      options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
      value={toStr(value)}
      ariaLabelledby={id}
      allowNone={true}
      noneLabel={`— ${$t('common.none')} —`}
      disabled={effectiveReadonly}
      onchange={(v) => onChange(v)}
    />
  {:else if field.type === 'select'}
    <select
      {id}
      class="field-input py-3"
      disabled={effectiveReadonly}
      value={toStr(value)}
      onchange={(e) => onChange(e.currentTarget.value)}
    >
      <option value="">— {$t('common.none')} —</option>
      {#each field.options ?? [] as opt (opt.value)}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
  {:else if field.type === 'multiselect'}
    <div
      class="space-y-1 rounded-xl border border-line-strong bg-surface-1 p-2"
      role="group"
      aria-labelledby={id}
    >
      {#each field.options ?? [] as opt (opt.value)}
        <label
          class="flex min-h-touch items-center gap-3 rounded-lg px-2 text-base text-fg hover:bg-surface-2"
        >
          <input
            type="checkbox"
            class="h-6 w-6 rounded border border-line-strong bg-surface-1 text-brand accent-brand"
            disabled={effectiveReadonly}
            checked={toMulti(value).includes(opt.value)}
            onchange={(e) => {
              const cur = new Set(toMulti(value));
              if (e.currentTarget.checked) cur.add(opt.value);
              else cur.delete(opt.value);
              onChange([...cur]);
            }}
          />
          <span>{opt.label}</span>
        </label>
      {/each}
    </div>
  {:else if field.type === 'boolean'}
    <Toggle
      {id}
      checked={!!value}
      label={field.label}
      required={field.required}
      disabled={effectiveReadonly}
      onchange={(checked) => onChange(checked)}
    />
  {:else if field.type === 'date'}
    <input
      {id}
      type="date"
      class="field-input py-3"
      disabled={effectiveReadonly}
      value={toStr(value)}
      oninput={(e) => onChange(e.currentTarget.value)}
    />
  {:else if field.type === 'time'}
    <div class="flex items-stretch gap-2">
      <input
        {id}
        type="time"
        class="field-input min-w-0 flex-1 py-3"
        disabled={effectiveReadonly}
        value={toStr(value)}
        oninput={(e) => onChange(e.currentTarget.value)}
      />
      {#if !effectiveReadonly}
        <button
          type="button"
          class="btn-secondary min-h-touch flex-none px-3 text-sm"
          onclick={() => onChange(nowTime())}
        >
          {$t('formx.now')}
        </button>
      {/if}
    </div>
  {:else if field.type === 'datetime'}
    <div class="flex items-stretch gap-2">
      <input
        {id}
        type="datetime-local"
        class="field-input min-w-0 flex-1 py-3"
        disabled={effectiveReadonly}
        value={isoToLocalInput(value)}
        oninput={(e) => onChange(toIsoDatetime(e.currentTarget.value))}
      />
      {#if !effectiveReadonly}
        <button
          type="button"
          class="btn-secondary min-h-touch flex-none px-3 text-sm"
          onclick={() => onChange(new Date().toISOString())}
        >
          {$t('formx.now')}
        </button>
      {/if}
    </div>
  {:else if field.type === 'number'}
    <input
      {id}
      type="number"
      inputmode="decimal"
      class="field-input py-3"
      disabled={effectiveReadonly}
      min={field.min}
      max={field.max}
      placeholder={field.placeholder}
      value={toStr(value)}
      oninput={(e) => onChange(e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
    />
    {#if plausibilityHint(field, value)}
      <p class="mt-1 text-sm text-warning">{plausibilityHint(field, value)}</p>
    {/if}
  {:else}
    <input
      {id}
      type="text"
      class="field-input py-3"
      disabled={effectiveReadonly}
      placeholder={field.placeholder}
      value={toStr(value)}
      oninput={(e) => onChange(e.currentTarget.value)}
    />
  {/if}
{/snippet}

{#if gatedByQualification && section.minQualification}
  <p
    class="mb-4 flex items-start gap-2 rounded-xl border border-line bg-warning-soft/40 px-3 py-2 text-sm text-warning-fg"
    role="note"
  >
    <span class="shrink-0 text-warning"><Icon name="lock" size={16} /></span>
    {$t('qualifications.sectionGatedNote', {
      qualification: qualificationLabel(section.minQualification),
    })}
  </p>
{/if}

<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
  {#each section.fields as field (field.key)}
    {@const id = `f-${field.key}`}
    <div class={span(field)}>
      {#if field.type !== 'boolean'}
        <label class="field-label" for={id}>
          {field.label}{#if field.required}<span class="text-danger" aria-hidden="true">
              *</span
            >{/if}
          {#if field.unit}<span class="text-subtle"> ({field.unit})</span>{/if}
        </label>
      {/if}
      {#if field.help}
        <p id={`${id}-help`} class="mb-1 text-sm text-muted">{field.help}</p>
      {/if}

      {#if field.type === 'scale'}
        <div class="flex flex-wrap gap-2" role="group" aria-labelledby={id}>
          {#each scaleRange(field) as n (n)}
            <button
              type="button"
              disabled={effectiveReadonly}
              class={`min-h-touch min-w-touch rounded-xl border px-4 text-lg font-semibold transition-colors ${
                Number(values[field.key]) === n
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-line-strong bg-surface-1 text-fg hover:bg-surface-2'
              }`}
              aria-pressed={Number(values[field.key]) === n}
              onclick={() => set(field.key, n)}
            >
              {n}
            </button>
          {/each}
        </div>
      {:else if field.type === 'signature'}
        {#if effectiveReadonly}
          <p class="text-sm text-muted">
            {signedFields.has(field.key) ? $t('signature.title') : $t('common.none')}
          </p>
        {:else}
          <SignaturePad label={field.label} onchange={(png) => onsignature?.(field.key, png)} />
          {#if signedFields.has(field.key)}
            <p class="mt-2 inline-flex items-center gap-1 text-sm text-brand">
              <Icon name="check" size={16} />
              {$t('doc.captured')}
            </p>
          {/if}
        {/if}
      {:else if field.type === 'computed'}
        <div
          {id}
          class="field-input flex items-center py-3 text-muted opacity-80"
          aria-readonly="true"
        >
          {computedDisplay(field)}
        </div>
      {:else if field.type === 'group'}
        {@const list = rows(field)}
        <div class="space-y-3">
          {#if list.length === 0}
            <p class="text-sm text-muted">{$t('formx.emptyRows')}</p>
          {/if}
          {#each list as row, i (i)}
            <div class="rounded-xl border border-line-strong bg-surface-1 p-3">
              <div class="mb-2 flex items-center justify-between">
                <span class="text-sm font-medium text-muted"
                  >{$t('formx.rowLabel', { n: i + 1 })}</span
                >
                {#if !effectiveReadonly}
                  <button
                    type="button"
                    class="btn-ghost min-h-touch px-2 text-sm text-danger"
                    onclick={() => removeRow(field, i)}
                  >
                    <Icon name="trash" size={16} />
                    <span class="ml-1">{$t('formx.removeRow')}</span>
                  </button>
                {/if}
              </div>
              <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {#each field.itemFields ?? [] as sub (sub.key)}
                  <div class={sub.span === 2 ? 'sm:col-span-2' : ''}>
                    {#if sub.type !== 'boolean'}
                      <label class="field-label" for={`f-${field.key}-${i}-${sub.key}`}>
                        {sub.label}{#if sub.unit}<span class="text-subtle"> ({sub.unit})</span>{/if}
                      </label>
                    {/if}
                    {@render leafField(
                      sub,
                      row[sub.key],
                      (v) => setRowValue(field, i, sub.key, v),
                      `f-${field.key}-${i}`,
                    )}
                  </div>
                {/each}
              </div>
            </div>
          {/each}
          {#if !readonly && (field.maxItems === undefined || list.length < field.maxItems)}
            <button type="button" class="btn-secondary min-h-touch" onclick={() => addRow(field)}>
              <Icon name="plus" size={16} />
              <span class="ml-1">{field.addLabel ?? $t('formx.addRow')}</span>
            </button>
          {/if}
        </div>
      {:else}
        {@render leafField(field, values[field.key], (v) => set(field.key, v), 'f')}
      {/if}
    </div>
  {/each}
</div>
