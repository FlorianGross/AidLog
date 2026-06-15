<!--
  VitalTrendView.svelte — READ-ONLY vital-sign trend for record / print views.

  Renders the indicator badges, the SVG trend chart and a compact read-only
  table of all readings. Used by the print/PDF render and any record review.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import VitalTrendChart from './VitalTrendChart.svelte';
  import VitalIndicators from './VitalIndicators.svelte';
  import { VITAL_PARAMS, type VitalReading } from './types';
  import { round, sortedReadings } from './indicators';

  interface Props {
    readings: VitalReading[];
    /** show the SVG chart (hidden where only the table is wanted). */
    showChart?: boolean;
  }
  let { readings, showChart = true }: Props = $props();

  const sorted = $derived(sortedReadings(readings));

  const COLS: { key: Exclude<keyof VitalReading, 'id' | 'time'>; short: string }[] = [
    { key: 'rrSys', short: 'rrSys' },
    { key: 'rrDia', short: 'rrDia' },
    { key: 'hf', short: 'hf' },
    { key: 'af', short: 'af' },
    { key: 'spo2', short: 'spo2' },
    { key: 'bz', short: 'bz' },
    { key: 'temp', short: 'temp' },
    { key: 'gcs', short: 'gcs' },
  ];

  function cell(v: number | undefined): string {
    return typeof v === 'number' && !Number.isNaN(v) ? String(round(v, 1)) : '—';
  }
</script>

{#if sorted.length === 0}
  <p class="text-sm text-muted">{$t('vitals.empty')}</p>
{:else}
  <div class="space-y-4">
    <VitalIndicators {readings} />
    {#if showChart}
      <VitalTrendChart {readings} selected={new Set(['rrSys', 'hf', 'spo2', 'gcs'])} />
    {/if}
    <div class="overflow-x-auto rounded-xl border border-line">
      <table class="w-full min-w-[560px] border-collapse text-sm">
        <thead>
          <tr
            class="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-subtle"
          >
            <th class="px-2 py-2 font-medium">{$t('vitals.param.time')}</th>
            {#each COLS as c (c.key)}
              <th class="px-2 py-2 font-medium">{$t(`vitals.param.${c.short}`)}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each sorted as r (r.id)}
            <tr class="border-b border-line last:border-0 text-fg">
              <td class="px-2 py-1.5 tabular-nums">{r.time || '—'}</td>
              {#each COLS as c (c.key)}
                <td class="px-2 py-1.5 tabular-nums">{cell(r[c.key])}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}
