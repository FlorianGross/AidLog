<!--
  deployment/[id]/verlauf/+page.svelte — change history + integrity (Verlauf).

  Append-only model: each correction appends a NEW ProtocolRecord with
  `supersedes` set. This page reconstructs the full version history of a
  deployment from its cached record chain:
    - lists every version in chain order (seq), newest grouping on top,
    - marks superseded records as historical and the latest as current,
    - for each correction shows a field-level DIFF (old → new) mapped to schema
      labels, with author (resolved keyId → short id) + timestamps,
    - runs the cryptographic integrity check (crypto.verifyRecord) so anyone can
      confirm the log is untampered.

  Records are decrypted LOCALLY in memory with the viewer's own identity (the
  same identity that can already read these records). Nothing is sent anywhere.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { Icon, Badge, EmptyState, Spinner } from '$lib/ui';
  import { getSession } from '$lib/crypto';
  import { getDeployment, getDeploymentRecords, type DeploymentMeta } from '$lib/store';
  import { activeSchema, loadActiveSchema } from '$lib/schemas/store';
  import type { DocSchema } from '$lib/schemas/types';
  import type { ProtocolRecord } from '@aidlog/contracts';
  import {
    decryptEntries,
    buildCorrectionDiffs,
    supersededIds,
    shortKeyId,
    DiffView,
    IntegrityPanel,
    type DecryptedEntry,
    type CorrectionDiff,
  } from '$lib/history';

  const deploymentId = $derived($page.params.id ?? '');
  const schema = $derived<DocSchema>($activeSchema);

  let meta = $state<DeploymentMeta | undefined>(undefined);
  let records = $state<ProtocolRecord[]>([]);
  let entries = $state<DecryptedEntry[]>([]);
  let diffs = $state<Map<string, CorrectionDiff>>(new Map());
  let superseded = $state<Set<string>>(new Set());
  let loading = $state(true);

  // own keyId, to mark "this entry was authored by me".
  const ownKeyId = $derived(getSession()?.publicIdentity.keyId ?? '');

  onMount(async () => {
    const s = getSession();
    if (!s) {
      await goto('/login/');
      return;
    }
    void loadActiveSchema();
    meta = await getDeployment(deploymentId);
    records = await getDeploymentRecords(deploymentId);
    superseded = supersededIds(records);
    entries = await decryptEntries(records, s.identity);
    diffs = buildCorrectionDiffs(entries, schema);
    loading = false;
  });

  function authorLabel(keyId: string): string {
    return keyId === ownKeyId ? `${shortKeyId(keyId)} · ich` : shortKeyId(keyId);
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
  <header
    class="sticky top-0 z-20 -mx-4 flex flex-col gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur"
  >
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold text-fg">{$t('verlauf.title')}</h1>
        <p class="truncate text-sm text-muted">{meta?.title ?? ''} · {$t('verlauf.subtitle')}</p>
      </div>
      <a href={`/deployment/${deploymentId}/`} class="btn-secondary px-3 text-sm">
        <Icon name="arrow-left" size={18} />
        {$t('common.back')}
      </a>
    </div>
  </header>

  {#if loading}
    <p class="flex items-center gap-2 text-sm text-muted">
      <Spinner size={16} />
      {$t('common.loading')}
    </p>
  {:else if records.length === 0}
    <EmptyState icon="clock" title={$t('verlauf.empty')} description={$t('verlauf.emptyHint')} />
  {:else}
    <!-- Integrity check first: the trust anchor for everything below. -->
    <div class="card">
      <IntegrityPanel {records} />
    </div>

    <!-- Version list (chain order). Newest at the bottom of the chain is current. -->
    <div class="card">
      <h2 class="mb-1 text-lg font-semibold text-fg">{$t('verlauf.versions')}</h2>
      <p class="mb-4 text-sm text-muted">{records.length} · {$t('doc.finalized')}</p>

      <ol class="space-y-4">
        {#each entries as entry (entry.record.id)}
          {@const rec = entry.record}
          {@const isSuperseded = superseded.has(rec.id)}
          {@const corr = diffs.get(rec.id)}
          <li class="relative border-l-2 border-line pl-4">
            <span
              class={`absolute -left-[7px] top-1 h-3 w-3 rounded-full ${
                isSuperseded ? 'bg-surface-3' : 'bg-brand'
              }`}
              aria-hidden="true"
            ></span>

            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-sm font-semibold text-fg">#{rec.seq}</span>
              <span class="text-sm text-muted">{$t('verlauf.version')}</span>
              {#if rec.supersedes}
                <Badge tone="warning">{$t('verlauf.correction')}</Badge>
              {/if}
              {#if isSuperseded}
                <Badge tone="muted">{$t('verlauf.supersededBy')}</Badge>
              {:else}
                <Badge tone="ok">{$t('verlauf.current')}</Badge>
              {/if}
            </div>

            <dl class="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div>
                <dt class="inline text-subtle">{$t('verlauf.author')}:</dt>
                <dd class="inline font-mono text-fg">{authorLabel(rec.authorKeyId)}</dd>
              </div>
              <div>
                <dt class="inline text-subtle">{$t('verlauf.createdAt')}:</dt>
                <dd class="inline text-fg">{fmt(rec.createdAt)}</dd>
              </div>
            </dl>

            {#if entry.undecryptable}
              <p class="mt-2 text-sm text-warning-fg">{$t('verlauf.cannotDecrypt')}</p>
            {:else if corr}
              <div class="mt-3 rounded-xl border border-line bg-surface-2 p-3">
                <DiffView diffs={corr.diffs} />
              </div>
            {/if}
          </li>
        {/each}
      </ol>
    </div>
  {/if}
</section>
