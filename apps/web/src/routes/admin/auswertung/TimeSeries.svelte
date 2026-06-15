<!--
  TimeSeries.svelte — hand-rolled SVG vertical-bar series for protocols-over-time.
  No chart library; sized to the max bucket, token colours, sparse buckets.
-->
<script lang="ts">
  import type { TimeBucket } from '$lib/analytics';

  interface Props {
    buckets: TimeBucket[];
    title?: string;
  }
  let { buckets, title }: Props = $props();

  const max = $derived(Math.max(1, ...buckets.map((b) => b.count)));
  const W = 100;
  const H = 36;
  const gap = 1;
  const bw = $derived(buckets.length > 0 ? Math.max(0.5, W / buckets.length - gap) : 0);
</script>

{#if buckets.length === 0}
  <p class="text-sm text-muted">—</p>
{:else}
  <div class="space-y-2">
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="80"
      preserveAspectRatio="none"
      role="img"
      aria-label={title}
    >
      {#each buckets as b, i (b.label)}
        {@const h = (b.count / max) * (H - 2)}
        <rect
          x={i * (W / buckets.length)}
          y={H - h}
          width={bw}
          height={h}
          rx="0.5"
          fill="rgb(var(--brand))"
        >
          <title>{b.label}: {b.count}</title>
        </rect>
      {/each}
    </svg>
    <div class="flex justify-between text-xs text-subtle">
      <span>{buckets[0]?.label}</span>
      <span>{buckets[buckets.length - 1]?.label}</span>
    </div>
  </div>
{/if}
