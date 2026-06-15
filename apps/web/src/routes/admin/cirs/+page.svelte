<!--
  admin/cirs/+page.svelte — CIRS review/triage (QM/admin only).

  Mirrors the admin "Auswertung" org-unlock UX: the admin enters the ORG password,
  the org key is briefly unwrapped IN MEMORY, every CIRS report is fetched and
  decrypted LOCALLY (org-sealed DEK → AEAD payload), and the QM can set each
  report's workflow status (neu / in_bearbeitung / abgeschlossen). Nothing
  decrypted is persisted; the org password + secret live only for the run.

  Reports carry NO reporter attribution — decryption reveals only the free-form
  content, never who submitted it.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { session, isAdmin } from '$lib/store';
  import { api, ApiClientError } from '$lib/api';
  import { Icon, Badge, EmptyState, Spinner } from '$lib/ui';
  import { decryptCirsReports, type DecryptedCirsReport } from '$lib/cirs';
  import { CIRS_STATUSES, type CirsStatus } from '@aidlog/contracts';

  // Security-sensitive: held only transiently for one decrypt run.
  let orgPassword = $state('');
  let busy = $state(false);
  let formError = $state<string | null>(null);

  let reports = $state<DecryptedCirsReport[] | null>(null);
  let actionError = $state<string | null>(null);
  let statusMsg = $state<string | null>(null);

  const canManage = $derived($isAdmin);

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    if (!$isAdmin) {
      await goto('/');
    }
  });

  onDestroy(() => wipeSecrets());

  function wipeSecrets(): void {
    orgPassword = '';
  }

  function statusTone(s: CirsStatus): 'muted' | 'warning' | 'ok' {
    if (s === 'abgeschlossen') return 'ok';
    if (s === 'in_bearbeitung') return 'warning';
    return 'muted';
  }

  async function onUnlock(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    formError = null;
    busy = true;
    reports = null;
    try {
      const keyset = await api.getOrgKeyset();
      const list = await api.listCirs();
      const decrypted = await decryptCirsReports(keyset, orgPassword, list.reports);
      reports = decrypted;
      orgPassword = ''; // no longer needed — wipe immediately
    } catch (err) {
      if (err instanceof ApiClientError) {
        formError = err.status === 403 ? $t('cirs.review.forbidden') : $t('cirs.review.loadFailed');
      } else {
        // crypto-core throws on a wrong org password (AEAD auth failure).
        formError = $t('cirs.review.wrongOrgPassword');
      }
    } finally {
      busy = false;
    }
  }

  async function setStatus(report: DecryptedCirsReport, status: CirsStatus): Promise<void> {
    actionError = null;
    statusMsg = null;
    try {
      await api.setCirsStatus(report.id, { status });
      report.status = status;
      // Reassign to trigger reactivity on the array item.
      reports = reports ? [...reports] : reports;
      statusMsg = $t('cirs.review.statusUpdated');
    } catch {
      actionError = $t('cirs.review.statusUpdateFailed');
    }
  }

  function lock(): void {
    reports = null;
    wipeSecrets();
  }
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="shield-check" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('cirs.review.title')}</h1>
    </div>
    <p class="text-muted">{$t('cirs.review.subtitle')}</p>
  </header>

  {#if !canManage}
    <p class="field-error">{$t('cirs.review.forbidden')}</p>
  {:else if !reports}
    <!-- Org-key unlock form -->
    <section class="card space-y-5">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold text-fg">{$t('cirs.review.unlockTitle')}</h2>
        <p class="text-sm text-muted">{$t('cirs.review.unlockIntro')}</p>
      </div>

      <form class="space-y-5" onsubmit={onUnlock}>
        <div>
          <label class="field-label" for="org-pw">{$t('cirs.review.orgPassword')}</label>
          <input
            id="org-pw"
            class="field-input"
            type="password"
            autocomplete="off"
            bind:value={orgPassword}
            required
          />
          <p class="mt-1 text-xs text-subtle">{$t('cirs.review.orgPasswordHint')}</p>
        </div>

        {#if formError}
          <p class="field-error" role="alert">{formError}</p>
        {/if}

        {#if busy}
          <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
            <Spinner />
            <p class="text-sm font-medium text-fg">{$t('cirs.review.unlocking')}</p>
          </div>
        {/if}

        <button type="submit" class="btn-primary w-full" disabled={busy || !orgPassword}>
          {#if !busy}<Icon name="lock" size={18} />{/if}
          {busy ? $t('cirs.review.unlocking') : $t('cirs.review.unlock')}
        </button>
      </form>
    </section>
  {:else}
    <div class="flex flex-wrap items-center justify-between gap-2">
      <Badge tone="ok">{$t('cirs.anonymityTitle')}</Badge>
      <button type="button" class="btn-ghost px-4 text-sm" onclick={lock}>
        <Icon name="lock" size={18} />{$t('cirs.review.reset')}
      </button>
    </div>

    {#if statusMsg}
      <p class="text-sm text-ok" role="status">{statusMsg}</p>
    {/if}
    {#if actionError}
      <p class="field-error" role="alert">{actionError}</p>
    {/if}

    {#if reports.length === 0}
      <EmptyState icon="alert" title={$t('cirs.review.empty')} />
    {:else}
      <ul class="space-y-4">
        {#each reports as report (report.id)}
          <li class="card space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm text-subtle">
                {$t('cirs.review.reportedOn')}: {report.createdAt}
              </span>
              <Badge tone={statusTone(report.status)}>
                {$t(`cirs.status.${report.status}`)}
              </Badge>
            </div>

            {#if report.content === null}
              <p class="field-error">{$t('cirs.review.decryptFailed')}</p>
            {:else}
              <dl class="space-y-3 text-sm">
                {#if report.content.ereignis}
                  <div>
                    <dt class="field-label">{$t('cirs.fieldEreignis')}</dt>
                    <dd class="whitespace-pre-wrap text-fg">{report.content.ereignis}</dd>
                  </div>
                {/if}
                {#if report.content.kontext}
                  <div>
                    <dt class="field-label">{$t('cirs.fieldKontext')}</dt>
                    <dd class="whitespace-pre-wrap text-fg">{report.content.kontext}</dd>
                  </div>
                {/if}
                {#if report.content.faktoren}
                  <div>
                    <dt class="field-label">{$t('cirs.fieldFaktoren')}</dt>
                    <dd class="whitespace-pre-wrap text-fg">{report.content.faktoren}</dd>
                  </div>
                {/if}
                {#if report.content.folgen}
                  <div>
                    <dt class="field-label">{$t('cirs.fieldFolgen')}</dt>
                    <dd class="whitespace-pre-wrap text-fg">{report.content.folgen}</dd>
                  </div>
                {/if}
                {#if report.content.vorschlag}
                  <div>
                    <dt class="field-label">{$t('cirs.fieldVorschlag')}</dt>
                    <dd class="whitespace-pre-wrap text-fg">{report.content.vorschlag}</dd>
                  </div>
                {/if}
                {#if report.content.zeitraum}
                  <div>
                    <dt class="field-label">{$t('cirs.fieldZeitraum')}</dt>
                    <dd class="whitespace-pre-wrap text-fg">{report.content.zeitraum}</dd>
                  </div>
                {/if}
              </dl>
            {/if}

            <div class="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span class="text-sm text-muted">{$t('cirs.review.updateStatus')}:</span>
              {#each CIRS_STATUSES as s (s)}
                <button
                  type="button"
                  class="px-3 text-sm {report.status === s ? 'btn-primary' : 'btn-secondary'}"
                  disabled={report.status === s}
                  onclick={() => setStatus(report, s)}
                >
                  {$t(`cirs.status.${s}`)}
                </button>
              {/each}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>
