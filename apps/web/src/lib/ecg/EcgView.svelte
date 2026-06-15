<!--
  EcgView.svelte — read-only render of the 12-lead ECG & device findings.

  Used in the record / print / cosign review: renders the strip thumbnails (still
  zoomable) plus the structured findings as a compact definition grid. No editing,
  no persistence — it only reflects a finalized/loaded EcgRecord. Tokens only.
-->
<script lang="ts">
  import { Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import EcgStripThumb from './EcgStripThumb.svelte';
  import { rhythmTone, verdachtTone, ecgItemCount, type EcgRecord } from './types';

  interface Props {
    record: EcgRecord;
  }
  let { record }: Props = $props();

  const empty = $derived(ecgItemCount(record) === 0);
  const stLeads = $derived((record.stLeads ?? []).join(', '));
</script>

{#if empty}
  <p class="text-sm text-muted">{$t('ecg.empty')}</p>
{:else}
  <div class="space-y-4">
    {#if record.strips.length > 0}
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each record.strips as s (s.id)}
          <EcgStripThumb data={s.data} mediaType={s.mediaType} />
        {/each}
      </div>
    {/if}

    <dl class="grid gap-3 sm:grid-cols-2">
      {#if record.rhythm}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.rhythm.label')}</dt>
          <dd class="mt-0.5">
            <Badge tone={rhythmTone(record.rhythm)}>{$t(`ecg.rhythm.${record.rhythm}`)}</Badge>
          </dd>
        </div>
      {/if}
      {#if record.frequenz != null}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.frequenz')}</dt>
          <dd class="mt-0.5 text-sm text-fg tabular-nums">{record.frequenz} /min</dd>
        </div>
      {/if}
      {#if record.lagetyp}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.lagetyp.label')}</dt>
          <dd class="mt-0.5 text-sm text-fg">{$t(`ecg.lagetyp.${record.lagetyp}`)}</dd>
        </div>
      {/if}
      {#if record.qrsWidth}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.qrs.label')}</dt>
          <dd class="mt-0.5 text-sm text-fg">{$t(`ecg.qrs.${record.qrsWidth}`)}</dd>
        </div>
      {/if}
      {#if record.stChange}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.st.label')}</dt>
          <dd class="mt-0.5 text-sm text-fg">
            {$t(`ecg.st.${record.stChange}`)}
            {#if stLeads}<span class="text-subtle"> · {stLeads}</span>{/if}
          </dd>
        </div>
      {/if}
      {#if record.verdacht}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.verdacht.label')}</dt>
          <dd class="mt-0.5">
            <Badge tone={verdachtTone(record.verdacht)}
              >{$t(`ecg.verdacht.${record.verdacht}`)}</Badge
            >
          </dd>
        </div>
      {/if}
      {#if record.schocks != null}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.shocks')}</dt>
          <dd class="mt-0.5 text-sm text-fg tabular-nums">{record.schocks}</dd>
        </div>
      {/if}
      {#if record.energie != null}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.energie')}</dt>
          <dd class="mt-0.5 text-sm text-fg tabular-nums">{record.energie} J</dd>
        </div>
      {/if}
      {#if record.modus}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.mode.label')}</dt>
          <dd class="mt-0.5 text-sm text-fg">{$t(`ecg.mode.${record.modus}`)}</dd>
        </div>
      {/if}
      {#if record.schrittmacher != null}
        <div class="tile">
          <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.pacing')}</dt>
          <dd class="mt-0.5 text-sm text-fg">
            {record.schrittmacher ? $t('common.yes') : $t('common.no')}
          </dd>
        </div>
      {/if}
    </dl>

    {#if record.bemerkung}
      <div class="tile">
        <dt class="text-xs uppercase tracking-wide text-subtle">{$t('ecg.bemerkung')}</dt>
        <dd class="mt-0.5 whitespace-pre-wrap break-words text-sm text-fg">{record.bemerkung}</dd>
      </div>
    {/if}
  </div>
{/if}
