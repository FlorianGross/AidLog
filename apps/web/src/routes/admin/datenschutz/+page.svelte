<!--
  admin/datenschutz/+page.svelte — Datenschutz & Löschung (admin only).

  Four sections, all gated to admin:
   1. Aufbewahrungsfrist (retention) — view + edit org-wide retention in days,
      with a friendly years↔days helper; saved via api.setRetentionPolicy.
   2. Endgültige Löschung (Crypto-Shredding) — a "Vorschau" (dryRun) preview of
      how many records/keys WOULD be shredded under the policy OR for a single
      deployment (Art. 17), then a TYPED-confirmation, irreversible execute.
   3. Löschprotokoll (deletion log) — chronological tamper-evident audit.
   4. Auskunft Art. 15 (DSAR) + Verarbeitungsverzeichnis Art. 30 — both
      CLIENT-SIDE: DSAR decrypts a deployment locally with the org key; the
      Art. 30 document is templated from org info + system facts (no PII).

  SECURITY: the org password (DSAR only) is held transiently and wiped on
  destroy; nothing decrypted is persisted. The purge endpoints exchange only
  non-secret counts/ids. Crypto-shredding is IRREVERSIBLE — made explicit in the
  German copy + a typed confirmation gate.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import type { DeletionLogEntry, PurgeResponse, RetentionPolicy } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { session, isAdmin, orgInfo } from '$lib/store';
  import { api, ApiClientError } from '$lib/api';
  import { Icon, Badge, EmptyState } from '$lib/ui';
  import { downloadFile } from '$lib/analytics';
  import {
    yearsToDays,
    daysToYears,
    buildDsarExport,
    dsarToJson,
    buildRopa,
    ropaToJson,
    type RopaDocument,
  } from '$lib/privacy';

  const canManage = $derived($isAdmin);

  // --- retention ------------------------------------------------------------
  let policy = $state<RetentionPolicy | null>(null);
  let retentionDays = $state(3653); // ~10 years default suggestion
  let savingRetention = $state(false);
  let retentionMsg = $state<string | null>(null);
  let retentionErr = $state<string | null>(null);
  let loadError = $state<string | null>(null);

  const retentionYears = $derived(daysToYears(retentionDays));

  function onYearsInput(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    retentionDays = yearsToDays(v);
  }

  // --- purge ----------------------------------------------------------------
  let purgeDeploymentId = $state('');
  let dsarDeploymentId = $state('');
  let preview = $state<PurgeResponse | null>(null);
  let previewScope = $state<'policy' | 'deployment'>('policy');
  let previewing = $state(false);
  let purgeErr = $state<string | null>(null);
  let purgeMsg = $state<string | null>(null);
  let confirmWord = $state('');
  let executing = $state(false);

  // --- deletion log ---------------------------------------------------------
  let logEntries = $state<DeletionLogEntry[]>([]);

  // --- DSAR (Art. 15) -------------------------------------------------------
  let orgPassword = $state('');
  let dsarBusy = $state(false);
  let dsarMsg = $state<string | null>(null);
  let dsarErr = $state<string | null>(null);

  // --- Art. 30 --------------------------------------------------------------
  let ropa = $state<RopaDocument | null>(null);

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

  onDestroy(() => {
    orgPassword = '';
  });

  async function refresh(): Promise<void> {
    loadError = null;
    try {
      policy = await api.getRetentionPolicy();
      if (policy) retentionDays = policy.retentionDays;
      const log = await api.listDeletionLog();
      logEntries = log.entries;
    } catch {
      loadError = $t('privacy.loadFailed');
    }
  }

  async function saveRetention(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    retentionMsg = null;
    retentionErr = null;
    const days = Math.floor(retentionDays);
    if (!(Number.isInteger(days) && days > 0)) {
      retentionErr = $t('privacy.saveFailed');
      return;
    }
    savingRetention = true;
    try {
      policy = await api.setRetentionPolicy({ retentionDays: days });
      retentionDays = policy.retentionDays;
      retentionMsg = $t('privacy.saved');
    } catch {
      retentionErr = $t('privacy.saveFailed');
    } finally {
      savingRetention = false;
    }
  }

  async function runPreview(scope: 'policy' | 'deployment'): Promise<void> {
    purgeErr = null;
    purgeMsg = null;
    preview = null;
    confirmWord = '';
    previewScope = scope;
    if (scope === 'policy' && !policy) {
      purgeErr = $t('privacy.noPolicyForPurge');
      return;
    }
    if (scope === 'deployment' && !purgeDeploymentId.trim()) {
      purgeErr = $t('privacy.previewFailed');
      return;
    }
    previewing = true;
    try {
      preview = await api.purgeRetention({
        scope,
        dryRun: true,
        ...(scope === 'deployment' ? { deploymentId: purgeDeploymentId.trim() } : {}),
      });
    } catch (err) {
      purgeErr =
        err instanceof ApiClientError && err.status === 400
          ? $t('privacy.noPolicyForPurge')
          : $t('privacy.previewFailed');
    } finally {
      previewing = false;
    }
  }

  async function executePurge(): Promise<void> {
    if (!preview) return;
    purgeErr = null;
    purgeMsg = null;
    executing = true;
    try {
      const res = await api.purgeRetention({
        scope: previewScope,
        dryRun: false,
        ...(previewScope === 'deployment' ? { deploymentId: purgeDeploymentId.trim() } : {}),
      });
      purgeMsg = $t('privacy.executed', {
        records: res.recordsAffected,
        keys: res.sealedKeysDeleted,
      });
      preview = null;
      confirmWord = '';
      purgeDeploymentId = '';
      await refresh();
    } catch {
      purgeErr = $t('privacy.executeFailed');
    } finally {
      executing = false;
    }
  }

  function cancelPurge(): void {
    preview = null;
    confirmWord = '';
    purgeErr = null;
  }

  // --- DSAR -----------------------------------------------------------------
  async function runDsar(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    dsarMsg = null;
    dsarErr = null;
    if (!dsarDeploymentId.trim()) {
      dsarErr = $t('privacy.dsarFailed');
      return;
    }
    dsarBusy = true;
    try {
      const keyset = await api.getOrgKeyset();
      const exp = await buildDsarExport({
        keyset,
        orgPassword,
        deploymentId: dsarDeploymentId.trim(),
      });
      downloadFile(
        `${$t('privacy.dsarFilename')}-${exp.deploymentId}.json`,
        dsarToJson(exp),
        'application/json',
      );
      orgPassword = ''; // wipe immediately — no longer needed
      dsarMsg = $t('privacy.dsarDone', { records: exp.recordCount, skipped: exp.skipped });
    } catch (err) {
      if (err instanceof ApiClientError) {
        dsarErr = $t('privacy.dsarFailed');
      } else {
        // crypto-core throws on a wrong org password (AEAD auth failure).
        dsarErr = $t('privacy.wrongOrgPassword');
      }
    } finally {
      dsarBusy = false;
    }
  }

  // --- Art. 30 --------------------------------------------------------------
  function generateRopa(): void {
    ropa = buildRopa({
      orgName: $orgInfo?.orgName ?? '—',
      retentionDays: policy?.retentionDays ?? null,
    });
  }

  function downloadRopa(): void {
    if (!ropa) return;
    downloadFile(`${$t('privacy.ropaFilename')}.json`, ropaToJson(ropa), 'application/json');
  }

  function printRopa(): void {
    window.print();
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleString('de-DE');
  }
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="shield" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('privacy.title')}</h1>
    </div>
    <p class="text-muted">{$t('privacy.subtitle')}</p>
  </header>

  <!-- In-page admin nav (the shell drawer is owned elsewhere). -->
  <nav class="flex flex-wrap gap-2 print:hidden">
    <a class="btn-ghost px-3 text-sm" href="/admin/users/">
      <Icon name="users" size={18} />{$t('nav.users')}
    </a>
    <a class="btn-ghost px-3 text-sm" href="/admin/audit/">
      <Icon name="file-text" size={18} />{$t('nav.audit')}
    </a>
  </nav>

  {#if !canManage}
    <p class="field-error">{$t('privacy.forbidden')}</p>
  {:else}
    {#if loadError}
      <p class="field-error" role="alert">{loadError}</p>
    {/if}

    <!-- What crypto-shredding means -->
    <section class="card space-y-2 print:hidden">
      <h2 class="text-lg font-semibold text-fg">{$t('privacy.explainTitle')}</h2>
      <p class="text-sm text-muted">{$t('privacy.explainBody')}</p>
      <p class="text-sm text-warning-fg">{$t('privacy.backupCaveat')}</p>
    </section>

    <!-- 1. Retention -->
    <section class="card space-y-4 print:hidden">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-fg">{$t('privacy.retentionTitle')}</h2>
        <p class="text-sm text-muted">{$t('privacy.retentionIntro')}</p>
      </div>

      {#if policy}
        <div class="flex flex-wrap items-center gap-2">
          <Badge tone="ok">{$t('privacy.scopePolicy')}</Badge>
          <span class="text-sm text-muted">
            {$t('privacy.retentionCurrent', {
              days: policy.retentionDays,
              years: daysToYears(policy.retentionDays),
            })}
          </span>
          <span class="text-sm text-subtle">
            · {$t('privacy.retentionUpdatedAt', { date: fmtDate(policy.updatedAt) })}
          </span>
        </div>
      {:else}
        <p class="text-sm text-warning">{$t('privacy.retentionNotConfigured')}</p>
      {/if}

      <form class="grid grid-cols-2 gap-3" onsubmit={saveRetention}>
        <div>
          <label class="field-label" for="ret-days">{$t('privacy.retentionDaysLabel')}</label>
          <input
            id="ret-days"
            class="field-input"
            type="number"
            min="1"
            bind:value={retentionDays}
          />
          <p class="mt-1 text-xs text-subtle">{$t('privacy.retentionDaysHint')}</p>
        </div>
        <div>
          <label class="field-label" for="ret-years">{$t('privacy.retentionYearsLabel')}</label>
          <input
            id="ret-years"
            class="field-input"
            type="number"
            min="0"
            step="0.1"
            value={retentionYears}
            oninput={onYearsInput}
          />
        </div>

        {#if retentionErr}
          <p class="field-error col-span-2" role="alert">{retentionErr}</p>
        {/if}
        {#if retentionMsg}
          <p class="col-span-2 text-sm text-ok">{retentionMsg}</p>
        {/if}

        <div class="col-span-2">
          <button type="submit" class="btn-primary" disabled={savingRetention}>
            <Icon name="check" size={18} />{$t('privacy.save')}
          </button>
        </div>
      </form>
    </section>

    <!-- 2. Purge (crypto-shredding) -->
    <section class="card space-y-5 print:hidden">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-fg">{$t('privacy.purgeTitle')}</h2>
      </div>

      <div class="flex gap-3 rounded-xl border border-danger bg-danger-soft/30 p-4">
        <span class="shrink-0 text-danger"><Icon name="alert" size={20} /></span>
        <p class="text-sm text-danger-fg">{$t('privacy.irreversibleWarning')}</p>
      </div>

      <!-- Policy scope -->
      <div class="space-y-2 rounded-xl border border-line p-4">
        <h3 class="font-medium text-fg">{$t('privacy.purgePolicyTitle')}</h3>
        <p class="text-sm text-muted">{$t('privacy.purgePolicyIntro')}</p>
        <button
          type="button"
          class="btn-secondary px-4 text-sm"
          disabled={previewing}
          onclick={() => runPreview('policy')}
        >
          <Icon name="search" size={18} />{$t('privacy.preview')}
        </button>
      </div>

      <!-- Deployment scope (Art. 17) -->
      <div class="space-y-2 rounded-xl border border-line p-4">
        <h3 class="font-medium text-fg">{$t('privacy.purgeDeploymentTitle')}</h3>
        <p class="text-sm text-muted">{$t('privacy.purgeDeploymentIntro')}</p>
        <label class="field-label" for="purge-dep">{$t('privacy.deploymentIdLabel')}</label>
        <input
          id="purge-dep"
          class="field-input"
          placeholder={$t('privacy.deploymentIdPlaceholder')}
          bind:value={purgeDeploymentId}
        />
        <button
          type="button"
          class="btn-secondary px-4 text-sm"
          disabled={previewing || !purgeDeploymentId.trim()}
          onclick={() => runPreview('deployment')}
        >
          <Icon name="search" size={18} />{$t('privacy.preview')}
        </button>
      </div>

      {#if purgeErr}
        <p class="field-error" role="alert">{purgeErr}</p>
      {/if}
      {#if purgeMsg}
        <p class="text-sm text-ok">{purgeMsg}</p>
      {/if}

      <!-- Preview result + typed confirmation -->
      {#if preview}
        <div class="space-y-3 rounded-xl border border-warning bg-warning-soft/30 p-4">
          {#if preview.recordsAffected === 0}
            <p class="text-sm text-muted">{$t('privacy.previewNone')}</p>
          {:else}
            <p class="text-sm font-medium text-fg">
              {$t('privacy.previewResult', {
                records: preview.recordsAffected,
                keys: preview.sealedKeysDeleted,
                deployments: preview.deploymentsAffected,
              })}
            </p>
            {#if preview.cutoff}
              <p class="text-xs text-subtle">
                {$t('privacy.previewCutoff', { date: fmtDate(preview.cutoff) })}
              </p>
            {/if}
            <p class="text-sm text-danger-fg">{$t('privacy.irreversibleWarning')}</p>

            <div>
              <label class="field-label" for="confirm-word">
                {$t('privacy.confirmIntro', { word: $t('privacy.confirmWord') })}
              </label>
              <input
                id="confirm-word"
                class="field-input"
                autocomplete="off"
                placeholder={$t('privacy.confirmPlaceholder')}
                bind:value={confirmWord}
              />
            </div>

            <div class="flex gap-2">
              <button
                type="button"
                class="btn-primary px-4 text-sm"
                disabled={executing || confirmWord.trim() !== $t('privacy.confirmWord')}
                onclick={executePurge}
              >
                <Icon name="trash" size={18} />
                {executing ? $t('privacy.executing') : $t('privacy.execute')}
              </button>
              <button type="button" class="btn-ghost px-4 text-sm" onclick={cancelPurge}>
                {$t('privacy.cancel')}
              </button>
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- 3. Deletion log -->
    <section class="card space-y-3 print:hidden">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-fg">{$t('privacy.logTitle')}</h2>
        <p class="text-sm text-muted">{$t('privacy.logIntro')}</p>
      </div>
      {#if logEntries.length === 0}
        <EmptyState icon="file-text" title={$t('privacy.logEmpty')} />
      {:else}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-line text-left text-subtle">
                <th class="py-2 pr-3 font-medium">{$t('privacy.logColAt')}</th>
                <th class="py-2 pr-3 font-medium">{$t('privacy.logColScope')}</th>
                <th class="py-2 pr-3 font-medium">{$t('privacy.logColDeployment')}</th>
                <th class="py-2 pr-3 font-medium">{$t('privacy.logColRecords')}</th>
                <th class="py-2 pr-3 font-medium">{$t('privacy.logColKeys')}</th>
                <th class="py-2 pr-3 font-medium">{$t('privacy.logColCutoff')}</th>
                <th class="py-2 font-medium">{$t('privacy.logColBy')}</th>
              </tr>
            </thead>
            <tbody>
              {#each logEntries as e (e.id)}
                <tr class="border-b border-line/60">
                  <td class="py-2 pr-3 text-muted">{fmtDate(e.executedAt)}</td>
                  <td class="py-2 pr-3">
                    {e.scope === 'policy'
                      ? $t('privacy.scopePolicy')
                      : $t('privacy.scopeDeployment')}
                  </td>
                  <td class="py-2 pr-3 font-mono text-xs text-subtle">{e.deploymentId ?? '—'}</td>
                  <td class="py-2 pr-3">{e.recordsAffected}</td>
                  <td class="py-2 pr-3">{e.sealedKeysDeleted}</td>
                  <td class="py-2 pr-3 text-xs text-subtle">
                    {e.cutoff ? fmtDate(e.cutoff) : '—'}
                  </td>
                  <td class="py-2 font-mono text-xs text-subtle">{e.executedByKeyId}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <!-- 4a. DSAR (Art. 15) -->
    <section class="card space-y-4 print:hidden">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-fg">{$t('privacy.dsarTitle')}</h2>
        <p class="text-sm text-muted">{$t('privacy.dsarIntro')}</p>
      </div>
      <form class="space-y-4" onsubmit={runDsar}>
        <div>
          <label class="field-label" for="dsar-dep">{$t('privacy.dsarDeploymentLabel')}</label>
          <input
            id="dsar-dep"
            class="field-input"
            placeholder={$t('privacy.deploymentIdPlaceholder')}
            bind:value={dsarDeploymentId}
          />
        </div>
        <div>
          <label class="field-label" for="dsar-pw">{$t('privacy.orgPassword')}</label>
          <input
            id="dsar-pw"
            class="field-input"
            type="password"
            autocomplete="off"
            bind:value={orgPassword}
            required
          />
          <p class="mt-1 text-xs text-subtle">{$t('privacy.orgPasswordHint')}</p>
        </div>

        {#if dsarErr}
          <p class="field-error" role="alert">{dsarErr}</p>
        {/if}
        {#if dsarMsg}
          <p class="text-sm text-ok">{dsarMsg}</p>
        {/if}

        <button
          type="submit"
          class="btn-primary"
          disabled={dsarBusy || !orgPassword || !dsarDeploymentId.trim()}
        >
          <Icon name="download" size={18} />
          {dsarBusy ? $t('privacy.dsarRunning') : $t('privacy.dsarExport')}
        </button>
      </form>
    </section>

    <!-- 4b. Verarbeitungsverzeichnis (Art. 30) -->
    <section class="card space-y-4">
      <div class="space-y-1 print:hidden">
        <h2 class="text-lg font-semibold text-fg">{$t('privacy.ropaTitle')}</h2>
        <p class="text-sm text-muted">{$t('privacy.ropaIntro')}</p>
      </div>

      <div class="flex flex-wrap gap-2 print:hidden">
        <button type="button" class="btn-secondary px-4 text-sm" onclick={generateRopa}>
          <Icon name="file-text" size={18} />{$t('privacy.ropaGenerate')}
        </button>
        {#if ropa}
          <button type="button" class="btn-secondary px-4 text-sm" onclick={downloadRopa}>
            <Icon name="download" size={18} />{$t('privacy.ropaDownload')}
          </button>
          <button type="button" class="btn-ghost px-4 text-sm" onclick={printRopa}>
            <Icon name="file-text" size={18} />{$t('privacy.ropaPrint')}
          </button>
        {/if}
      </div>

      {#if ropa}
        <article class="space-y-5">
          <header class="space-y-1">
            <h3 class="text-xl font-semibold text-fg">{ropa.title}</h3>
            <p class="text-sm text-muted">{ropa.orgName}</p>
            <p class="text-xs text-subtle">
              {$t('privacy.ropaGeneratedAt', { date: fmtDate(ropa.generatedAt) })}
            </p>
          </header>
          {#each ropa.sections as sec (sec.title)}
            <div class="space-y-1">
              <h4 class="font-semibold text-fg">{sec.title}</h4>
              <ul class="list-disc space-y-1 pl-5 text-sm text-muted">
                {#each sec.items as item (item)}
                  <li>{item}</li>
                {/each}
              </ul>
            </div>
          {/each}
        </article>
      {/if}
    </section>
  {/if}
</section>
