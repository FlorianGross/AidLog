<!--
  ConsentView.svelte — READ-ONLY render of the consent / refusal record.

  Renders each consent item as a card: type badge, the shown Aufklärungstext,
  the ticked acknowledgements, remarks, signer role/name + timestamp, and (when
  available) the signature image. Pure presentation — no mutation.

  Signature images: the caller passes a `signatureUrls` map (item.id → object
  URL) resolved via the existing encrypted-blob flow (see SignatureView). When
  no URL is available we still show a "signiert" badge so the record stays
  faithful even before blobs are decrypted.

  Used by the editor review, and pickable by the print / cosign views.
-->
<script lang="ts">
  import { Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import {
    type ConsentRecord,
    type ConsentType,
    hasConsentData,
    legacyRefusalPresent,
  } from './types';

  interface Props {
    record: ConsentRecord;
    /** item.id → object URL of the decrypted signature image (optional). */
    signatureUrls?: Record<string, string>;
    /** raw payload values, to surface the legacy refusal flag (optional). */
    values?: Record<string, unknown>;
  }
  let { record, signatureUrls = {}, values }: Props = $props();

  function typeTone(type: ConsentType): 'brand' | 'danger' | 'muted' {
    if (type === 'transportverweigerung') return 'danger';
    if (type === 'behandlung') return 'brand';
    return 'muted';
  }

  function fmt(at: string | null): string {
    if (!at) return '—';
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('de-DE');
  }

  const showLegacy = $derived(values ? legacyRefusalPresent(values) : false);
</script>

{#if !hasConsentData(record) && !showLegacy}
  <p class="text-sm text-muted">{$t('consent.empty')}</p>
{:else}
  <div class="space-y-4">
    {#if showLegacy}
      <p class="rounded-xl bg-warning-soft px-4 py-2 text-sm text-warning-fg">
        {$t('consent.legacyRefusalNote')}
      </p>
    {/if}

    {#each record.items as item (item.id)}
      {@const ticked = item.acknowledgements.filter((a) => a.checked)}
      <article class="rounded-xl border border-line bg-surface-1 p-4">
        <header class="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={typeTone(item.type)}>{$t(`consent.type.${item.type}`)}</Badge>
          <Badge tone={item.signed ? 'ok' : 'muted'}>
            {item.signed ? $t('consent.signed') : $t('consent.unsigned')}
          </Badge>
          <span class="text-xs text-subtle">{fmt(item.signedAt ?? item.createdAt)}</span>
        </header>

        <p class="whitespace-pre-line text-sm text-fg">{item.aufklaerungstext}</p>

        {#if ticked.length > 0}
          <ul class="mt-3 space-y-1">
            {#each ticked as a (a.id)}
              <li class="flex items-start gap-2 text-sm text-muted">
                <span aria-hidden="true" class="text-ok-fg">✓</span>
                <span>{$t(`consent.ack.${a.id}`)}</span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if item.remarks.trim()}
          <p class="mt-3 text-sm text-muted">
            <span class="font-medium text-fg">{$t('consent.remarks')}:</span>
            {item.remarks}
          </p>
        {/if}

        <dl class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div class="flex gap-2">
            <dt class="text-subtle">{$t('consent.signerRole')}:</dt>
            <dd class="text-fg">{$t(`consent.role.${item.signerRole}`)}</dd>
          </div>
          {#if item.signerName.trim()}
            <div class="flex gap-2">
              <dt class="text-subtle">{$t('consent.signerName')}:</dt>
              <dd class="text-fg">{item.signerName}</dd>
            </div>
          {/if}
        </dl>

        {#if signatureUrls[item.id]}
          <figure class="mt-3 space-y-1.5">
            <figcaption class="text-xs font-medium uppercase tracking-wide text-subtle">
              {$t('consent.signature')}
            </figcaption>
            <div
              class="flex items-center justify-center rounded-xl border border-line-strong bg-surface-1 p-2"
              style="min-height:120px"
            >
              <img
                src={signatureUrls[item.id]}
                alt={$t('consent.signature')}
                class="max-h-full max-w-full"
                style="max-height:140px"
              />
            </div>
          </figure>
        {/if}
      </article>
    {/each}
  </div>
{/if}
