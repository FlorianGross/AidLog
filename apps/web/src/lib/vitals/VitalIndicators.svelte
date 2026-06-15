<!--
  VitalIndicators.svelte — small Badges auto-computed from the latest reading.

  Shows GCS total, Schock-Index (flagged > 1.0) and a coarse stability hint.
  Pure presentation: all maths live in indicators.ts. All numbers are rounded.
  Used by both the live editor panel and the read-only/print trend view.
-->
<script lang="ts">
  import { Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import type { VitalReading } from './types';
  import {
    gcsTotal,
    latestReading,
    round,
    shockIndex,
    stabilityHint,
    stabilityTone,
  } from './indicators';

  interface Props {
    readings: VitalReading[];
  }
  let { readings }: Props = $props();

  const latest = $derived(latestReading(readings));
  const gcs = $derived(gcsTotal(latest));
  const si = $derived(shockIndex(latest));
  const stability = $derived(stabilityHint(latest));
</script>

{#if latest}
  <div class="flex flex-wrap items-center gap-2">
    {#if gcs !== null}
      <Badge tone={gcs < 9 ? 'danger' : gcs < 14 ? 'warning' : 'ok'}>
        {$t('vitals.gcsTotal')}: {gcs}
      </Badge>
    {/if}
    {#if si !== null}
      <Badge tone={si > 1.0 ? 'danger' : si > 0.9 ? 'warning' : 'ok'}>
        {$t('vitals.shockIndex')}: {round(si, 2).toFixed(2)}
      </Badge>
    {/if}
    {#if stability !== null}
      <Badge tone={stabilityTone(stability)}>
        {$t(`vitals.stability.${stability}`)}
      </Badge>
    {/if}
  </div>
{/if}
