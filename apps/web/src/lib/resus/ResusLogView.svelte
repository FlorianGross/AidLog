<!--
  ResusLogView.svelte — READ-ONLY render of a resuscitation record.

  Summary chips (Beginn, Dauer, Schocks, Adrenalin) plus the timestamped event
  log as a compact table. Used by the editor's review and pickable later by the
  print / cosign views. Pure presentation — no audio, no timers, no mutation.
-->
<script lang="ts">
  import { Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import { type ResusLog, hasResusData } from './types';
  import { formatClock, formatDuration, eventTone } from './format';

  interface Props {
    log: ResusLog;
  }
  let { log }: Props = $props();

  const sorted = $derived([...log.events].sort((a, b) => a.at.localeCompare(b.at)));
  const duration = $derived(
    log.startedAt ? formatDuration(log.startedAt, log.endedAt ?? undefined) : null,
  );
</script>

{#if !hasResusData(log)}
  <p class="text-sm text-muted">{$t('resus.empty')}</p>
{:else}
  <div class="space-y-4">
    <div class="flex flex-wrap gap-2">
      {#if log.startedAt}
        <Badge tone="brand">{$t('resus.start')}: {formatClock(log.startedAt)}</Badge>
      {/if}
      {#if duration}
        <Badge tone="muted">{$t('resus.duration')}: {duration}</Badge>
      {/if}
      <Badge tone={log.shocks > 0 ? 'warning' : 'muted'}>
        {$t('resus.shocks')}: {log.shocks}
      </Badge>
      <Badge tone={log.adrenalinDoses > 0 ? 'warning' : 'muted'}>
        {$t('resus.adrenalin')}: {log.adrenalinDoses}
      </Badge>
      {#if log.endedAt}
        <Badge tone="ok">{$t('resus.ended')}: {formatClock(log.endedAt)}</Badge>
      {/if}
    </div>

    {#if sorted.length > 0}
      <div class="overflow-x-auto rounded-xl border border-line">
        <table class="w-full min-w-[360px] border-collapse text-sm">
          <thead>
            <tr
              class="border-b border-line bg-surface-2 text-left text-xs uppercase tracking-wide text-subtle"
            >
              <th class="px-3 py-2 font-medium">{$t('resus.time')}</th>
              <th class="px-3 py-2 font-medium">{$t('resus.event')}</th>
              <th class="px-3 py-2 font-medium">{$t('resus.note')}</th>
            </tr>
          </thead>
          <tbody>
            {#each sorted as e (e.id)}
              <tr class="border-b border-line text-fg last:border-0">
                <td class="px-3 py-1.5 tabular-nums">{formatClock(e.at)}</td>
                <td class="px-3 py-1.5">
                  <Badge tone={eventTone(e.type)}>{$t(`resus.eventType.${e.type}`)}</Badge>
                </td>
                <td class="px-3 py-1.5 text-muted">{e.note ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
{/if}
