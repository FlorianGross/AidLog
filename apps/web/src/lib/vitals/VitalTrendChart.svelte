<!--
  VitalTrendChart.svelte — hand-rolled, responsive SVG multi-series trend chart.

  No chart library. Each selected parameter is normalised to its own min/max so
  series with very different scales (e.g. HF vs SpO₂) share one plot area. The
  chart is theme-aware: stroke colours come from the design-token CSS variables
  (rgb triplets), so it adapts to light/dark automatically. It carries an
  accessible <title> + role="img" and a small legend.

  viewBox keeps it fluid; it scales to its container width.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import type { VitalParamDef, VitalReading } from './types';
  import { VITAL_PARAMS } from './types';
  import { sortedReadings, timeKey } from './indicators';

  interface Props {
    readings: VitalReading[];
    /** which parameter keys to plot; defaults to a sensible core set. */
    selected?: Set<string>;
    height?: number;
  }
  let { readings, selected = new Set(['rrSys', 'hf', 'spo2']), height = 220 }: Props = $props();

  // Token → CSS color. Uses the same RGB-triplet variables as the rest of the app.
  const TONE_VAR: Record<VitalParamDef['tone'], string> = {
    brand: 'rgb(var(--brand))',
    danger: 'rgb(var(--danger))',
    warning: 'rgb(var(--warning))',
    ok: 'rgb(var(--ok))',
    fg: 'rgb(var(--text))',
  };

  const W = 640;
  const H = $derived(height);
  const PAD = { top: 12, right: 12, bottom: 26, left: 12 };

  const sorted = $derived(sortedReadings(readings));
  const params = $derived(VITAL_PARAMS.filter((p) => selected.has(p.key)));

  /** x position for the i-th reading across the plot width. */
  function xAt(i: number, n: number): number {
    const innerW = W - PAD.left - PAD.right;
    if (n <= 1) return PAD.left + innerW / 2;
    return PAD.left + (innerW * i) / (n - 1);
  }

  interface Series {
    def: VitalParamDef;
    color: string;
    points: { x: number; y: number; v: number }[];
    path: string;
  }

  function buildSeries(def: VitalParamDef): Series | null {
    const vals: { i: number; v: number }[] = [];
    sorted.forEach((r, i) => {
      const v = r[def.key];
      if (typeof v === 'number' && !Number.isNaN(v)) vals.push({ i, v });
    });
    if (vals.length === 0) return null;
    const nums = vals.map((p) => p.v);
    let min = Math.min(...nums);
    let max = Math.max(...nums);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const innerH = H - PAD.top - PAD.bottom;
    const n = sorted.length;
    const points = vals.map(({ i, v }) => {
      const x = xAt(i, n);
      const y = PAD.top + innerH * (1 - (v - min) / (max - min));
      return { x, y, v };
    });
    const path = points
      .map((p, idx) => `${idx === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' ');
    return { def, color: TONE_VAR[def.tone], points, path };
  }

  const series = $derived(params.map(buildSeries).filter((s): s is Series => s !== null));

  const xLabels = $derived(
    sorted.map((r, i) => ({ x: xAt(i, sorted.length), label: timeKey(r) || '—' })),
  );

  const a11yLabel = $derived(
    `${$t('vitals.chartTitle')} — ${params.map((p) => $t(`vitals.param.${p.short}`)).join(', ')}`,
  );
</script>

{#if sorted.length === 0}
  <p
    class="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted"
  >
    {$t('vitals.noData')}
  </p>
{:else}
  <figure class="space-y-2">
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      role="img"
      aria-label={a11yLabel}
      class="overflow-visible"
      preserveAspectRatio="none"
    >
      <title>{a11yLabel}</title>
      <!-- baseline + grid -->
      <line
        x1={PAD.left}
        y1={H - PAD.bottom}
        x2={W - PAD.right}
        y2={H - PAD.bottom}
        stroke="rgb(var(--line-strong))"
        stroke-width="1"
      />
      {#each xLabels as xl (xl.x)}
        <line
          x1={xl.x}
          y1={PAD.top}
          x2={xl.x}
          y2={H - PAD.bottom}
          stroke="rgb(var(--line))"
          stroke-width="1"
          stroke-dasharray="2 4"
        />
        <text
          x={xl.x}
          y={H - PAD.bottom + 16}
          text-anchor="middle"
          font-size="11"
          fill="rgb(var(--text-subtle))"
        >
          {xl.label}
        </text>
      {/each}

      <!-- series -->
      {#each series as s (s.def.key)}
        <path
          d={s.path}
          fill="none"
          stroke={s.color}
          stroke-width="2"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
        {#each s.points as p (p.x)}
          <circle cx={p.x} cy={p.y} r="3" fill={s.color} />
        {/each}
      {/each}
    </svg>

    <!-- legend -->
    <figcaption class="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {#each params as p (p.key)}
        <span class="inline-flex items-center gap-1.5 text-xs text-muted">
          <span
            class="inline-block h-2.5 w-2.5 flex-none rounded-full"
            style={`background:${TONE_VAR[p.tone]}`}
            aria-hidden="true"
          ></span>
          {$t(`vitals.param.${p.short}`)}{#if p.unit}<span class="text-subtle">
              ({p.unit})</span
            >{/if}
        </span>
      {/each}
    </figcaption>
  </figure>
{/if}
