<!--
  deployment/[id]/+page.svelte — DIENST-ÜBERSICHT (event hub).

  Phase 2 split: this page is a LEAN hub for an EVENT deployment. It no longer
  contains the patient ABCDE form (that moved to /protokoll/[pid]). It shows:
   - a header (Dienst title + open/closed status + ÜBUNG badge),
   - a LEFT sidebar ("Seitenliste") with the EVENT-level views (Übersicht ·
     Einsatztagebuch · Anwesenheit/Dienst · Material · Statistik [lead/admin] ·
     Wachbericht [→ statistik] · Veranstaltung/Einstellungen · Verlauf), and
   - a MAIN list of this deployment's PATIENT PROTOCOLS (drafts + finalized +
     quick contacts) with two primary actions: "+ Neues Protokoll" and
     "Schnell-Erfassung".

  A `kind:'single'` deployment has exactly one standalone protocol → we redirect
  straight to its capture page instead of showing this hub.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { Icon, Badge, EmptyState, Spinner } from '$lib/ui';
  import { getSession } from '$lib/crypto';
  import { getDeployment, isLeadOrAdmin, type DeploymentMeta } from '$lib/store';
  import {
    listProtocols,
    newProtocolId,
    PROTOCOL_FALLBACK_LABEL_KEY,
    type ProtocolSummary,
  } from '$lib/protocols';
  import { emptyDraft, saveDraft } from '$lib/doc/draftStore';
  import { activeSchema, loadActiveSchema } from '$lib/schemas/store';
  import { categories, loadCategories, categoryById, schemaForCategory } from '$lib/categories';
  import { QuickEntry } from '$lib/quickentry';

  const deploymentId = $derived($page.params.id ?? '');

  let meta = $state<DeploymentMeta | undefined>(undefined);
  let protocols = $state<ProtocolSummary[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let showQuickEntry = $state(false);

  const closed = $derived(meta?.status === 'closed');

  // Resolve the deployment's schema (category schema → org-active → ABCDE) so a
  // brand-new draft is stamped with the SAME schemaId/version the capture page
  // would use — keeps payloads byte-identical regardless of where it's created.
  const deploymentCategory = $derived(
    $categories.length > 0 ? categoryById(meta?.categoryId) : undefined,
  );
  const schema = $derived(schemaForCategory(deploymentCategory, $activeSchema));

  // Event-level views shown in the left sidebar (the EXISTING subroutes). The
  // Wachbericht print currently lives on the statistics page, so it links there.
  const navLinks = $derived([
    {
      href: `/deployment/${deploymentId}/`,
      label: $t('hub.overview'),
      icon: 'dashboard',
      active: true,
      show: true,
    },
    {
      href: `/deployment/${deploymentId}/tagebuch/`,
      label: $t('journal.link'),
      icon: 'clipboard',
      active: false,
      show: true,
    },
    {
      href: `/deployment/${deploymentId}/dienst/`,
      label: $t('roster.link'),
      icon: 'users',
      active: false,
      show: true,
    },
    {
      href: `/deployment/${deploymentId}/material/`,
      label: $t('material.consumption.link'),
      icon: 'clipboard',
      active: false,
      show: true,
    },
    {
      href: `/deployment/${deploymentId}/statistik/`,
      label: $t('eventstats.link'),
      icon: 'activity',
      active: false,
      show: $isLeadOrAdmin,
    },
    {
      href: `/deployment/${deploymentId}/statistik/`,
      label: $t('hub.wachbericht'),
      icon: 'file-text',
      active: false,
      show: $isLeadOrAdmin,
    },
    {
      href: `/deployment/${deploymentId}/setup/`,
      label: $t('veranstaltung.editLink'),
      icon: 'edit',
      active: false,
      show: true,
    },
    {
      href: `/deployment/${deploymentId}/verlauf/`,
      label: $t('verlauf.link'),
      icon: 'clock',
      active: false,
      show: true,
    },
  ]);

  async function refresh(): Promise<void> {
    protocols = await listProtocols(deploymentId);
  }

  onMount(async () => {
    const s = getSession();
    if (!s) {
      await goto('/login/');
      return;
    }
    void loadActiveSchema();
    void loadCategories();
    meta = await getDeployment(deploymentId);
    // A single-protocol deployment skips the hub: route straight to its one
    // protocol's capture page (it always has exactly one protocolId).
    if (meta?.kind === 'single') {
      const existing = await listProtocols(deploymentId);
      const pid = existing[0]?.protocolId ?? newProtocolId();
      await goto(`/deployment/${deploymentId}/protokoll/${pid}/`, { replaceState: true });
      return;
    }
    await refresh();
    loading = false;
  });

  /** Mint a fresh protocol, persist an empty encrypted draft, open its page. */
  async function newProtocol(): Promise<void> {
    if (busy || closed) return;
    busy = true;
    try {
      const pid = newProtocolId();
      // Persist an empty draft so the protocol exists in the hub list immediately
      // (the capture page will load/extend it). Stamped with the resolved schema.
      await saveDraft(emptyDraft(deploymentId, pid, schema.schemaId, schema.version));
      await goto(`/deployment/${deploymentId}/protokoll/${pid}/`);
    } finally {
      busy = false;
    }
  }

  async function onQuickSaved(): Promise<void> {
    meta = await getDeployment(deploymentId);
    await refresh();
  }

  function protocolLabel(p: ProtocolSummary): string {
    return p.label === PROTOCOL_FALLBACK_LABEL_KEY ? $t('protocols.fallbackLabel') : p.label;
  }

  function fmt(iso: string): string {
    try {
      return new Date(iso).toLocaleString('de-DE');
    } catch {
      return iso;
    }
  }
</script>

<section class="space-y-4">
  <!-- Header -->
  <header
    class="sticky top-0 z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="flex items-center gap-2 truncate text-xl font-semibold text-fg">
          {#if meta?.training}<Badge tone="warning">{$t('training.badge')}</Badge>{/if}
          <span class="truncate">{meta?.title ?? $t('deployment.title')}</span>
        </h1>
        <p class="mt-0.5 flex items-center gap-2 text-sm text-muted">
          <Badge tone={closed ? 'muted' : 'ok'}>
            {closed ? $t('hub.statusClosed') : $t('hub.statusOpen')}
          </Badge>
          <span>{$t('deployment.recordCount', { count: meta?.recordCount ?? 0 })}</span>
        </p>
      </div>
      <a href="/" class="btn-ghost px-3 text-sm">
        <Icon name="arrow-left" size={18} />
        {$t('common.back')}
      </a>
    </div>
  </header>

  {#if meta?.training}
    <p
      class="flex items-center gap-2 rounded-xl border border-warning bg-warning-soft px-4 py-2 text-sm font-medium text-warning-fg"
      role="status"
    >
      <Icon name="alert" size={18} />
      {$t('training.banner')}
    </p>
  {/if}

  <div class="flex flex-col gap-4 lg:flex-row">
    <!-- LEFT sidebar: Dienst-Übersicht (event-level views). -->
    <nav class="lg:w-64 lg:flex-none" aria-label={$t('hub.overviewNav')}>
      <p class="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-subtle">
        {$t('hub.overviewNav')}
      </p>
      <ul class="space-y-1">
        {#each navLinks.filter((l) => l.show) as link (link.label)}
          <li>
            <a
              href={link.href}
              aria-current={link.active ? 'page' : undefined}
              class={`flex min-h-touch items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                link.active
                  ? 'border-line-strong bg-surface-1 font-medium text-fg'
                  : 'border-transparent text-muted hover:bg-surface-2'
              }`}
            >
              <Icon name={link.icon} size={18} />
              <span class="truncate">{link.label}</span>
            </a>
          </li>
        {/each}
      </ul>
    </nav>

    <!-- MAIN: list of patient protocols + primary actions. -->
    <main class="min-w-0 flex-1 space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-fg">{$t('hub.protocolsTitle')}</h2>
          <p class="text-sm text-muted">{$t('hub.protocolsSubtitle')}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn-secondary px-4 text-sm"
            disabled={closed}
            onclick={() => (showQuickEntry = true)}
          >
            <Icon name="plus" size={18} />
            <span class="hidden sm:inline">{$t('quickentry.action')}</span>
          </button>
          <button
            type="button"
            class="btn-primary px-4 text-sm"
            disabled={busy || closed}
            onclick={newProtocol}
          >
            <Icon name="plus" size={18} />
            {$t('hub.newProtocol')}
          </button>
        </div>
      </div>

      {#if loading}
        <p class="flex items-center gap-2 text-sm text-muted">
          <Spinner size={16} />
          {$t('common.loading')}
        </p>
      {:else if protocols.length === 0}
        <EmptyState icon="file-text" title={$t('hub.empty')} />
      {:else}
        <ul class="space-y-2.5">
          {#each protocols as p (p.protocolId)}
            <li
              class="card flex min-h-touch items-center justify-between gap-3 py-4 transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              <a
                href={`/deployment/${deploymentId}/protokoll/${p.protocolId}/`}
                class="flex min-w-0 flex-1 items-center gap-2"
                aria-label={$t('hub.openProtocol')}
              >
                {#if p.isQuick}
                  <Badge tone="muted">{$t('hub.quickBadge')}</Badge>
                {/if}
                <span class="truncate font-medium text-fg">{protocolLabel(p)}</span>
              </a>
              <span class="flex shrink-0 items-center gap-3 text-sm text-muted">
                <span class="hidden tabular-nums sm:inline">{fmt(p.updatedAt)}</span>
                <Badge tone={p.status === 'final' ? 'brand' : 'warning'}>
                  {p.status === 'final' ? $t('hub.finalBadge') : $t('hub.draftBadge')}
                </Badge>
                <Icon name="chevron-right" size={18} />
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </main>
  </div>
</section>

<!-- Schnell-Erfassung: builds a real signed quick-contact record in this
     deployment (sealed to org + helper + supervisors). After save, refresh the
     protocol list so the new contact appears. -->
<QuickEntry
  open={showQuickEntry}
  {deploymentId}
  onClose={() => (showQuickEntry = false)}
  onSaved={onQuickSaved}
/>
