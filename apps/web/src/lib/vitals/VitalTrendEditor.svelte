<!--
  VitalTrendEditor.svelte — the "Vitalparameter-Verlauf" editor block.

  A repeatable, timestamped readings table (Uhrzeit, RR sys/dia, HF, AF, SpO₂,
  BZ, Temp, GCS) plus a live SVG trend chart and auto-computed indicator badges.
  It is a DEDICATED panel (not a generic-schema section): the parent owns
  persistence and passes the current series in / receives an updated series out
  via `onchange`, which it writes into the encrypted draft under `vitalverlauf`.

  Touch-friendly inputs, both themes; consumes only design-system tokens.
-->
<script lang="ts">
  import { Icon } from '$lib/ui';
  import { t } from '$lib/i18n';
  import VitalTrendChart from './VitalTrendChart.svelte';
  import VitalIndicators from './VitalIndicators.svelte';
  import { VITAL_PARAMS, newReadingId, nowHHmm, type VitalReading } from './types';
  import { sortedReadings } from './indicators';

  interface Props {
    readings: VitalReading[];
    readonly?: boolean;
    /** suggested GCS (from ABCDE sub-scores) used to prefill a new row. */
    suggestedGcs?: number | null;
    onchange?: (readings: VitalReading[]) => void;
  }
  let { readings, readonly = false, suggestedGcs = null, onchange }: Props = $props();

  // Chart series toggles.
  let selected = $state<Set<string>>(new Set(['rrSys', 'hf', 'spo2']));

  const sorted = $derived(sortedReadings(readings));

  // Numeric columns rendered in each editable row.
  const NUM_COLS: { key: Exclude<keyof VitalReading, 'id' | 'time'>; short: string }[] = [
    { key: 'rrSys', short: 'rrSys' },
    { key: 'rrDia', short: 'rrDia' },
    { key: 'hf', short: 'hf' },
    { key: 'af', short: 'af' },
    { key: 'spo2', short: 'spo2' },
    { key: 'bz', short: 'bz' },
    { key: 'temp', short: 'temp' },
    { key: 'gcs', short: 'gcs' },
  ];

  function emit(next: VitalReading[]): void {
    onchange?.(next);
  }

  function addRow(): void {
    if (readonly) return;
    const row: VitalReading = {
      id: newReadingId(),
      time: nowHHmm(),
      ...(typeof suggestedGcs === 'number' ? { gcs: suggestedGcs } : {}),
    };
    emit([...readings, row]);
  }

  function removeRow(id: string): void {
    if (readonly) return;
    emit(readings.filter((r) => r.id !== id));
  }

  function setTime(id: string, time: string): void {
    if (readonly) return;
    emit(readings.map((r) => (r.id === id ? { ...r, time } : r)));
  }

  function setNum(id: string, key: Exclude<keyof VitalReading, 'id' | 'time'>, raw: string): void {
    if (readonly) return;
    emit(
      readings.map((r) => {
        if (r.id !== id) return r;
        const next: VitalReading = { ...r };
        if (raw === '') delete next[key];
        else next[key] = Number(raw);
        return next;
      }),
    );
  }

  function toggleParam(key: string): void {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  }

  function strNum(v: number | undefined): string {
    return v === undefined || Number.isNaN(v) ? '' : String(v);
  }
</script>

<div class="space-y-5">
  <!-- Indicators -->
  <VitalIndicators {readings} />

  <!-- Chart + series toggles -->
  <div class="card space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-base font-semibold text-fg">{$t('vitals.chartTitle')}</h3>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label={$t('vitals.series')}>
        {#each VITAL_PARAMS as p (p.key)}
          <button
            type="button"
            class={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              selected.has(p.key)
                ? 'border-brand bg-brand-soft text-brand-soft-fg'
                : 'border-line-strong bg-surface-1 text-muted hover:bg-surface-2'
            }`}
            aria-pressed={selected.has(p.key)}
            onclick={() => toggleParam(p.key)}
          >
            {$t(`vitals.param.${p.short}`)}
          </button>
        {/each}
      </div>
    </div>
    <VitalTrendChart {readings} {selected} />
  </div>

  <!-- Readings table -->
  <div class="space-y-2">
    {#if sorted.length === 0}
      <p
        class="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted"
      >
        {$t('vitals.empty')}
      </p>
    {:else}
      <div class="overflow-x-auto rounded-xl border border-line">
        <table class="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr
              class="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-subtle"
            >
              <th class="px-2 py-2 font-medium">{$t('vitals.param.time')}</th>
              {#each NUM_COLS as c (c.key)}
                <th class="px-2 py-2 font-medium">{$t(`vitals.param.${c.short}`)}</th>
              {/each}
              {#if !readonly}<th class="px-2 py-2"
                  ><span class="sr-only">{$t('common.actions')}</span></th
                >{/if}
            </tr>
          </thead>
          <tbody>
            {#each sorted as r (r.id)}
              <tr class="border-b border-line last:border-0">
                <td class="px-2 py-1.5">
                  <input
                    type="time"
                    class="field-input min-h-0 w-28 px-2 py-1.5"
                    disabled={readonly}
                    aria-label={$t('vitals.param.time')}
                    value={r.time}
                    oninput={(e) => setTime(r.id, e.currentTarget.value)}
                  />
                </td>
                {#each NUM_COLS as c (c.key)}
                  <td class="px-2 py-1.5">
                    <input
                      type="number"
                      inputmode="decimal"
                      class="field-input min-h-0 w-20 px-2 py-1.5"
                      disabled={readonly}
                      aria-label={$t(`vitals.param.${c.short}`)}
                      value={strNum(r[c.key])}
                      oninput={(e) => setNum(r.id, c.key, e.currentTarget.value)}
                    />
                  </td>
                {/each}
                {#if !readonly}
                  <td class="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      class="btn-ghost min-h-0 rounded-lg p-2 text-danger"
                      aria-label={$t('common.delete')}
                      onclick={() => removeRow(r.id)}
                    >
                      <Icon name="trash" size={18} />
                    </button>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if !readonly}
      <button type="button" class="btn-secondary w-full text-sm" onclick={addRow}>
        <Icon name="plus" size={18} />
        {$t('vitals.addReading')}
      </button>
    {/if}
  </div>
</div>
