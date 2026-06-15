<!--
  admin/recovery/+page.svelte — configure organisation-key recovery (Shamir).

  The admin enters the ORG password (separate from their personal login), a
  share count N and threshold T, and N trustee labels. The org key is briefly
  unwrapped in memory, split into N encoded shares (>= T reconstruct it), and
  the encoded shares are shown in printable/copyable cards to hand out.

  SECURITY: the org password, the org secret, and the shares live ONLY in this
  component's state during the operation and are wiped when leaving the page
  (onDestroy) — never logged, never persisted, never sent to the server. Only
  metadata (T/N, labels, orgKeyCheck) is POSTed.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import type { RecoveryConfig } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { session, isAdmin } from '$lib/store';
  import { api } from '$lib/api';
  import { configureRecovery, type IssuedShare } from '$lib/recovery';
  import { Icon, Badge, EmptyState } from '$lib/ui';

  let config = $state<RecoveryConfig | null>(null);
  let loadError = $state<string | null>(null);

  // Form state (security-sensitive password held here, only transiently).
  let orgPassword = $state('');
  let shareCount = $state(5);
  let threshold = $state(3);
  let trusteeLabels = $state<string[]>(['', '', '', '', '']);
  let busy = $state(false);
  let formError = $state<string | null>(null);

  // Issued shares (security-sensitive: encoded shares held in memory only).
  let issued = $state<IssuedShare[]>([]);
  let orgKeyCheck = $state<string | null>(null);
  let handedOut = $state(false); // copied or printed at least once
  let copiedIdx = $state<number | null>(null);

  const canManage = $derived($isAdmin);

  // Keep the trustee-label array length in sync with N (2..255).
  $effect(() => {
    const n = Math.max(2, Math.min(255, Math.floor(shareCount) || 2));
    if (trusteeLabels.length !== n) {
      const next = trusteeLabels.slice(0, n);
      while (next.length < n) next.push('');
      trusteeLabels = next;
    }
  });

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    if (!$isAdmin) {
      await goto('/');
      return;
    }
    await refresh();
  });

  // Wipe any in-memory secrets when the page is left.
  onDestroy(() => wipeSecrets());

  function wipeSecrets(): void {
    orgPassword = '';
    issued = [];
    orgKeyCheck = null;
  }

  // Warn before unload if shares were generated but not yet handed out.
  function beforeUnload(e: BeforeUnloadEvent): void {
    if (issued.length > 0 && !handedOut) {
      e.preventDefault();
      e.returnValue = '';
    }
  }

  async function refresh(): Promise<void> {
    loadError = null;
    try {
      config = await api.getRecoveryConfig();
    } catch {
      loadError = $t('recovery.loadKeysetFailed');
    }
  }

  function validate(): string | null {
    const n = Math.floor(shareCount);
    const tt = Math.floor(threshold);
    if (!(n >= 2 && n <= 255 && tt >= 2 && tt <= n)) return $t('recovery.invalidParams');
    if (trusteeLabels.some((l) => !l.trim())) return $t('recovery.invalidParams');
    return null;
  }

  async function onGenerate(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    formError = validate();
    if (formError) return;
    busy = true;
    handedOut = false;
    try {
      const keyset = await api.getOrgKeyset();
      const result = await configureRecovery({
        keyset,
        orgPassword,
        shareCount: Math.floor(shareCount),
        threshold: Math.floor(threshold),
        trusteeLabels: trusteeLabels.map((l) => l.trim()),
      });

      // Persist ONLY metadata (no share, no secret) to the server.
      await api.setRecoveryConfig({
        threshold: Math.floor(threshold),
        shareCount: Math.floor(shareCount),
        trustees: trusteeLabels.map((l) => ({ label: l.trim() })),
        orgKeyCheck: result.orgKeyCheck,
      });

      issued = result.shares;
      orgKeyCheck = result.orgKeyCheck;
      orgPassword = ''; // no longer needed — wipe immediately
      await refresh();
    } catch (err) {
      // crypto-core throws on a wrong org password (DecryptionError / AEAD fail).
      const msg = err instanceof Error ? err.name : '';
      formError =
        msg === 'ApiClientError' ? $t('recovery.configureFailed') : $t('recovery.wrongOrgPassword');
    } finally {
      busy = false;
    }
  }

  async function copyShare(s: IssuedShare, idx: number): Promise<void> {
    try {
      await navigator.clipboard.writeText(s.encoded);
      copiedIdx = idx;
      handedOut = true;
    } catch {
      copiedIdx = null;
    }
  }

  function doPrint(): void {
    handedOut = true;
    window.print();
  }

  function startOver(): void {
    wipeSecrets();
    handedOut = false;
  }
</script>

<svelte:window onbeforeunload={beforeUnload} />

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="shield" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('recovery.title')}</h1>
    </div>
    <p class="text-muted">{$t('recovery.subtitle')}</p>
  </header>

  <!-- In-page admin nav (the shell drawer is not editable here). -->
  <nav class="flex flex-wrap gap-2 print:hidden">
    <a class="btn-ghost px-3 text-sm" href="/admin/users/">
      <Icon name="users" size={18} />{$t('nav.users')}
    </a>
    <a class="btn-ghost px-3 text-sm" href="/admin/audit/">
      <Icon name="file-text" size={18} />{$t('nav.audit')}
    </a>
  </nav>

  {#if loadError}
    <p class="field-error" role="alert">{loadError}</p>
  {/if}

  <!-- Current status -->
  <section class="card space-y-3 print:hidden">
    <h2 class="text-lg font-semibold text-fg">{$t('recovery.statusTitle')}</h2>
    {#if config}
      <div class="flex flex-wrap items-center gap-2">
        <Badge tone="ok">{$t('recovery.configured')}</Badge>
        <span class="text-sm text-muted">
          {$t('recovery.thresholdOfShares', {
            threshold: config.threshold,
            shareCount: config.shareCount,
          })}
        </span>
        <span class="text-sm text-subtle"
          >· {$t('recovery.configuredOn', {
            date: new Date(config.createdAt).toLocaleString('de-DE'),
          })}</span
        >
      </div>
      {#if config.trustees.length > 0}
        <div>
          <span class="field-label">{$t('recovery.trustees')}</span>
          <ul class="flex flex-wrap gap-2">
            {#each config.trustees as tr (tr.id)}
              <li class="badge-muted">{tr.label}</li>
            {/each}
          </ul>
        </div>
      {/if}
    {:else}
      <div class="flex gap-3 rounded-xl border border-line bg-warning-soft/40 p-4">
        <span class="shrink-0 text-warning"><Icon name="alert" size={20} /></span>
        <div class="space-y-1">
          <p class="text-sm font-medium text-warning-fg">{$t('recovery.notConfigured')}</p>
          <p class="text-sm text-warning-fg">{$t('recovery.notConfiguredHint')}</p>
        </div>
      </div>
    {/if}
  </section>

  {#if !canManage}
    <p class="field-error">{$t('users.forbidden')}</p>
  {:else if issued.length === 0}
    <!-- Configure form -->
    <section class="card space-y-5 print:hidden">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-fg">
          {config ? $t('recovery.reconfigureTitle') : $t('recovery.configureTitle')}
        </h2>
        <p class="text-sm text-muted">{$t('recovery.intro')}</p>
        {#if config}
          <p class="text-sm text-warning">{$t('recovery.reconfigureHint')}</p>
        {/if}
      </div>

      <form class="space-y-5" onsubmit={onGenerate}>
        <div>
          <label class="field-label" for="org-pw">{$t('recovery.orgPassword')}</label>
          <input
            id="org-pw"
            class="field-input"
            type="password"
            autocomplete="off"
            bind:value={orgPassword}
            required
          />
          <p class="mt-1 text-xs text-subtle">{$t('recovery.orgPasswordHint')}</p>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="field-label" for="share-n">{$t('recovery.shareCount')}</label>
            <input
              id="share-n"
              class="field-input"
              type="number"
              min="2"
              max="255"
              bind:value={shareCount}
            />
          </div>
          <div>
            <label class="field-label" for="share-t">{$t('recovery.threshold')}</label>
            <input
              id="share-t"
              class="field-input"
              type="number"
              min="2"
              max={shareCount}
              bind:value={threshold}
            />
            <p class="mt-1 text-xs text-subtle">{$t('recovery.thresholdHint')}</p>
          </div>
        </div>

        <div class="space-y-2">
          <span class="field-label">{$t('recovery.trusteeLabels')}</span>
          {#each trusteeLabels as _label, i (i)}
            <div class="flex items-center gap-2">
              <span class="w-6 shrink-0 text-right text-sm text-subtle">{i + 1}.</span>
              <input
                class="field-input"
                placeholder={$t('recovery.trusteePlaceholder')}
                bind:value={trusteeLabels[i]}
                aria-label={$t('recovery.shareLabel', { position: i + 1, count: shareCount })}
              />
            </div>
          {/each}
        </div>

        {#if formError}
          <p class="field-error" role="alert">{formError}</p>
        {/if}

        <button type="submit" class="btn-primary w-full" disabled={busy || !orgPassword}>
          {#if !busy}<Icon name="shield-check" size={18} />{/if}
          {busy ? $t('recovery.generating') : $t('recovery.generate')}
        </button>
      </form>
    </section>
  {:else}
    <!-- Issued shares (printable / copyable) -->
    <section class="space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h2 class="text-lg font-semibold text-fg">{$t('recovery.sharesTitle')}</h2>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary px-4 text-sm" onclick={doPrint}>
            <Icon name="download" size={18} />{$t('recovery.print')}
          </button>
          <button type="button" class="btn-ghost px-4 text-sm" onclick={startOver}>
            {$t('common.close')}
          </button>
        </div>
      </div>

      <!-- Print-only header -->
      <div class="hidden print:block">
        <h2 class="text-xl font-semibold">{$t('recovery.printTitle')}</h2>
      </div>

      <div class="flex gap-3 rounded-xl border border-warning bg-warning-soft/40 p-4">
        <span class="shrink-0 text-warning"><Icon name="alert" size={20} /></span>
        <p class="text-sm text-warning-fg">{$t('recovery.sharesNotice')}</p>
      </div>

      <div class="grid gap-3">
        {#each issued as s, i (s.position)}
          <article
            class="card space-y-3 break-inside-avoid border-line-strong print:border print:shadow-none"
          >
            <div class="flex items-center justify-between gap-2">
              <div>
                <p class="font-semibold text-fg">
                  {$t('recovery.shareLabel', { position: s.position, count: issued.length })}
                </p>
                <p class="text-sm text-muted">{$t('recovery.shareFor', { label: s.label })}</p>
              </div>
              <button
                type="button"
                class="btn-secondary px-3 text-sm print:hidden"
                onclick={() => copyShare(s, i)}
                aria-label={$t('recovery.copyShare')}
              >
                <Icon name={copiedIdx === i ? 'check' : 'copy'} size={18} />
                {copiedIdx === i ? $t('recovery.copied') : $t('recovery.copyShare')}
              </button>
            </div>
            <code
              class="block w-full break-all rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-sm text-fg print:bg-transparent print:px-0"
            >
              {s.encoded}
            </code>
          </article>
        {/each}
      </div>

      <div class="flex gap-3 rounded-xl border border-line bg-surface-2 p-4 print:hidden">
        <span class="shrink-0 text-ok"><Icon name="check" size={20} /></span>
        <div class="space-y-1">
          <p class="text-sm font-medium text-fg">{$t('recovery.done')}</p>
          <p class="text-sm text-muted">{$t('recovery.doneHint')}</p>
        </div>
      </div>
    </section>
  {/if}
</section>
