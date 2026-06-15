<!--
  InjuryHeatmap.svelte — aggregate injury-marker density over the body silhouette.

  Reuses the shared <Silhouette> (front/back). Heat cells come from the
  aggregation grid (analytics HEAT_COLS×HEAT_ROWS); each cell is shaded by its
  count relative to the global peak, using the danger token at variable opacity.
  Aggregate-only: no per-patient marker, note or identifier is rendered.
-->
<script lang="ts">
  import { Silhouette } from '$lib/bodymap';
  import type { BodySide } from '$lib/bodymap/types';
  import { HEAT_COLS, HEAT_ROWS, type HeatRegion } from '$lib/analytics';

  interface Props {
    side: BodySide;
    heat: HeatRegion[];
    peak: number;
  }
  let { side, heat, peak }: Props = $props();

  const cells = $derived(heat.filter((h) => h.side === side));
  // Silhouette viewBox is 100×220; map 0..1 fractions onto it.
  const W = 100;
  const H = 220;
  const cw = W / HEAT_COLS;
  const ch = H / HEAT_ROWS;

  function opacity(count: number): number {
    if (peak <= 0) return 0;
    // Floor so even a single marker is visible; cap at 0.85.
    return Math.min(0.85, 0.2 + (count / peak) * 0.65);
  }
</script>

<div class="relative mx-auto aspect-[100/220] w-full max-w-[180px]">
  <div class="absolute inset-0">
    <Silhouette {side} />
  </div>
  <svg
    class="absolute inset-0"
    viewBox="0 0 100 220"
    width="100%"
    height="100%"
    preserveAspectRatio="xMidYMid meet"
    aria-hidden="true"
  >
    {#each cells as c (`${c.col}:${c.row}`)}
      <rect
        x={c.col * cw}
        y={c.row * ch}
        width={cw}
        height={ch}
        rx="2"
        fill="rgb(var(--danger))"
        opacity={opacity(c.count)}
      >
        <title>{c.count}</title>
      </rect>
    {/each}
  </svg>
</div>
