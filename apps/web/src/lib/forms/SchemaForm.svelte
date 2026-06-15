<!--
  SchemaForm.svelte — DYNAMIC form renderer.

  Renders a data-entry form purely from a `SchemaDefinition` (JSON-Schema draft
  2020-12 + uiSchema). Adding a protocol field requires ONLY editing the schema
  (see ARCHITECTURE §6 and lib/forms/example-schema.ts) — no component changes.

  On submit it validates the collected data against the schema with AJV BEFORE
  emitting it, so invalid data never reaches the encryption layer. Image-capture
  fields yield raw bytes (PendingBlob) so the caller can stream-encrypt them.

  Accessibility: every control has an associated <label>, large touch targets,
  visible focus, and errors wired via aria-describedby / aria-invalid.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { SchemaDefinition } from '@aidlog/contracts';
  import { buildFields, type FieldDescriptor } from './schema-fields';
  import { validate, type ValidationResult } from './validate';
  import type { PendingBlob } from '../crypto/record';

  interface Props {
    schema: SchemaDefinition;
    /** Initial values (e.g. when correcting/superseding a record). */
    initial?: Record<string, unknown>;
    submitLabel?: string;
    onsubmit?: (detail: { data: Record<string, unknown>; blobs: PendingBlob[] }) => void;
  }

  let { schema, initial = {}, submitLabel = 'Save record', onsubmit }: Props = $props();

  const fields = $derived(buildFields(schema.jsonSchema, schema.uiSchema));

  // Flat working copy keyed by dot-path; we expand into nested data on submit.
  // Seed once from `initial` (intentionally non-reactive — it is a starting value).
  let values = $state<Record<string, unknown>>(untrack(() => flatten(initial)));
  // Captured image bytes keyed by field path.
  let blobs = $state<Record<string, PendingBlob>>({});
  let result = $state<ValidationResult | null>(null);
  let submitted = $state(false);

  function flatten(obj: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) out[`${k}.${sk}`] = sv;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function expand(flat: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [path, v] of Object.entries(flat)) {
      if (v === '' || v === undefined || v === null) continue;
      const dot = path.indexOf('.');
      if (dot === -1) {
        out[path] = v;
      } else {
        const head = path.slice(0, dot);
        const tail = path.slice(dot + 1);
        const bucket = (out[head] ??= {}) as Record<string, unknown>;
        bucket[tail] = v;
      }
    }
    return out;
  }

  function setValue(path: string, raw: unknown, field: FieldDescriptor): void {
    let v = raw;
    if (field.widget === 'number') v = raw === '' ? '' : Number(raw);
    if (field.widget === 'integer') v = raw === '' ? '' : parseInt(String(raw), 10);
    if (field.widget === 'datetime' && typeof raw === 'string' && raw !== '') {
      // <input type="datetime-local"> yields "YYYY-MM-DDTHH:mm" (no seconds/zone),
      // which is NOT valid RFC3339 date-time. Normalise to a full ISO string so
      // it validates against `format: date-time`.
      const d = new Date(raw);
      v = isNaN(d.getTime()) ? raw : d.toISOString();
    }
    values = { ...values, [path]: v };
  }

  async function onFile(path: string, field: FieldDescriptor, e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const data = new Uint8Array(await file.arrayBuffer());
    blobs = {
      ...blobs,
      [path]: {
        field: path,
        mediaType: file.type || 'application/octet-stream',
        data,
        label: file.name,
      },
    };
    // Record a non-secret marker in values so "required" passes if needed.
    values = { ...values, [path]: `blob:${file.name}` };
  }

  function fieldError(field: FieldDescriptor): string | undefined {
    if (!submitted || !result) return undefined;
    const match = result.errors.find((er) => er.path === field.path || er.path === field.key);
    return match?.message;
  }

  function handleSubmit(e: SubmitEvent): void {
    e.preventDefault();
    submitted = true;
    const data = expand(values);
    result = validate(schema, data);
    if (!result.valid) {
      // Focus the first invalid control for keyboard/AT users.
      queueMicrotask(() => {
        const first = result?.errors[0];
        if (first) document.getElementById(`field-${first.path}`)?.focus();
      });
      return;
    }
    onsubmit?.({ data, blobs: Object.values(blobs) });
  }

  // group fields for rendering (preserve order, keep group headers).
  const grouped = $derived(groupFields(fields));
  function groupFields(
    fs: FieldDescriptor[],
  ): { id: string; group?: string; fields: FieldDescriptor[] }[] {
    const out: { id: string; group?: string; fields: FieldDescriptor[] }[] = [];
    for (const f of fs) {
      const last = out[out.length - 1];
      if (last && last.group === f.group) last.fields.push(f);
      // `id` is unique per section even when two ungrouped runs both have no
      // group (keyed-each requires idempotent keys).
      else out.push({ id: `${f.group ?? '_root'}#${out.length}`, group: f.group, fields: [f] });
    }
    return out;
  }
</script>

<form class="space-y-6" onsubmit={handleSubmit} novalidate>
  <header>
    <h2 class="text-xl font-bold text-slate-100">{schema.title}</h2>
    {#if schema.description}
      <p class="mt-1 text-base text-slate-400">{schema.description}</p>
    {/if}
  </header>

  {#each grouped as section (section.id)}
    <fieldset class="space-y-4">
      {#if section.group}
        <legend class="text-lg font-semibold text-brand-300">{section.group}</legend>
      {/if}

      {#each section.fields as field (field.path)}
        {@const id = `field-${field.path}`}
        {@const err = fieldError(field)}
        <div>
          <label class="field-label" for={id}>
            {field.title}{#if field.required}<span class="text-danger" aria-hidden="true">
                *</span
              >{/if}
          </label>
          {#if field.description}
            <p id={`${id}-desc`} class="mb-1 text-sm text-slate-400">{field.description}</p>
          {/if}

          {#if field.widget === 'textarea'}
            <textarea
              {id}
              class="field-input min-h-touch py-3"
              rows="3"
              aria-invalid={!!err}
              aria-describedby={field.description ? `${id}-desc` : undefined}
              value={(values[field.path] as string) ?? ''}
              oninput={(e) => setValue(field.path, e.currentTarget.value, field)}
            ></textarea>
          {:else if field.widget === 'select'}
            <select
              {id}
              class="field-input py-3"
              aria-invalid={!!err}
              value={(values[field.path] as string) ?? ''}
              onchange={(e) => setValue(field.path, e.currentTarget.value, field)}
            >
              <option value="">— select —</option>
              {#each field.enum ?? [] as opt (opt)}
                <option value={opt}>{opt}</option>
              {/each}
            </select>
          {:else if field.widget === 'boolean'}
            <label class="inline-flex min-h-touch items-center gap-3 text-lg text-slate-100">
              <input
                {id}
                type="checkbox"
                class="h-7 w-7 rounded border-2 border-slate-600 bg-slate-800"
                checked={!!values[field.path]}
                onchange={(e) => setValue(field.path, e.currentTarget.checked, field)}
              />
              <span>Yes</span>
            </label>
          {:else if field.widget === 'image-capture'}
            <input
              {id}
              type="file"
              accept="image/*"
              capture="environment"
              class="field-input py-3 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-white"
              aria-invalid={!!err}
              onchange={(e) => onFile(field.path, field, e)}
            />
          {:else if field.widget === 'date' || field.widget === 'datetime'}
            <input
              {id}
              type={field.widget === 'date' ? 'date' : 'datetime-local'}
              class="field-input py-3"
              aria-invalid={!!err}
              value={(values[field.path] as string) ?? ''}
              oninput={(e) => setValue(field.path, e.currentTarget.value, field)}
            />
          {:else}
            <input
              {id}
              type={field.widget === 'number' || field.widget === 'integer' ? 'number' : 'text'}
              inputmode={field.widget === 'integer' ? 'numeric' : undefined}
              step={field.widget === 'integer' ? '1' : undefined}
              min={field.min}
              max={field.max}
              class="field-input py-3"
              aria-invalid={!!err}
              aria-describedby={field.description ? `${id}-desc` : undefined}
              value={(values[field.path] as string | number) ?? ''}
              oninput={(e) => setValue(field.path, e.currentTarget.value, field)}
            />
          {/if}

          {#if err}
            <p class="field-error" role="alert">{err}</p>
          {/if}
        </div>
      {/each}
    </fieldset>
  {/each}

  <button type="submit" class="btn-primary w-full">{submitLabel}</button>
</form>
