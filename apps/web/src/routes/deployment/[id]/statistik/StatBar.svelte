<!--
  StatBar.svelte — tiny hand-rolled horizontal SVG-free bar chart (token colours).
  Mirrors admin/auswertung/BarChart but local to the event-stats route. Purely
  presentational over aggregate counts.
-->
<script lang="ts">
  interface Bar {
    label: string;
    value: number;
  }
  interface Props {
    bars: Bar[];
    title?: string;
  }
  let { bars, title }: Props = $props();
  const max = $derived(Math.max(1, ...bars.map((b) => b.value)));
</script>

{#if bars.length === 0}
  <p class="text-sm text-muted">—</p>
{:else}
  <div class="space-y-1.5" role="img" aria-label={title}>
    {#each bars as b (b.label)}
      <div class="flex items-center gap-2 text-sm">
        <span class="w-32 shrink-0 truncate text-muted" title={b.label}>{b.label}</span>
        <div class="relative h-5 flex-1 overflow-hidden rounded bg-surface-2">
          <div
            class="absolute inset-y-0 left-0 rounded bg-brand"
            style={`width: ${(b.value / max) * 100}%`}
          ></div>
        </div>
        <span class="w-10 shrink-0 text-right font-medium tabular-nums text-fg">{b.value}</span>
      </div>
    {/each}
  </div>
{/if}
