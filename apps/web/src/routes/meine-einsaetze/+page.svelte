<!--
  meine-einsaetze/+page.svelte — "Meine Einsätze" (cross-device, read-only).

  Lists the deployments the logged-in user AUTHORED, on ANY device. The list is
  delivered by the server as non-secret metadata (ids + counts + dates); titles
  and categories are merged from local DeploymentMeta where present, otherwise
  best-effort recovered by decrypting the synced records with the viewer's OWN
  identity (possible via the persistent 'author' sealed-key wrapper).

  Each entry links to the EXISTING read-only Verlauf view, which decrypts the
  deployment's record chain with the viewer's identity and renders it read-only
  with an integrity check — no editing.

  FORWARD-ONLY CAVEAT (surfaced honestly): records created before this feature
  have no 'author' wrapper, so on a NEW device they can't be decrypted by the
  author (only org/admin). Those entries still list, but without a recovered
  title/category.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { Icon, Badge, EmptyState, Spinner } from '$lib/ui';
  import { getSession } from '$lib/crypto';
  import { categories, loadCategories, categoryById } from '$lib/categories';
  import { myDeployments, loadMyDeployments } from '$lib/mydeployments';

  onMount(async () => {
    const s = getSession();
    if (!s) {
      await goto('/login/');
      return;
    }
    void loadCategories();
    await loadMyDeployments();
  });

  // Reading `$categories` keeps category-name resolution reactive to admin edits.
  function categoryName(categoryId: string | undefined): string | undefined {
    if (!categoryId) return undefined;
    void $categories;
    return categoryById(categoryId)?.name;
  }

  function fmtDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      return iso;
    }
  }
</script>

<section class="space-y-4">
  <header
    class="sticky top-0 z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold text-fg">{$t('myEinsaetze.title')}</h1>
        <p class="truncate text-sm text-muted">{$t('myEinsaetze.subtitle')}</p>
      </div>
      <a href="/" class="btn-secondary px-3 text-sm">
        <Icon name="arrow-left" size={18} />
        {$t('common.back')}
      </a>
    </div>
  </header>

  <!-- Privacy / forward-only hint (the explicitly chosen tradeoff). -->
  <p
    class="flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm text-muted"
  >
    <Icon name="lock" size={16} class="mt-0.5 flex-none" />
    <span>{$t('myEinsaetze.forwardOnlyHint')}</span>
  </p>

  {#if $myDeployments.loading}
    <p class="flex items-center gap-2 text-sm text-muted">
      <Spinner size={16} />
      {$t('common.loading')}
    </p>
  {:else if $myDeployments.offline}
    <EmptyState
      icon="alert"
      title={$t('myEinsaetze.offlineTitle')}
      description={$t('myEinsaetze.offlineHint')}
    />
  {:else if $myDeployments.entries.length === 0}
    <EmptyState
      icon="clipboard"
      title={$t('myEinsaetze.empty')}
      description={$t('myEinsaetze.emptyHint')}
    />
  {:else}
    <ul class="space-y-2">
      {#each $myDeployments.entries as entry (entry.deploymentId)}
        {@const catName = categoryName(entry.categoryId)}
        <li>
          <a
            href={`/deployment/${entry.deploymentId}/verlauf/`}
            class="card flex items-center gap-3 transition-colors hover:bg-surface-2"
          >
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate font-semibold text-fg">
                  {entry.title ?? $t('myEinsaetze.untitled')}
                </span>
                {#if entry.training}<Badge tone="warning">{$t('training.badge')}</Badge>{/if}
                {#if catName}<Badge tone="muted">{catName}</Badge>{/if}
                {#if !entry.decryptable}
                  <Badge tone="muted">{$t('myEinsaetze.legacyBadge')}</Badge>
                {/if}
              </div>
              <p class="mt-1 flex flex-wrap gap-x-3 text-sm text-muted">
                <span>{$t('myEinsaetze.dateLabel')}: {fmtDate(entry.lastCreatedAt)}</span>
                <span>{$t('myEinsaetze.countLabel')}: {entry.recordCount}</span>
              </p>
            </div>
            <Icon name="chevron-right" size={18} class="flex-none text-subtle" />
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</section>
