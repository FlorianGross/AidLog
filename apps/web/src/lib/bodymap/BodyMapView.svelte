<!--
  BodyMapView.svelte — READ-ONLY render of body-map markers (front + back) plus a
  marker list. Used by the record / print / cosign view. No interaction.
-->
<script lang="ts">
  import { Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import Silhouette from './Silhouette.svelte';
  import { severityColor, severityTone, type BodyMarker, type BodySide } from './types';

  interface Props {
    markers: BodyMarker[];
  }
  let { markers }: Props = $props();

  const sides: { side: BodySide; key: string }[] = [
    { side: 'front', key: 'front' },
    { side: 'back', key: 'back' },
  ];

  function on(side: BodySide): BodyMarker[] {
    return markers.filter((m) => m.side === side);
  }

  function indexOfMarker(m: BodyMarker): number {
    return markers.indexOf(m) + 1;
  }
</script>

{#if markers.length === 0}
  <p class="text-sm text-muted">{$t('bodymap.empty')}</p>
{:else}
  <div class="space-y-4">
    <div class="grid grid-cols-2 gap-3">
      {#each sides as s (s.key)}
        <figure class="rounded-xl border border-line bg-surface-1 p-2">
          <figcaption
            class="mb-1 text-center text-xs font-medium uppercase tracking-wide text-subtle"
          >
            {$t(`bodymap.side.${s.key}`)}
          </figcaption>
          <div class="relative mx-auto aspect-[100/220] max-w-[160px]">
            <Silhouette side={s.side} />
            <svg viewBox="0 0 100 220" class="absolute inset-0 h-full w-full" aria-hidden="true">
              {#each on(s.side) as m (m.id)}
                <g>
                  <circle
                    cx={m.x * 100}
                    cy={m.y * 220}
                    r="5.5"
                    fill={severityColor(m.severity)}
                    stroke="rgb(var(--surface-1))"
                    stroke-width="1.5"
                  />
                  <text
                    x={m.x * 100}
                    y={m.y * 220 + 2.5}
                    text-anchor="middle"
                    font-size="6"
                    fill="rgb(var(--brand-fg))"
                  >
                    {indexOfMarker(m)}
                  </text>
                </g>
              {/each}
            </svg>
          </div>
        </figure>
      {/each}
    </div>

    <ol class="space-y-1.5">
      {#each markers as m (m.id)}
        <li class="flex items-start gap-2 text-sm">
          <span
            class="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-fg"
          >
            {indexOfMarker(m)}
          </span>
          <span class="min-w-0">
            <span class="font-medium text-fg">{$t(`bodymap.type.${m.type}`)}</span>
            <Badge tone={severityTone(m.severity)}>{$t(`bodymap.severity.${m.severity}`)}</Badge>
            <span class="text-subtle"> · {$t(`bodymap.side.${m.side}`)}</span>
            {#if m.note}<span class="block text-muted">{m.note}</span>{/if}
          </span>
        </li>
      {/each}
    </ol>
  </div>
{/if}
