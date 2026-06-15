<!--
  admin/auswertung/+page.svelte — ORG ANALYTICS dashboard (admin/lead only).

  An admin/lead enters the ORG password; the org key is briefly unwrapped in
  memory, EVERY org record is pulled (api.syncOrg → scope=org, org wrappers only)
  and decrypted LOCALLY, then reduced to a fully ANONYMISED AnalyticsResult
  (KPIs, distributions, vitals, injury heatmap). Nothing decrypted is persisted;
  the org password + org secret + decrypted payloads live only in memory during
  the run and are zeroed afterwards (see $lib/analytics/run.ts). The export
  contains aggregates only (whitelist in $lib/analytics/types.ts).
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { session, isLeadOrAdmin } from '$lib/store';
  import { api, ApiClientError } from '$lib/api';
  import { Icon, Badge, EmptyState, StatCard, Spinner } from '$lib/ui';
  import { loadActiveSchema } from '$lib/schemas/store';
  import { abcdeSchema } from '$lib/schemas/abcde';
  import type { DocSchema } from '$lib/schemas/types';
  import {
    runAnalytics,
    schemaLabels,
    toCsv,
    toJson,
    downloadFile,
    type AnalyticsResult,
    type RunProgress,
  } from '$lib/analytics';
  import InjuryHeatmap from './InjuryHeatmap.svelte';
  import BarChart from './BarChart.svelte';
  import TimeSeries from './TimeSeries.svelte';

  // Security-sensitive: held only transiently for one run.
  let orgPassword = $state('');
  let busy = $state(false);
  let formError = $state<string | null>(null);
  let progress = $state<RunProgress | null>(null);

  let result = $state<AnalyticsResult | null>(null);
  let skipped = $state(0);
  let schema = $state<DocSchema>(abcdeSchema);

  const canManage = $derived($isLeadOrAdmin);
  const labels = $derived(schemaLabels(schema));

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    if (!$isLeadOrAdmin) {
      await goto('/');
      return;
    }
    // Field labels are org config (not patient data); used for display/export.
    try {
      schema = await loadActiveSchema();
    } catch {
      schema = abcdeSchema;
    }
  });

  onDestroy(() => wipeSecrets());

  function wipeSecrets(): void {
    orgPassword = '';
  }

  function phaseLabel(p: RunProgress): string {
    switch (p.phase) {
      case 'unlocking':
        return $t('analytics.phaseUnlocking');
      case 'fetching':
        return $t('analytics.phaseFetching');
      case 'aggregating':
        return $t('analytics.phaseAggregating');
      default:
        return $t('analytics.phaseDecrypting');
    }
  }

  async function onRun(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    formError = null;
    busy = true;
    result = null;
    progress = { processed: 0, phase: 'unlocking' };
    try {
      const keyset = await api.getOrgKeyset();
      const run = await runAnalytics({
        keyset,
        orgPassword,
        onProgress: (p) => (progress = p),
      });
      result = run.analytics;
      skipped = run.skipped;
      orgPassword = ''; // no longer needed — wipe immediately
    } catch (err) {
      if (err instanceof ApiClientError) {
        formError = err.status === 403 ? $t('analytics.forbidden') : $t('analytics.runFailed');
      } else {
        // crypto-core throws on a wrong org password (AEAD auth failure).
        formError = $t('analytics.wrongOrgPassword');
      }
    } finally {
      busy = false;
      progress = null;
    }
  }

  function reset(): void {
    result = null;
    skipped = 0;
    wipeSecrets();
  }

  // --- export ---------------------------------------------------------------
  function exportCsv(): void {
    if (!result) return;
    downloadFile(`${$t('analytics.exportFilename')}.csv`, toCsv(result, labels), 'text/csv');
  }
  function exportJson(): void {
    if (!result) return;
    downloadFile(`${$t('analytics.exportFilename')}.json`, toJson(result), 'application/json');
  }
  function doPrint(): void {
    window.print();
  }

  // --- derived view helpers -------------------------------------------------
  const transportRate = $derived(
    result && result.disposition.total > 0
      ? Math.round((result.disposition.transport / result.disposition.total) * 100)
      : 0,
  );

  /** Top distributions as bar-chart inputs (label-resolved, top 6 per field). */
  const topCategories = $derived(
    result
      ? result.distributions.map((d) => ({
          field: d.field,
          label: labels('field', d.field),
          bars: d.counts.slice(0, 6).map((c) => ({
            label: labels('option', d.field, c.value),
            value: c.count,
          })),
        }))
      : [],
  );

  const injuryTypeBars = $derived(
    result
      ? Object.entries(result.injuries.byType).map(([type, count]) => ({
          label: type,
          value: count ?? 0,
        }))
      : [],
  );
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="activity" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('analytics.title')}</h1>
    </div>
    <p class="text-muted">{$t('analytics.subtitle')}</p>
  </header>

  <!-- In-page admin nav (the shell drawer is owned elsewhere). -->
  <nav class="flex flex-wrap gap-2 print:hidden">
    <a class="btn-ghost px-3 text-sm" href="/admin/users/">
      <Icon name="users" size={18} />{$t('nav.users')}
    </a>
  </nav>

  {#if !canManage}
    <p class="field-error">{$t('analytics.forbidden')}</p>
  {:else if !result}
    <!-- Unlock + run form -->
    <section class="card space-y-5 print:hidden">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-fg">{$t('analytics.unlockTitle')}</h2>
        <p class="text-sm text-muted">{$t('analytics.unlockIntro')}</p>
      </div>

      <form class="space-y-5" onsubmit={onRun}>
        <div>
          <label class="field-label" for="org-pw">{$t('analytics.orgPassword')}</label>
          <input
            id="org-pw"
            class="field-input"
            type="password"
            autocomplete="off"
            bind:value={orgPassword}
            required
          />
          <p class="mt-1 text-xs text-subtle">{$t('analytics.orgPasswordHint')}</p>
        </div>

        {#if formError}
          <p class="field-error" role="alert">{formError}</p>
        {/if}

        {#if busy && progress}
          <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
            <Spinner />
            <div class="text-sm">
              <p class="font-medium text-fg">{phaseLabel(progress)}</p>
              <p class="text-muted">{$t('analytics.processed', { count: progress.processed })}</p>
            </div>
          </div>
        {/if}

        <button type="submit" class="btn-primary w-full" disabled={busy || !orgPassword}>
          {#if !busy}<Icon name="activity" size={18} />{/if}
          {busy ? $t('analytics.running') : $t('analytics.run')}
        </button>
      </form>
    </section>
  {:else}
    <!-- Results -->
    <!-- Anonymisation banner -->
    <section class="flex gap-3 rounded-xl border border-line bg-surface-2 p-4">
      <span class="shrink-0 text-ok"><Icon name="shield-check" size={20} /></span>
      <div class="space-y-1">
        <div class="flex items-center gap-2">
          <Badge tone="ok">{$t('analytics.privacyTitle')}</Badge>
        </div>
        <p class="text-sm text-muted">{$t('analytics.privacyNote')}</p>
      </div>
    </section>

    {#if skipped > 0}
      <p class="text-sm text-warning">{$t('analytics.skippedNote', { count: skipped })}</p>
    {/if}

    {#if result.totalProtocols === 0}
      <EmptyState icon="clipboard" title={$t('analytics.empty')} />
    {:else}
      <!-- KPIs -->
      <section class="space-y-3">
        <h2 class="text-lg font-semibold text-fg">{$t('analytics.kpisTitle')}</h2>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            label={$t('analytics.deployments')}
            value={result.totalDeployments}
            icon="clipboard"
          />
          <StatCard
            label={$t('analytics.protocols')}
            value={result.totalProtocols}
            icon="file-text"
          />
          <StatCard
            label={$t('analytics.transports')}
            value={result.disposition.transport}
            icon="arrow-up-right"
            tone="ok"
          />
          <StatCard
            label={$t('analytics.refusals')}
            value={result.disposition.refusal}
            icon="alert"
            tone="warning"
          />
          <StatCard
            label={$t('analytics.transportRate')}
            value={`${transportRate}%`}
            tone="brand"
          />
          <StatCard label={$t('analytics.recordsProcessed')} value={result.recordsProcessed} />
        </div>
      </section>

      <!-- Protocols over time -->
      <section class="card space-y-4">
        <h2 class="text-lg font-semibold text-fg">{$t('analytics.overTimeTitle')}</h2>
        {#if result.perMonth.length === 0 && result.perDay.length === 0}
          <p class="text-sm text-muted">{$t('analytics.noTimeData')}</p>
        {:else}
          <div class="grid gap-6 md:grid-cols-2">
            <div>
              <p class="field-label">{$t('analytics.byMonth')}</p>
              <TimeSeries buckets={result.perMonth} title={$t('analytics.byMonth')} />
            </div>
            <div>
              <p class="field-label">{$t('analytics.byDay')}</p>
              <TimeSeries buckets={result.perDay} title={$t('analytics.byDay')} />
            </div>
          </div>
        {/if}
      </section>

      <!-- Vitals -->
      {#if result.vitals.length > 0}
        <section class="card space-y-3">
          <h2 class="text-lg font-semibold text-fg">{$t('analytics.vitalsTitle')}</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {#each result.vitals as v (v.key)}
              <div class="tile">
                <div class="text-sm text-muted">{labels('vital', v.key)}</div>
                <div class="mt-1 text-2xl font-medium text-fg">
                  {v.average}<span class="ml-1 text-sm text-subtle">{v.unit}</span>
                </div>
                <div class="mt-1 text-xs text-subtle">n={v.count}</div>
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Categories -->
      {#if topCategories.length > 0}
        <section class="card space-y-5">
          <h2 class="text-lg font-semibold text-fg">{$t('analytics.categoriesTitle')}</h2>
          <div class="grid gap-6 md:grid-cols-2">
            {#each topCategories as cat (cat.field)}
              <div class="space-y-2">
                <p class="field-label">{cat.label}</p>
                <BarChart bars={cat.bars} title={cat.label} />
              </div>
            {/each}
          </div>
        </section>
      {/if}

      <!-- Injury heatmap -->
      <section class="card space-y-4">
        <h2 class="text-lg font-semibold text-fg">{$t('analytics.heatmapTitle')}</h2>
        <p class="text-sm text-muted">{$t('analytics.heatmapHint')}</p>
        {#if result.injuries.total === 0}
          <p class="text-sm text-muted">{$t('analytics.noInjuries')}</p>
        {:else}
          <div class="grid gap-6 sm:grid-cols-2">
            <div class="space-y-2 text-center">
              <p class="field-label">{$t('analytics.front')}</p>
              <InjuryHeatmap side="front" heat={result.heat} peak={result.heatPeak} />
            </div>
            <div class="space-y-2 text-center">
              <p class="field-label">{$t('analytics.back')}</p>
              <InjuryHeatmap side="back" heat={result.heat} peak={result.heatPeak} />
            </div>
          </div>
          <div class="grid gap-6 md:grid-cols-2">
            <div class="space-y-2">
              <p class="field-label">{$t('analytics.injuriesByType')}</p>
              <BarChart bars={injuryTypeBars} title={$t('analytics.injuriesByType')} />
            </div>
          </div>
        {/if}
      </section>

      <!-- Export -->
      <section class="card space-y-3 print:hidden">
        <div class="space-y-1">
          <h2 class="text-lg font-semibold text-fg">{$t('analytics.exportTitle')}</h2>
          <p class="text-sm text-muted">{$t('analytics.exportHint')}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-secondary px-4 text-sm" onclick={exportCsv}>
            <Icon name="download" size={18} />{$t('analytics.exportCsv')}
          </button>
          <button type="button" class="btn-secondary px-4 text-sm" onclick={exportJson}>
            <Icon name="download" size={18} />{$t('analytics.exportJson')}
          </button>
          <button type="button" class="btn-secondary px-4 text-sm" onclick={doPrint}>
            <Icon name="file-text" size={18} />{$t('analytics.print')}
          </button>
          <button type="button" class="btn-ghost px-4 text-sm" onclick={reset}>
            {$t('analytics.reset')}
          </button>
        </div>
      </section>
    {/if}
  {/if}
</section>
