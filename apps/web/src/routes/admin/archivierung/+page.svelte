<!--
  admin/archivierung/+page.svelte — ARCHIVAL ANCHORING (admin | lead).

  Trigger a new tamper-evident Merkle anchor over the org's record hash-chain,
  list existing anchors, and VERIFY an anchor by recomputing its Merkle root
  client-side from the org's PUBLIC recordHashes (fetched via scope=org sync — no
  decryption). The page explains in plain German what an anchor proves
  (manipulations-/rückdatierungssicher) and its limits.

  ZERO-KNOWLEDGE: verification reads only recordHash/deploymentId/seq; the org key
  is never needed and nothing is decrypted here.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { NotarizationAnchor } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { session, isLeadOrAdmin } from '$lib/store';
  import { api } from '$lib/api';
  import { verifyAnchor, type VerifyResult } from '$lib/archive';
  import { Icon, Badge, EmptyState } from '$lib/ui';

  let anchors = $state<NotarizationAnchor[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let creating = $state(false);
  let createError = $state<string | null>(null);
  let createdNotice = $state(false);

  // Per-anchor verification state (keyed by anchor id).
  let verifyingId = $state<string | null>(null);
  let results = $state<Record<string, VerifyResult>>({});
  let verifyError = $state<string | null>(null);
  let copiedId = $state<string | null>(null);

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    if (!$isLeadOrAdmin) {
      await goto('/');
      return;
    }
    await refresh();
  });

  async function refresh(): Promise<void> {
    loadError = null;
    loading = true;
    try {
      const res = await api.listAnchors();
      anchors = res.anchors;
    } catch {
      loadError = $t('archive.loadFailed');
    } finally {
      loading = false;
    }
  }

  async function onCreate(): Promise<void> {
    creating = true;
    createError = null;
    createdNotice = false;
    try {
      await api.createAnchor();
      createdNotice = true;
      await refresh();
    } catch {
      createError = $t('archive.createFailed');
    } finally {
      creating = false;
    }
  }

  async function onVerify(anchor: NotarizationAnchor): Promise<void> {
    verifyingId = anchor.id;
    verifyError = null;
    try {
      results = { ...results, [anchor.id]: await verifyAnchor(anchor) };
    } catch {
      verifyError = $t('archive.verifyFailed');
    } finally {
      verifyingId = null;
    }
  }

  async function copyRoot(anchor: NotarizationAnchor): Promise<void> {
    try {
      await navigator.clipboard.writeText(anchor.merkleRoot);
      copiedId = anchor.id;
    } catch {
      copiedId = null;
    }
  }

  function shortRoot(root: string): string {
    return root.length > 24 ? `${root.slice(0, 14)}…${root.slice(-8)}` : root;
  }

  /** True when a mismatch is explained by NEW records appended after the anchor. */
  function hasNewerRecords(a: NotarizationAnchor, r: VerifyResult): boolean {
    return !r.ok && r.recomputedCount > a.recordCount;
  }
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="shield-check" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('archive.title')}</h1>
    </div>
    <p class="text-muted">{$t('archive.subtitle')}</p>
  </header>

  <!-- In-page admin nav. -->
  <nav class="flex flex-wrap gap-2">
    <a class="btn-ghost px-3 text-sm" href="/admin/users/">
      <Icon name="users" size={18} />{$t('nav.users')}
    </a>
    <a class="btn-ghost px-3 text-sm" href="/admin/audit/">
      <Icon name="file-text" size={18} />{$t('nav.audit')}
    </a>
    <a class="btn-ghost px-3 text-sm" href="/admin/recovery/">
      <Icon name="shield" size={18} />{$t('nav.recovery')}
    </a>
  </nav>

  {#if !$isLeadOrAdmin}
    <p class="field-error">{$t('archive.forbidden')}</p>
  {:else}
    <!-- What it proves + limits -->
    <section class="card space-y-3">
      <h2 class="text-lg font-semibold text-fg">{$t('archive.whatTitle')}</h2>
      <p class="text-sm text-muted">{$t('archive.whatIntro')}</p>
      <ul class="space-y-2">
        <li class="flex gap-2 text-sm text-fg">
          <span class="shrink-0 text-ok"><Icon name="check" size={18} /></span>
          <span>{$t('archive.proof1')}</span>
        </li>
        <li class="flex gap-2 text-sm text-fg">
          <span class="shrink-0 text-ok"><Icon name="check" size={18} /></span>
          <span>{$t('archive.proof2')}</span>
        </li>
        <li class="flex gap-2 text-sm text-fg">
          <span class="shrink-0 text-ok"><Icon name="check" size={18} /></span>
          <span>{$t('archive.proof3')}</span>
        </li>
      </ul>
      <div class="rounded-xl border border-line bg-surface-2 p-4">
        <p class="mb-1 text-sm font-medium text-fg">{$t('archive.limitsTitle')}</p>
        <ul class="space-y-1.5">
          <li class="flex gap-2 text-sm text-muted">
            <span class="shrink-0 text-warning"><Icon name="alert" size={16} /></span>
            <span>{$t('archive.limit1')}</span>
          </li>
          <li class="flex gap-2 text-sm text-muted">
            <span class="shrink-0 text-warning"><Icon name="alert" size={16} /></span>
            <span>{$t('archive.limit2')}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- Create -->
    <section class="card space-y-3">
      <h2 class="text-lg font-semibold text-fg">{$t('archive.createTitle')}</h2>
      <p class="text-sm text-muted">{$t('archive.createHint')}</p>
      {#if createError}
        <p class="field-error" role="alert">{createError}</p>
      {/if}
      {#if createdNotice}
        <div class="flex items-center gap-2 rounded-xl border border-line bg-ok-soft/40 p-3">
          <span class="text-ok"><Icon name="check" size={18} /></span>
          <p class="text-sm text-fg">{$t('archive.created')}</p>
        </div>
      {/if}
      <button type="button" class="btn-primary" onclick={onCreate} disabled={creating}>
        {#if !creating}<Icon name="shield-check" size={18} />{/if}
        {creating ? $t('archive.creating') : $t('archive.create')}
      </button>
    </section>

    <!-- List -->
    <section class="space-y-4">
      <h2 class="text-lg font-semibold text-fg">{$t('archive.listTitle')}</h2>

      {#if loadError}
        <p class="field-error" role="alert">{loadError}</p>
      {/if}
      {#if verifyError}
        <p class="field-error" role="alert">{verifyError}</p>
      {/if}

      {#if loading}
        <p class="text-sm text-muted">{$t('common.loading')}</p>
      {:else if anchors.length === 0}
        <EmptyState icon="shield-check" title={$t('archive.empty')} />
      {:else}
        <ul class="space-y-3">
          {#each anchors as anchor (anchor.id)}
            {@const result = results[anchor.id]}
            <li class="card space-y-3">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="field-label">{$t('archive.root')}</span>
                    <code class="font-mono text-xs text-fg">{shortRoot(anchor.merkleRoot)}</code>
                    <button
                      type="button"
                      class="btn-ghost px-2 py-1 text-xs"
                      onclick={() => copyRoot(anchor)}
                    >
                      <Icon name={copiedId === anchor.id ? 'check' : 'copy'} size={14} />
                    </button>
                  </div>
                  <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
                    <span>
                      <span class="text-subtle">{$t('archive.recordCount')}:</span>
                      {anchor.recordCount}
                    </span>
                    <span>
                      <span class="text-subtle">{$t('archive.createdAt')}:</span>
                      {new Date(anchor.createdAt).toLocaleString('de-DE')}
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-2 pt-0.5">
                    {#if anchor.tsaTokenPresent && anchor.tsaTime}
                      <Badge tone="ok">
                        <Icon name="clock" size={14} />
                        {$t('archive.tsaTime')}: {new Date(anchor.tsaTime).toLocaleString('de-DE')}
                      </Badge>
                    {:else}
                      <Badge tone="muted">{$t('archive.noTsa')}</Badge>
                    {/if}
                    <Badge tone="brand">{$t('archive.serverSigned')}</Badge>
                  </div>
                </div>

                <button
                  type="button"
                  class="btn-secondary px-4 text-sm"
                  onclick={() => onVerify(anchor)}
                  disabled={verifyingId === anchor.id}
                >
                  <Icon name="shield-check" size={18} />
                  {verifyingId === anchor.id ? $t('archive.verifying') : $t('archive.verify')}
                </button>
              </div>

              {#if result}
                <div
                  class="rounded-xl border p-3 {result.ok
                    ? 'border-line bg-ok-soft/40'
                    : 'border-warning bg-warning-soft/40'}"
                >
                  <div class="flex items-center gap-2">
                    <span class={result.ok ? 'text-ok' : 'text-warning'}>
                      <Icon name={result.ok ? 'check' : 'alert'} size={18} />
                    </span>
                    <p class="text-sm font-medium {result.ok ? 'text-fg' : 'text-warning-fg'}">
                      {result.ok ? $t('archive.matchOk') : $t('archive.matchMismatch')}
                    </p>
                  </div>
                  {#if hasNewerRecords(anchor, result)}
                    <p class="mt-1.5 text-sm text-warning-fg">{$t('archive.newerRecords')}</p>
                  {/if}
                  <div class="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
                    <span>
                      <span class="text-subtle">{$t('archive.recomputedCount')}:</span>
                      {result.recomputedCount}
                    </span>
                    <span class="min-w-0">
                      <span class="text-subtle">{$t('archive.recomputedRoot')}:</span>
                      <code class="font-mono">{shortRoot(result.recomputedRoot)}</code>
                    </span>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</section>
