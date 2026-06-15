<!--
  +page.svelte — Dashboard.

  Stat cards (offene Einsätze, Einsätze gesamt, offene Gegenzeichnungen,
  Protokolle heute), a "letzte Einsätze" list, a "wartet auf meine Signatur"
  panel, and a prominent "Neuen Einsatz starten" action.

  Local counts come from IndexedDB; the pending-cosign count goes through the
  API (null while offline).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import {
    session,
    deployments,
    loadDeployments,
    createDeployment,
    startSingleProtocol,
    loadDashboardStats,
    type DashboardStats,
  } from '$lib/store';
  import { categories, loadCategories, categoriesForRole, categoryById } from '$lib/categories';
  import type { ProtocolCategory } from '@aidlog/contracts';
  import { StatCard, Badge, EmptyState, Icon } from '$lib/ui';
  import { QuickEntry } from '$lib/quickentry';

  let newTitle = $state('');
  let stats = $state<DashboardStats | null>(null);
  let selectedCategoryId = $state('');
  // ÜBUNGS-/DEMO-MODUS: flag the new deployment as a training/exercise.
  let newTraining = $state(false);
  // Schnell-Erfassung shortcut: the deploymentId currently targeted (or null).
  let quickEntryFor = $state<string | null>(null);

  async function onQuickSaved(): Promise<void> {
    await loadDeployments();
    stats = await loadDashboardStats();
  }

  const recent = $derived($deployments.slice(0, 5));

  // Whether the org has defined ANY categories. When none exist, the dashboard
  // keeps its legacy behaviour: a plain "Einsatz" with no categoryId (backward
  // compatible — the editor then uses the org-active / ABCDE schema).
  const hasAnyCategories = $derived($categories.length > 0);
  // Only the categories the current role may create a deployment under. Reading
  // `$categories` makes this re-derive when categories load or the role changes.
  const creatable = $derived(hasAnyCategories ? categoriesForRole($session.role) : []);
  // When exactly one category is available we skip the picker and use it implicitly.
  const onlyCategory = $derived(creatable.length === 1 ? creatable[0] : null);
  const chosenCategory = $derived<ProtocolCategory | null>(
    onlyCategory ?? categoryById(selectedCategoryId) ?? creatable[0] ?? null,
  );
  // Terminology for the primary action ("Veranstaltung anlegen" / "Einsatz anlegen").
  const deploymentLabel = $derived(
    chosenCategory?.deploymentLabel?.trim() || $t('categories.defaultDeploymentLabel'),
  );

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    await Promise.all([loadDeployments(), loadCategories()]);
    stats = await loadDashboardStats();
  });

  // Busy guard so the two entry points can't double-fire.
  let creating = $state(false);

  /** Entry point 1: a full event/deployment → its lean Dienst hub. */
  async function onCreateEvent(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || creating) return;
    creating = true;
    try {
      const categoryId = chosenCategory?.id;
      const meta = await createDeployment(title, categoryId, newTraining, 'event');
      newTitle = '';
      newTraining = false;
      await goto(`/deployment/${meta.deploymentId}/`);
    } finally {
      creating = false;
    }
  }

  /**
   * Entry point 2: an Einzelprotokoll (ohne Veranstaltung). Creates a `kind:'single'`
   * deployment with a sensible auto-title (date), mints its one protocolId, and
   * routes STRAIGHT to the capture page (the hub is skipped for single deployments).
   */
  async function onCreateSingle(): Promise<void> {
    if (creating) return;
    creating = true;
    try {
      const today = new Date().toLocaleDateString('de-DE');
      const title = `${$t('dashboard.singleTitle')} · ${today}`;
      const categoryId = chosenCategory?.id;
      const { deploymentId, protocolId } = await startSingleProtocol(
        title,
        categoryId,
        newTraining,
      );
      newTraining = false;
      await goto(`/deployment/${deploymentId}/protokoll/${protocolId}/`);
    } finally {
      creating = false;
    }
  }

  function fmt(n: number | null | undefined): string {
    return n === null || n === undefined ? '–' : String(n);
  }

  /** The category badge for a deployment in the recent list (or undefined). */
  function catFor(categoryId: string | undefined): ProtocolCategory | undefined {
    return categoryById(categoryId);
  }
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('dashboard.title')}</h1>
    <p class="text-muted">{$t('dashboard.subtitle')}</p>
  </header>

  <!-- Two clear entry points: a full event/deployment (→ hub) or a standalone
       Einzelprotokoll (→ straight to the capture page). -->
  <div class="space-y-3">
    <h2 class="text-lg font-semibold text-fg">{$t('dashboard.createHeading')}</h2>
    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Entry point 1: Veranstaltung / Dienst anlegen. -->
      <form class="card space-y-3" onsubmit={onCreateEvent}>
        <div class="flex items-start gap-2">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-soft-fg"
          >
            <Icon name="clipboard" size={18} />
          </span>
          <div class="min-w-0">
            <div class="font-medium text-fg">{$t('dashboard.createEvent')}</div>
            <p class="text-xs text-subtle">{$t('dashboard.createEventHint')}</p>
          </div>
        </div>
        <!-- Category picker: only categories the current role may create. Hidden
             entirely when the org has 0–1 creatable categories. -->
        {#if creatable.length > 1}
          <div>
            <label class="field-label" for="new-category">{$t('categories.pickLabel')}</label>
            <select id="new-category" class="field-input" bind:value={selectedCategoryId}>
              {#each creatable as c (c.id)}
                <option value={c.id}>{c.name}</option>
              {/each}
            </select>
          </div>
        {/if}
        <div>
          <label class="field-label" for="new-deployment">
            {chosenCategory ? deploymentLabel : $t('deployment.name')}
          </label>
          <input
            id="new-deployment"
            class="field-input"
            placeholder={$t('deployment.namePlaceholder')}
            bind:value={newTitle}
          />
        </div>
        <button
          type="submit"
          class="btn-primary w-full"
          disabled={creating || (hasAnyCategories && creatable.length === 0)}
        >
          <Icon name="plus" size={20} />
          {chosenCategory
            ? $t('categories.createWithLabel', { label: deploymentLabel })
            : $t('dashboard.createEvent')}
        </button>
        {#if onlyCategory}
          <p class="text-xs text-subtle">
            {$t('categories.singleHint', { name: onlyCategory.name })}
          </p>
        {:else if hasAnyCategories && creatable.length === 0}
          <p class="text-xs text-warning">{$t('categories.noneForRole')}</p>
        {/if}
      </form>

      <!-- Entry point 2: Einzelprotokoll (ohne Veranstaltung). -->
      <div class="card flex flex-col gap-3">
        <div class="flex items-start gap-2">
          <span
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted"
          >
            <Icon name="file-text" size={18} />
          </span>
          <div class="min-w-0">
            <div class="font-medium text-fg">{$t('dashboard.createSingle')}</div>
            <p class="text-xs text-subtle">{$t('dashboard.createSingleHint')}</p>
          </div>
        </div>
        <div class="flex-1"></div>
        <button
          type="button"
          class="btn-secondary w-full"
          disabled={creating || (hasAnyCategories && creatable.length === 0)}
          onclick={onCreateSingle}
        >
          <Icon name="plus" size={20} />
          {$t('dashboard.createSingleAction')}
        </button>
      </div>
    </div>

    <!-- ÜBUNGS-/DEMO-MODUS: applies to whichever entry point is used next. -->
    <label class="flex items-start gap-2 text-sm text-fg">
      <input type="checkbox" class="mt-0.5" bind:checked={newTraining} />
      <span>
        <span class="font-medium">{$t('training.checkbox')}</span>
        <span class="mt-0.5 block text-xs text-subtle">{$t('training.hint')}</span>
      </span>
    </label>
  </div>

  <!-- Stat cards -->
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <StatCard
      label={$t('dashboard.openDeployments')}
      value={fmt(stats?.openDeployments)}
      icon="clipboard"
      tone="brand"
    />
    <StatCard
      label={$t('dashboard.totalDeployments')}
      value={fmt(stats?.totalDeployments)}
      icon="dashboard"
    />
    <StatCard
      label={$t('dashboard.pendingCosign')}
      value={fmt(stats?.pendingCosign)}
      icon="signature"
      tone="warning"
      href="/cosign/"
    />
    <StatCard
      label={$t('dashboard.recordsToday')}
      value={fmt(stats?.recordsToday)}
      icon="file-text"
    />
  </div>

  <!-- Pending signatures panel -->
  <a
    href="/cosign/"
    class="card flex items-center justify-between gap-4 transition-colors hover:border-line-strong hover:bg-surface-2"
  >
    <div class="flex min-w-0 items-start gap-3">
      <span
        class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning-fg"
      >
        <Icon name="signature" size={20} />
      </span>
      <div class="min-w-0">
        <div class="font-medium text-fg">{$t('dashboard.pendingSignatures')}</div>
        <p class="mt-0.5 text-sm text-muted">
          {#if stats?.pendingCosign === null || stats === null}
            {$t('dashboard.pendingSignaturesOffline')}
          {:else if stats.pendingCosign > 0}
            {$t('dashboard.pendingSignaturesCount', { count: stats.pendingCosign })}
          {:else}
            {$t('dashboard.pendingSignaturesNone')}
          {/if}
        </p>
      </div>
    </div>
    <span class="hidden shrink-0 items-center gap-1 text-sm font-medium text-brand sm:flex">
      {$t('dashboard.toCosign')}
      <Icon name="chevron-right" size={18} />
    </span>
  </a>

  <!-- Recent deployments -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold text-fg">{$t('dashboard.recentDeployments')}</h2>
    {#if recent.length === 0}
      <EmptyState icon="clipboard" title={$t('deployment.empty')} />
    {:else}
      <ul class="space-y-2.5">
        {#each recent as d (d.deploymentId)}
          {@const cat = catFor(d.categoryId)}
          <li
            class="card flex min-h-touch items-center justify-between gap-3 py-4 transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            <a
              href={`/deployment/${d.deploymentId}/`}
              class="flex min-w-0 flex-1 items-center gap-2"
            >
              {#if cat}
                <span
                  class="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted"
                  title={cat.name}
                >
                  <span
                    class="h-2 w-2 rounded-full"
                    style={`background:${cat.color || 'var(--color-brand, currentColor)'}`}
                    aria-hidden="true"
                  ></span>
                  {cat.name}
                </span>
              {/if}
              {#if d.training}
                <Badge tone="warning">{$t('training.badge')}</Badge>
              {/if}
              {#if d.kind === 'single'}
                <Badge tone="muted">{$t('dashboard.singleBadge')}</Badge>
              {/if}
              <span class="truncate font-medium text-fg">{d.title}</span>
            </a>
            <span class="flex shrink-0 items-center gap-3 text-sm text-muted">
              {#if d.status === 'open'}
                <button
                  type="button"
                  class="btn-secondary px-3 text-sm"
                  onclick={() => (quickEntryFor = d.deploymentId)}
                  aria-label={$t('quickentry.action')}
                >
                  <Icon name="plus" size={16} />
                  <span class="hidden sm:inline">{$t('quickentry.action')}</span>
                </button>
              {/if}
              <span class="hidden sm:inline"
                >{$t('deployment.recordCount', { count: d.recordCount })}</span
              >
              <Badge tone={d.status === 'open' ? 'ok' : 'muted'}>
                {d.status === 'open' ? $t('deployment.open') : $t('deployment.closed')}
              </Badge>
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</section>

<!-- Schnell-Erfassung shortcut for an open deployment from the dashboard. -->
<QuickEntry
  open={quickEntryFor !== null}
  deploymentId={quickEntryFor ?? ''}
  onClose={() => (quickEntryFor = null)}
  onSaved={onQuickSaved}
/>
