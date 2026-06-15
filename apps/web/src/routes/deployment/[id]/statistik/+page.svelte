<!--
  deployment/[id]/statistik/+page.svelte — EINSATZSTATISTIK for ONE Veranstaltung.

  Visible to LEAD + ADMIN only (guarded by $session.role; others get a clear
  notice). It pulls the org records (scope=org), filters to THIS deploymentId,
  and decrypts each by opening the sealedKey addressed to the CALLER'S OWN keyId
  (the 'supervisor' wrapper) with their box secret key — NO org password needed
  (mirrors cosignDecrypt). It then aggregates BOTH full ABCDE protocols AND quick
  contacts: total Kontakte, Versorgungsart + Verbleib breakdown, severity, age/sex
  distribution, complaint buckets, and contacts over time (by hour).

  Records the caller cannot decrypt (old, not supervisor-sealed) are counted and
  surfaced as "x Kontakte vor dieser Funktion nicht enthalten". Decrypted data
  lives in memory only for this view; nothing is persisted/logged.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { session, isLeadOrAdmin, getDeployment, type DeploymentMeta } from '$lib/store';
  import { api, ApiClientError } from '$lib/api';
  import { Icon, Badge, EmptyState, StatCard, Spinner } from '$lib/ui';
  import { runEventStats, type EventStats } from '$lib/eventstats';
  import StatBar from './StatBar.svelte';
  import HourSeries from './HourSeries.svelte';
  import type { CategoryCount } from '$lib/analytics';
  import { getOrgInfo } from '$lib/store';
  import { Wachbericht, aggregateMaterial, triggerPrint, type WachberichtData } from '$lib/export';

  const deploymentId = $derived($page.params.id ?? '');

  let meta = $state<DeploymentMeta | undefined>(undefined);
  let stats = $state<EventStats | null>(null);
  let skipped = $state(0);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const canView = $derived($isLeadOrAdmin);

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    meta = await getDeployment(deploymentId);
    if (!$isLeadOrAdmin) {
      loading = false;
      return; // role gate — render the notice below
    }
    await run();
  });

  async function run(): Promise<void> {
    loading = true;
    error = null;
    try {
      const res = await runEventStats(deploymentId);
      stats = res.stats;
      skipped = res.skipped;
    } catch (err) {
      if (err instanceof ApiClientError) {
        error = err.status === 403 ? $t('eventstats.forbidden') : $t('eventstats.loadFailed');
      } else {
        error = $t('eventstats.loadFailed');
      }
    } finally {
      loading = false;
    }
  }

  // --- label resolution for option values (org config / fixed sets, not data) --
  function optLabel(group: string, value: string): string {
    const key = `eventstats.values.${group}.${value}`;
    const label = $t(key);
    return label === key ? value : label;
  }

  function bars(counts: CategoryCount[], group: string): { label: string; value: number }[] {
    return counts.map((c) => ({ label: optLabel(group, c.value), value: c.count }));
  }

  // --- Wachbericht (Abschlussbericht) drucken -------------------------------
  // Aggregiert lokale Stammdaten + Roster + Materialverbrauch (server) +
  // eventstats (TRAINING bereits ausgeschlossen) und druckt die A4-Ansicht.
  let wachberichtData = $state<WachberichtData | null>(null);
  let printingWachbericht = $state(false);

  async function printWachbericht(): Promise<void> {
    if (!stats || !meta || printingWachbericht) return;
    printingWachbericht = true;
    try {
      const [roster, consumption] = await Promise.all([
        api.getRoster(deploymentId).catch(() => ({ entries: [] })),
        api.listConsumption(deploymentId).catch(() => ({ entries: [] })),
      ]);
      wachberichtData = {
        orgName: getOrgInfo()?.orgName,
        meta,
        roster: roster.entries,
        stats,
        material: aggregateMaterial(consumption.entries),
        generatedAt: new Date().toISOString(),
      };
      // Let <Wachbericht> mount/paint before opening the print dialog.
      await new Promise((r) => setTimeout(r, 50));
      triggerPrint();
    } catch {
      error = $t('wachbericht.printFailed');
    } finally {
      printingWachbericht = false;
    }
  }
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="activity" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('eventstats.title')}</h1>
    </div>
    <p class="text-muted">
      {meta?.title ?? deploymentId}
    </p>
  </header>

  <nav class="flex flex-wrap gap-2 print:hidden">
    <a class="btn-ghost px-3 text-sm" href={`/deployment/${deploymentId}/`}>
      <Icon name="arrow-left" size={18} />{$t('common.back')}
    </a>
    {#if canView && stats}
      <button
        type="button"
        class="btn-secondary px-4 text-sm"
        disabled={printingWachbericht}
        onclick={printWachbericht}
      >
        <Icon name="file-text" size={18} />
        {$t('wachbericht.print')}
      </button>
    {/if}
  </nav>

  {#if !canView}
    <div class="card flex items-start gap-3">
      <span class="shrink-0 text-warning"><Icon name="lock" size={20} /></span>
      <div class="space-y-1">
        <p class="font-medium text-fg">{$t('eventstats.forbiddenTitle')}</p>
        <p class="text-sm text-muted">{$t('eventstats.forbidden')}</p>
      </div>
    </div>
  {:else if loading}
    <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
      <Spinner />
      <p class="text-sm text-muted">{$t('eventstats.loading')}</p>
    </div>
  {:else if error}
    <div class="space-y-3">
      <p class="field-error" role="alert">{error}</p>
      <button type="button" class="btn-secondary px-4 text-sm" onclick={run}>
        {$t('eventstats.retry')}
      </button>
    </div>
  {:else if stats}
    {#if stats.isTraining}
      <p
        class="flex items-center gap-2 rounded-xl border border-warning bg-warning-soft px-4 py-2 text-sm font-medium text-warning-fg"
        role="status"
      >
        <Icon name="alert" size={18} />
        {$t('training.statsNote')}
      </p>
    {/if}
    {#if skipped > 0}
      <p class="rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm text-warning">
        {$t('eventstats.skippedNote', { count: skipped })}
      </p>
    {/if}

    {#if stats.totalContacts === 0}
      <EmptyState icon="clipboard" title={$t('eventstats.empty')} />
    {:else}
      <!-- KPIs -->
      <section class="space-y-3">
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatCard
            label={$t('eventstats.totalContacts')}
            value={stats.totalContacts}
            icon="users"
            tone="brand"
          />
          <StatCard
            label={$t('eventstats.protocols')}
            value={stats.protocolContacts}
            icon="file-text"
          />
          <StatCard label={$t('eventstats.quick')} value={stats.quickContacts} icon="activity" />
          <StatCard
            label={$t('eventstats.transports')}
            value={stats.disposition.transport}
            icon="arrow-up-right"
            tone="ok"
          />
          <StatCard
            label={$t('eventstats.refusals')}
            value={stats.disposition.refusal}
            icon="alert"
            tone="warning"
          />
        </div>
      </section>

      <!-- Contacts over time (by hour) -->
      <section class="card space-y-4">
        <h2 class="text-lg font-semibold text-fg">{$t('eventstats.overTimeTitle')}</h2>
        <HourSeries buckets={stats.perHour} title={$t('eventstats.overTimeTitle')} />
      </section>

      <!-- Versorgungsart + Verbleib -->
      <section class="card space-y-5">
        <h2 class="text-lg font-semibold text-fg">{$t('eventstats.careTitle')}</h2>
        <div class="grid gap-6 md:grid-cols-2">
          <div class="space-y-2">
            <p class="field-label">{$t('eventstats.byVersorgungsart')}</p>
            <StatBar
              bars={bars(stats.byVersorgungsart, 'versorgungsart')}
              title={$t('eventstats.byVersorgungsart')}
            />
          </div>
          <div class="space-y-2">
            <p class="field-label">{$t('eventstats.byVerbleib')}</p>
            <StatBar
              bars={bars(stats.byVerbleib, 'verbleib')}
              title={$t('eventstats.byVerbleib')}
            />
          </div>
        </div>
      </section>

      <!-- Severity + complaints -->
      <section class="card space-y-5">
        <h2 class="text-lg font-semibold text-fg">{$t('eventstats.severityTitle')}</h2>
        <div class="grid gap-6 md:grid-cols-2">
          <div class="space-y-2">
            <p class="field-label">{$t('eventstats.bySeverity')}</p>
            <StatBar
              bars={bars(stats.bySeverity, 'ersteindruck')}
              title={$t('eventstats.bySeverity')}
            />
          </div>
          <div class="space-y-2">
            <p class="field-label">{$t('eventstats.byComplaint')}</p>
            <StatBar
              bars={stats.byComplaint.map((c) => ({ label: c.value, value: c.count }))}
              title={$t('eventstats.byComplaint')}
            />
          </div>
        </div>
      </section>

      <!-- Age + sex -->
      <section class="card space-y-5">
        <h2 class="text-lg font-semibold text-fg">{$t('eventstats.demographicsTitle')}</h2>
        <div class="grid gap-6 md:grid-cols-2">
          <div class="space-y-2">
            <p class="field-label">{$t('eventstats.byAge')}</p>
            <StatBar bars={bars(stats.byAge, 'altersgruppe')} title={$t('eventstats.byAge')} />
          </div>
          <div class="space-y-2">
            <p class="field-label">{$t('eventstats.bySex')}</p>
            <StatBar bars={bars(stats.bySex, 'geschlecht')} title={$t('eventstats.bySex')} />
          </div>
        </div>
      </section>

      <p class="text-xs text-subtle">{$t('eventstats.privacyNote')}</p>
    {/if}
  {/if}
</section>

<!-- Wachbericht (Abschlussbericht): bildschirmverborgen, materialisiert nur beim
     Drucken. Aggregiert Stammdaten + Roster + Material + eventstats (TRAINING
     ausgeschlossen). -->
{#if printingWachbericht && wachberichtData}
  <Wachbericht data={wachberichtData} />
{/if}
