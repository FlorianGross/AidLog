<!--
  deployment/[id]/tagebuch/+page.svelte — EINSATZTAGEBUCH (event journal).

  A per-deployment, chronological, signed+encrypted log of OPERATIONAL events of
  the whole Einsatz (Alarmierung, Lagemeldung, Nachforderung, Wetter/Umfeld,
  Material, Sonstiges) — NOT patient-specific.

  ADD (everyone): the form builds a REAL signed ProtocolRecord (marked
  `schemaId: 'event-journal'` / `__journal__: true`), sealed to org + helper +
  supervisors via the existing finalize path (saveJournalEntry).

  READ (lead + admin only): the timeline decrypts the deployment's journal
  records with the CALLER'S OWN supervisor-sealed DEK (no org password), exactly
  like the Einsatzstatistik page. Others see a clear "nur für Einsatzleitung"
  notice. Because entries are only sealed to org + supervisors, only entries
  created AFTER this feature shipped are readable (forward-only) — surfaced as a
  static hint. Decrypted data lives in memory only; nothing is persisted/logged.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { session, isLeadOrAdmin, getDeployment, type DeploymentMeta } from '$lib/store';
  import { ApiClientError } from '$lib/api';
  import { Icon, Badge, EmptyState, Spinner } from '$lib/ui';
  import {
    saveJournalEntry,
    loadJournal,
    JOURNAL_CATEGORY_VALUES,
    type JournalCategory,
    type JournalEntry,
    type JournalEntryInput,
  } from '$lib/journal';

  const deploymentId = $derived($page.params.id ?? '');

  let meta = $state<DeploymentMeta | undefined>(undefined);
  let entries = $state<JournalEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const canView = $derived($isLeadOrAdmin);

  // --- add-entry form -------------------------------------------------------
  function nowHHMM(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  let formTime = $state(nowHHMM());
  let formCategory = $state<JournalCategory>('lagemeldung');
  let formText = $state('');
  let formAuthor = $state('');
  let saving = $state(false);
  let formError = $state<string | null>(null);
  let savedNote = $state<string | null>(null);

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    meta = await getDeployment(deploymentId);
    if (!$isLeadOrAdmin) {
      loading = false;
      return; // role gate — the add form still renders; the timeline does not
    }
    await run();
  });

  async function run(): Promise<void> {
    loading = true;
    error = null;
    try {
      const res = await loadJournal(deploymentId);
      entries = res.entries;
    } catch (err) {
      if (err instanceof ApiClientError) {
        error = err.status === 403 ? $t('journal.forbidden') : $t('journal.loadFailed');
      } else {
        error = $t('journal.loadFailed');
      }
    } finally {
      loading = false;
    }
  }

  /** Compose an ISO timestamp for today's date with the chosen HH:MM. */
  function isoFromTime(hhmm: string): string {
    const parts = hhmm.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const d = new Date();
    if (Number.isFinite(h) && Number.isFinite(m)) d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (saving) return;
    if (!formText.trim()) {
      formError = $t('journal.textRequired');
      return;
    }
    saving = true;
    formError = null;
    savedNote = null;
    try {
      const input: JournalEntryInput = {
        time: isoFromTime(formTime),
        category: formCategory,
        text: formText,
        authorName: formAuthor,
      };
      await saveJournalEntry({ deploymentId, input });
      savedNote = `${$t('journal.saved')} ✓`;
      formText = '';
      formTime = nowHHMM();
      // Refresh the timeline for viewers who can read it.
      if (canView) await run();
    } catch (err) {
      formError = err instanceof Error ? err.message : $t('journal.error');
    } finally {
      saving = false;
    }
  }

  function catLabel(value: string): string {
    const key = `journal.categories.${value}`;
    const label = $t(key);
    return label === key ? value : label;
  }

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE');
  }
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="clipboard" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('journal.title')}</h1>
    </div>
    <p class="text-muted">{meta?.title ?? deploymentId}</p>
  </header>

  <nav class="flex flex-wrap gap-2 print:hidden">
    <a class="btn-ghost px-3 text-sm" href={`/deployment/${deploymentId}/`}>
      <Icon name="arrow-left" size={18} />{$t('common.back')}
    </a>
  </nav>

  <!-- ADD: available to everyone. -->
  <section class="card space-y-4">
    <h2 class="text-lg font-semibold text-fg">{$t('journal.addEntry')}</h2>
    <form class="space-y-4" onsubmit={onSubmit}>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="field-label" for="j-time">{$t('journal.time')}</label>
          <input id="j-time" class="field-input" type="time" bind:value={formTime} required />
        </div>
        <div>
          <label class="field-label" for="j-category">{$t('journal.category')}</label>
          <select id="j-category" class="field-input" bind:value={formCategory}>
            {#each JOURNAL_CATEGORY_VALUES as c (c)}
              <option value={c}>{catLabel(c)}</option>
            {/each}
          </select>
        </div>
      </div>

      <div>
        <label class="field-label" for="j-text">{$t('journal.text')}</label>
        <textarea
          id="j-text"
          class="field-input"
          rows="3"
          placeholder={$t('journal.textPlaceholder')}
          bind:value={formText}
        ></textarea>
      </div>

      <div>
        <label class="field-label" for="j-author">{$t('journal.author')}</label>
        <input
          id="j-author"
          class="field-input"
          type="text"
          autocomplete="off"
          placeholder={$t('journal.authorPlaceholder')}
          bind:value={formAuthor}
        />
      </div>

      {#if formError}
        <p class="field-error" role="alert">{formError}</p>
      {/if}
      {#if savedNote}
        <p class="rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand-soft-fg" aria-live="polite">
          {savedNote}
        </p>
      {/if}

      <div class="flex justify-end">
        <button type="submit" class="btn-primary px-5" disabled={saving}>
          {#if saving}<Spinner />{:else}<Icon name="plus" size={18} />{/if}
          {$t('common.add')}
        </button>
      </div>
    </form>
  </section>

  <!-- READ: timeline, lead + admin only. -->
  {#if !canView}
    <div class="card flex items-start gap-3">
      <span class="shrink-0 text-warning"><Icon name="lock" size={20} /></span>
      <div class="space-y-1">
        <p class="font-medium text-fg">{$t('journal.forbiddenTitle')}</p>
        <p class="text-sm text-muted">{$t('journal.forbidden')}</p>
      </div>
    </div>
  {:else}
    <section class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-fg">{$t('journal.timelineTitle')}</h2>
        {#if !loading && !error}
          <button type="button" class="btn-ghost px-3 text-sm" onclick={run}>
            <Icon name="clock" size={16} />{$t('journal.refresh')}
          </button>
        {/if}
      </div>

      <p class="rounded-xl border border-line bg-surface-2 px-4 py-2 text-xs text-muted">
        {$t('journal.forwardOnlyHint')}
      </p>

      {#if loading}
        <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
          <Spinner />
          <p class="text-sm text-muted">{$t('journal.loading')}</p>
        </div>
      {:else if error}
        <div class="space-y-3">
          <p class="field-error" role="alert">{error}</p>
          <button type="button" class="btn-secondary px-4 text-sm" onclick={run}>
            {$t('journal.retry')}
          </button>
        </div>
      {:else if entries.length === 0}
        <EmptyState icon="clipboard" title={$t('journal.empty')} />
      {:else}
        <ol class="space-y-3">
          {#each entries as entry (entry.id)}
            <li class="card flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
              <div class="flex shrink-0 items-center gap-2 sm:w-44 sm:flex-col sm:items-start">
                <span class="font-mono text-sm tabular-nums text-fg">{fmtTime(entry.time)}</span>
                <Badge tone="brand">{catLabel(entry.category)}</Badge>
              </div>
              <div class="min-w-0 flex-1">
                <p class="whitespace-pre-wrap break-words text-sm text-fg">{entry.text}</p>
                {#if entry.authorName}
                  <p class="mt-1 text-xs text-subtle">
                    {$t('journal.author')}: {entry.authorName}
                  </p>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      {/if}

      <p class="text-xs text-subtle">{$t('journal.privacyNote')}</p>
    </section>
  {/if}
</section>
