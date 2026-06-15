<!--
  ConsentPanel.svelte — the interactive "Einwilligung & Aufklärung" editor.

  Lets the user add/select multiple consent items (Behandlung,
  Transportverweigerung, Datenverarbeitung), edit the pre-filled (vendor-neutral)
  Aufklärungstext, tick the key acknowledgements, add remarks, pick the signer
  role + name, and capture the patient (or witness) signature via SignaturePad.

  Data ownership: the consent RECORD is owned by the parent via `record` +
  `onchange` (it rides the encrypted draft payload under EINWILLIGUNG_KEY like any
  other value). Signature IMAGES are owned by the parent too, via `onsignature`
  (field key = consentSigField(item.id), so they ride the existing signature/blob
  flow). This component never touches storage directly.
-->
<script lang="ts">
  import { Icon, Badge, EmptyState } from '$lib/ui';
  import { t } from '$lib/i18n';
  import SignaturePad from '$lib/signature/SignaturePad.svelte';
  import {
    type ConsentRecord,
    type ConsentItem,
    type ConsentType,
    type SignerRole,
    CONSENT_TYPES,
    SIGNER_ROLES,
    DEFAULT_TEXTS,
    newConsentItem,
    consentSigField,
    legacyRefusalPresent,
  } from './types';

  interface Props {
    record: ConsentRecord;
    /** item.id → object URL of an already-captured signature preview (optional). */
    signaturePreviews?: Record<string, string>;
    /** raw payload values, to surface the legacy refusal flag (optional). */
    values?: Record<string, unknown>;
    readonly?: boolean;
    /** emit the next consent record. */
    onchange: (next: ConsentRecord) => void;
    /** emit a captured/cleared signature image for a consent item. */
    onsignature: (field: string, png: Uint8Array | null) => void;
  }
  let {
    record,
    signaturePreviews = {},
    values,
    readonly = false,
    onchange,
    onsignature,
  }: Props = $props();

  // Which item is expanded in the editor. Defaults to the first one.
  let activeId = $state<string | null>(null);
  let pickerOpen = $state(false);

  const items = $derived(record.items);
  const active = $derived(items.find((i) => i.id === activeId) ?? items[0] ?? null);

  // Keep activeId valid as items change.
  $effect(() => {
    if (items.length === 0) {
      activeId = null;
    } else if (!items.some((i) => i.id === activeId)) {
      activeId = items[0]?.id ?? null;
    }
  });

  const showLegacy = $derived(values ? legacyRefusalPresent(values) : false);

  function emit(next: ConsentRecord): void {
    onchange(next);
  }

  function patchItem(id: string, patch: Partial<ConsentItem>): void {
    emit({ items: items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
  }

  function addItem(type: ConsentType): void {
    if (readonly) return;
    const item = newConsentItem(type);
    emit({ items: [...items, item] });
    activeId = item.id;
    pickerOpen = false;
  }

  function removeItem(id: string): void {
    if (readonly) return;
    // Drop any captured signature image for this item too.
    onsignature(consentSigField(id), null);
    emit({ items: items.filter((i) => i.id !== id) });
  }

  function toggleAck(item: ConsentItem, ackId: string): void {
    if (readonly) return;
    patchItem(item.id, {
      acknowledgements: item.acknowledgements.map((a) =>
        a.id === ackId ? { ...a, checked: !a.checked } : a,
      ),
    });
  }

  function setText(item: ConsentItem, text: string): void {
    patchItem(item.id, { aufklaerungstext: text });
  }

  function resetText(item: ConsentItem): void {
    if (readonly) return;
    patchItem(item.id, { aufklaerungstext: DEFAULT_TEXTS[item.type] });
  }

  function setRole(item: ConsentItem, role: SignerRole): void {
    patchItem(item.id, { signerRole: role });
  }

  function onSigChange(item: ConsentItem, png: Uint8Array | null): void {
    onsignature(consentSigField(item.id), png);
    patchItem(item.id, {
      signed: png !== null,
      signedAt: png !== null ? new Date().toISOString() : null,
    });
  }

  function typeTone(type: ConsentType): 'brand' | 'danger' | 'muted' {
    if (type === 'transportverweigerung') return 'danger';
    if (type === 'behandlung') return 'brand';
    return 'muted';
  }
</script>

<div class="space-y-5">
  {#if showLegacy}
    <p class="rounded-xl bg-warning-soft px-4 py-2 text-sm text-warning-fg">
      {$t('consent.legacyRefusalNote')}
    </p>
  {/if}

  <!-- Item selector + add -->
  <div class="flex flex-wrap items-center gap-2">
    {#each items as item (item.id)}
      <button
        type="button"
        aria-current={active?.id === item.id ? 'true' : undefined}
        class={`flex min-h-touch items-center gap-2 rounded-xl border px-3 text-sm font-medium transition-colors ${
          active?.id === item.id
            ? 'border-line-strong bg-surface-1 text-fg'
            : 'border-line bg-surface-1 text-muted hover:bg-surface-2'
        }`}
        onclick={() => (activeId = item.id)}
      >
        <Badge tone={typeTone(item.type)}>{$t(`consent.type.${item.type}`)}</Badge>
        {#if item.signed}<Icon name="signature" size={16} />{/if}
      </button>
    {/each}

    {#if !readonly}
      <div class="relative">
        <button
          type="button"
          class="btn-secondary min-h-touch px-4 text-sm"
          aria-expanded={pickerOpen}
          onclick={() => (pickerOpen = !pickerOpen)}
        >
          <Icon name="plus" size={18} />
          {$t('consent.addItem')}
        </button>
        {#if pickerOpen}
          <div
            class="absolute z-10 mt-1 flex w-64 flex-col gap-1 rounded-xl border border-line bg-surface-1 p-2 shadow-lg"
          >
            {#each CONSENT_TYPES as type (type)}
              <button
                type="button"
                class="btn-ghost min-h-touch justify-start px-3 text-left text-sm"
                onclick={() => addItem(type)}
              >
                {$t(`consent.type.${type}`)}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if !active}
    <EmptyState
      icon="signature"
      title={$t('consent.empty')}
      description={$t('consent.emptyHint')}
    />
  {:else}
    {@const item = active}
    <div class="space-y-5">
      <!-- Header + remove -->
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 class="text-base font-semibold text-fg">{$t(`consent.type.${item.type}`)}</h3>
          <p class="mt-0.5 text-sm text-muted">{$t(`consent.typeHint.${item.type}`)}</p>
        </div>
        {#if !readonly}
          <button
            type="button"
            class="btn-ghost min-h-touch px-3 text-sm text-danger-fg"
            onclick={() => removeItem(item.id)}
          >
            <Icon name="x" size={18} />
            {$t('common.delete')}
          </button>
        {/if}
      </div>

      <!-- Editable Aufklärungstext -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="field-label">{$t('consent.aufklaerungstext')}</span>
          {#if !readonly}
            <button
              type="button"
              class="btn-ghost min-h-0 rounded-lg px-2 py-1 text-xs"
              onclick={() => resetText(item)}
            >
              {$t('consent.resetText')}
            </button>
          {/if}
        </div>
        <textarea
          class="field-input min-h-[180px] w-full whitespace-pre-line"
          rows="8"
          {readonly}
          value={item.aufklaerungstext}
          oninput={(e) => setText(item, e.currentTarget.value)}
          aria-label={$t('consent.aufklaerungstext')}
        ></textarea>
      </div>

      <!-- Acknowledgements -->
      <fieldset class="space-y-2">
        <legend class="field-label mb-1">{$t('consent.acknowledgements')}</legend>
        {#each item.acknowledgements as ack (ack.id)}
          <label
            class="flex min-h-touch cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm"
          >
            <input
              type="checkbox"
              class="mt-0.5 h-5 w-5 flex-none accent-brand"
              checked={ack.checked}
              disabled={readonly}
              onchange={() => toggleAck(item, ack.id)}
            />
            <span class="text-fg">{$t(`consent.ack.${ack.id}`)}</span>
          </label>
        {/each}
      </fieldset>

      <!-- Remarks -->
      <div class="space-y-1.5">
        <span class="field-label">{$t('consent.remarks')}</span>
        <textarea
          class="field-input w-full"
          rows="2"
          {readonly}
          placeholder={$t('consent.remarksPlaceholder')}
          value={item.remarks}
          oninput={(e) => patchItem(item.id, { remarks: e.currentTarget.value })}
          aria-label={$t('consent.remarks')}
        ></textarea>
      </div>

      <!-- Signer role + name -->
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="space-y-1.5">
          <span class="field-label">{$t('consent.signerRole')}</span>
          <div class="flex flex-wrap gap-1">
            {#each SIGNER_ROLES as role (role)}
              <button
                type="button"
                class={`min-h-touch rounded-lg border px-4 text-sm font-medium transition-colors ${
                  item.signerRole === role
                    ? 'border-line-strong bg-brand text-brand-fg'
                    : 'border-line bg-surface-1 text-muted hover:bg-surface-2'
                }`}
                disabled={readonly}
                onclick={() => setRole(item, role)}
              >
                {$t(`consent.role.${role}`)}
              </button>
            {/each}
          </div>
        </div>
        <div class="space-y-1.5">
          <label class="field-label" for={`consent-name-${item.id}`}
            >{$t('consent.signerName')}</label
          >
          <input
            id={`consent-name-${item.id}`}
            type="text"
            class="field-input w-full"
            {readonly}
            placeholder={$t('consent.signerNamePlaceholder')}
            value={item.signerName}
            oninput={(e) => patchItem(item.id, { signerName: e.currentTarget.value })}
          />
        </div>
      </div>

      <!-- Signature -->
      <div class="space-y-2">
        {#if readonly}
          {#if signaturePreviews[item.id]}
            <figure class="space-y-1.5">
              <figcaption class="field-label">{$t('consent.signature')}</figcaption>
              <div
                class="flex items-center justify-center rounded-xl border border-line-strong bg-surface-1 p-2"
                style="min-height:120px"
              >
                <img
                  src={signaturePreviews[item.id]}
                  alt={$t('consent.signature')}
                  class="max-h-full max-w-full"
                  style="max-height:160px"
                />
              </div>
            </figure>
          {:else}
            <p class="text-sm text-muted">{$t('consent.unsigned')}</p>
          {/if}
        {:else if signaturePreviews[item.id] && item.signed}
          <figure class="space-y-1.5">
            <figcaption class="field-label">{$t('consent.signature')}</figcaption>
            <div
              class="flex items-center justify-center rounded-xl border border-line-strong bg-surface-1 p-2"
              style="min-height:120px"
            >
              <img
                src={signaturePreviews[item.id]}
                alt={$t('consent.signature')}
                class="max-h-full max-w-full"
                style="max-height:160px"
              />
            </div>
            <button
              type="button"
              class="btn-ghost px-4 text-sm"
              onclick={() => onSigChange(item, null)}
            >
              <Icon name="x" size={18} />
              {$t('signature.clear')}
            </button>
          </figure>
        {:else}
          <SignaturePad label={$t('consent.signHere')} onchange={(png) => onSigChange(item, png)} />
        {/if}
      </div>
    </div>
  {/if}
</div>
