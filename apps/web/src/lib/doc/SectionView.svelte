<!--
  SectionView.svelte — READ-ONLY rendering of a decrypted DocSection.

  Used when reviewing a finalised record (e.g. co-signature "read before sign").
  Renders human-readable values, mapping select/multiselect option values back to
  their labels, and renders signature fields via SignatureView (decrypting the
  associated blob with the record DEK).
-->
<script lang="ts">
  import type { DocField, DocSection } from '$lib/schemas/types';
  import type { EncryptedBlobRef } from '@aidlog/contracts';
  import { computeValue } from '$lib/scores';
  import SignatureView from '$lib/signature/SignatureView.svelte';
  import { t } from '$lib/i18n';

  interface Props {
    section: DocSection;
    values: Record<string, unknown>;
    dek: Uint8Array;
    /** signature blobs keyed by field key, with their ciphertext bodies. */
    signatureBlobs?: Record<string, { ref: EncryptedBlobRef; ciphertext: Uint8Array }>;
  }

  let { section, values, dek, signatureBlobs = {} }: Props = $props();

  function labelFor(field: DocField, value: string): string {
    return field.options?.find((o) => o.value === value)?.label ?? value;
  }

  function display(field: DocField): string {
    if (field.type === 'computed') {
      const c = computeValue(field, values);
      if (c === null) return '—';
      const max = field.compute?.max;
      return max !== undefined ? `${c} / ${max}` : String(c);
    }
    const v = values[field.key];
    if (v === undefined || v === null || v === '') return '—';
    if (field.type === 'boolean') return v ? $t('common.yes') : $t('common.no');
    if (field.type === 'select') return labelFor(field, String(v));
    if (field.type === 'multiselect' && Array.isArray(v)) {
      return v.length ? v.map((x) => labelFor(field, String(x))).join(', ') : '—';
    }
    if (field.type === 'datetime' || field.type === 'date') {
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
    }
    const unit = field.unit ? ` ${field.unit}` : '';
    return `${String(v)}${unit}`;
  }

  /** Render a single group sub-value to text (option labels, unit, booleans). */
  function subDisplay(sub: DocField, raw: unknown): string {
    if (raw === undefined || raw === null || raw === '') return '—';
    if (sub.type === 'boolean') return raw ? $t('common.yes') : $t('common.no');
    if (sub.type === 'select') return labelFor(sub, String(raw));
    if (sub.type === 'multiselect' && Array.isArray(raw)) {
      return raw.length ? raw.map((x) => labelFor(sub, String(x))).join(', ') : '—';
    }
    const unit = sub.unit ? ` ${sub.unit}` : '';
    return `${String(raw)}${unit}`;
  }

  function groupRows(field: DocField): Record<string, unknown>[] {
    const v = values[field.key];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  }
</script>

<dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
  {#each section.fields as field (field.key)}
    <div
      class={field.span === 2 || field.type === 'signature' || field.type === 'group'
        ? 'sm:col-span-2'
        : ''}
    >
      <dt class="text-sm font-medium text-muted">{field.label}</dt>
      <dd class="mt-0.5 text-base text-fg">
        {#if field.type === 'signature'}
          {@const sig = signatureBlobs[field.key]}
          {#if sig}
            <SignatureView blob={sig.ref} ciphertext={sig.ciphertext} {dek} height={140} />
          {:else}
            <span class="text-subtle">—</span>
          {/if}
        {:else if field.type === 'group'}
          {@const list = groupRows(field)}
          {#if list.length === 0}
            <span class="text-subtle">—</span>
          {:else}
            <ul class="mt-1 space-y-2">
              {#each list as row, i (i)}
                <li class="rounded-lg border border-line bg-surface-1 p-2 text-sm">
                  <dl class="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {#each field.itemFields ?? [] as sub (sub.key)}
                      <div>
                        <dt class="text-xs text-subtle">{sub.label}</dt>
                        <dd>{subDisplay(sub, row[sub.key])}</dd>
                      </div>
                    {/each}
                  </dl>
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          {display(field)}
        {/if}
      </dd>
    </div>
  {/each}
</dl>
