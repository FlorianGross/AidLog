<!--
  ScorePanel.svelte — LIVE clinical early-warning scores from the latest reading.

  Renders NEWS2, qSOFA and (optionally) MEWS as risk-toned Badges with a short
  escalation hint each. All scoring lives in indicators.ts (pure, testable). The
  panel takes the vital series plus the flat form `values` (to derive O₂-Gabe and
  AVPU context). Missing inputs degrade gracefully to "—".

  Usable both in the live editor and the read-only/print review (`compact`).
-->
<script lang="ts">
  import { Badge } from '$lib/ui';
  import { t } from '$lib/i18n';
  import type { VitalReading } from './types';
  import {
    latestReading,
    news2,
    qsofa,
    mews,
    scoreContextFromValues,
    type ScoreResult,
  } from './indicators';

  interface Props {
    readings: VitalReading[];
    /** flat documentation form values, for O₂-Gabe / AVPU context. */
    values?: Record<string, unknown>;
    /** include MEWS (off by default — NEWS2/qSOFA are the primary pair). */
    showMews?: boolean;
    /** tighter layout for the read-only review/print. */
    compact?: boolean;
  }
  let { readings, values = {}, showMews = true, compact = false }: Props = $props();

  const latest = $derived(latestReading(readings));
  const ctx = $derived(scoreContextFromValues(values));

  const scores = $derived([
    { id: 'news2', label: $t('scores.news2'), res: news2(latest, ctx) },
    { id: 'qsofa', label: $t('scores.qsofa'), res: qsofa(latest, ctx) },
    ...(showMews ? [{ id: 'mews', label: $t('scores.mews'), res: mews(latest, ctx) }] : []),
  ] as { id: string; label: string; res: ScoreResult }[]);

  function value(res: ScoreResult): string {
    return res.total === null ? '—' : String(res.total);
  }
</script>

<div class={compact ? 'space-y-2' : 'space-y-3'}>
  {#if !latest}
    <p class="text-sm text-muted">{$t('scores.empty')}</p>
  {:else}
    <div class="flex flex-wrap items-stretch gap-2">
      {#each scores as s (s.id)}
        <div
          class="flex min-w-[8.5rem] flex-col gap-1 rounded-xl border border-line bg-surface-1 px-3 py-2"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-semibold uppercase tracking-wide text-subtle">{s.label}</span>
            <Badge tone={s.res.total === null ? 'muted' : s.res.tone}>{value(s.res)}</Badge>
          </div>
          <span class="text-xs text-muted">
            {$t(`scores.hint.${s.res.hintKey}`)}
            {#if s.res.total !== null && !s.res.complete}
              <span class="text-subtle"> · {$t('scores.partial')}</span>
            {/if}
          </span>
        </div>
      {/each}
    </div>
    {#if !compact}
      <p class="text-xs text-subtle">{$t('scores.disclaimer')}</p>
    {/if}
  {/if}
</div>
