<!--
  DiffView.svelte — field-level old→new diff for a correction.

  Each changed field maps key → schema label and shows the previous value
  struck/red and the new value highlighted green, so a reviewer sees exactly
  what a correction changed.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { Badge } from '$lib/ui';
  import type { FieldDiff } from './types';

  interface Props {
    diffs: FieldDiff[];
  }
  let { diffs }: Props = $props();
</script>

{#if diffs.length === 0}
  <p class="text-sm text-muted">{$t('verlauf.noChanges')}</p>
{:else}
  <p class="mb-3 text-xs font-medium uppercase tracking-wide text-subtle">
    {$t('verlauf.diffTitle')}
  </p>
  <ul class="space-y-3">
    {#each diffs as d (d.key)}
      <li class="tile">
        <div class="mb-2 flex items-center gap-2">
          <span class="text-sm font-medium text-fg">{d.label}</span>
          {#if d.kind === 'added'}
            <Badge tone="ok">{$t('verlauf.diffAdded')}</Badge>
          {:else if d.kind === 'removed'}
            <Badge tone="danger">{$t('verlauf.diffRemoved')}</Badge>
          {:else}
            <Badge tone="warning">{$t('verlauf.diffChanged')}</Badge>
          {/if}
        </div>
        <div class="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <span
            class={`min-w-0 break-words rounded-lg px-3 py-2 text-sm ${
              d.before ? 'bg-danger-soft text-danger-fg line-through' : 'text-subtle'
            }`}
          >
            {d.before || '—'}
          </span>
          <span class="hidden text-subtle sm:inline" aria-hidden="true">→</span>
          <span
            class={`min-w-0 break-words rounded-lg px-3 py-2 text-sm ${
              d.after ? 'bg-ok-soft text-ok-fg' : 'text-subtle'
            }`}
          >
            {d.after || '—'}
          </span>
        </div>
      </li>
    {/each}
  </ul>
{/if}
