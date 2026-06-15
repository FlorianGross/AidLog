<!--
  deployment/[id]/dienst/+page.svelte — ANWESENHEIT / DIENST (roster).

  A per-deployment duty roster: who is on duty, with check-in/out times, each
  person's Sanitätsdienst qualification, and a free-text role-at-event.

  OPERATIONAL metadata only — NOT patient/health data. Stored server-side in
  clear (see contracts RosterEntry). Everyone may self check-in/out ("Ich bin im
  Dienst"); an admin/lead may manage other helpers (the server enforces this).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { session, isLeadOrAdmin, getDeployment, type DeploymentMeta } from '$lib/store';
  import { api } from '$lib/api';
  import { qualificationLabel } from '$lib/qualifications';
  import { Icon, Badge, EmptyState, Spinner } from '$lib/ui';
  import type { RosterEntry } from '@aidlog/contracts';

  const deploymentId = $derived($page.params.id ?? '');

  let meta = $state<DeploymentMeta | undefined>(undefined);
  let entries = $state<RosterEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  const canManage = $derived($isLeadOrAdmin);

  // The caller's own roster entry (if any), so we can show the right self-action.
  const myEntry = $derived(entries.find((e) => e.helperKeyId === $session.keyId));
  const onDuty = $derived(!!myEntry?.checkedInAt && !myEntry?.checkedOutAt);

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    meta = await getDeployment(deploymentId);
    await refresh();
  });

  async function refresh(): Promise<void> {
    error = null;
    loading = true;
    try {
      const res = await api.getRoster(deploymentId);
      // On-duty first, then checked-out, then by name.
      entries = res.entries.slice().sort(sortEntries);
    } catch {
      error = $t('roster.loadFailed');
    } finally {
      loading = false;
    }
  }

  function sortEntries(a: RosterEntry, b: RosterEntry): number {
    const aOn = a.checkedInAt && !a.checkedOutAt ? 0 : 1;
    const bOn = b.checkedInAt && !b.checkedOutAt ? 0 : 1;
    if (aOn !== bOn) return aOn - bOn;
    return a.displayName.localeCompare(b.displayName, 'de');
  }

  function fmt(iso?: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('de-DE', {
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: '2-digit',
    });
  }

  // --- self check-in / check-out -------------------------------------------
  async function selfCheckIn(): Promise<void> {
    actionError = null;
    try {
      await api.upsertRoster(deploymentId, { action: 'in' });
      await refresh();
    } catch {
      actionError = $t('roster.updateFailed');
    }
  }

  async function selfCheckOut(): Promise<void> {
    actionError = null;
    try {
      await api.upsertRoster(deploymentId, { action: 'out' });
      await refresh();
    } catch {
      actionError = $t('roster.updateFailed');
    }
  }

  // --- admin/lead: manage another helper -----------------------------------
  async function setOut(entry: RosterEntry): Promise<void> {
    actionError = null;
    try {
      await api.upsertRoster(deploymentId, { helperKeyId: entry.helperKeyId, action: 'out' });
      await refresh();
    } catch {
      actionError = $t('roster.updateFailed');
    }
  }

  async function setIn(entry: RosterEntry): Promise<void> {
    actionError = null;
    try {
      await api.upsertRoster(deploymentId, { helperKeyId: entry.helperKeyId, action: 'in' });
      await refresh();
    } catch {
      actionError = $t('roster.updateFailed');
    }
  }
</script>

<section class="space-y-6">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('roster.title')}</h1>
      <p class="text-muted">{meta?.title ?? $t('roster.subtitle')}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if onDuty}
        <button type="button" class="btn-secondary px-4 text-sm" onclick={selfCheckOut}>
          <Icon name="lock" size={18} />{$t('roster.selfCheckOut')}
        </button>
      {:else}
        <button type="button" class="btn-primary px-4 text-sm" onclick={selfCheckIn}>
          <Icon name="check" size={18} />{$t('roster.selfCheckIn')}
        </button>
      {/if}
      <a href={`/deployment/${deploymentId}/`} class="btn-ghost px-3 text-sm">
        {$t('common.back')}
      </a>
    </div>
  </header>

  {#if error}
    <p class="field-error" role="alert">{error}</p>
  {/if}
  {#if actionError}
    <p class="field-error" role="alert">{actionError}</p>
  {/if}

  {#if loading}
    <div class="flex justify-center py-10"><Spinner /></div>
  {:else if entries.length === 0}
    <EmptyState icon="users" title={$t('roster.empty')} description={$t('roster.emptyHint')} />
  {:else}
    <ul class="space-y-2.5">
      {#each entries as e (e.helperKeyId)}
        {@const isSelf = e.helperKeyId === $session.keyId}
        {@const active = !!e.checkedInAt && !e.checkedOutAt}
        <li class="card flex flex-wrap items-center justify-between gap-3 py-4">
          <div class="flex min-w-0 items-center gap-3">
            <span
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
            >
              <Icon name="user" size={18} />
            </span>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium text-fg">{e.displayName}</span>
                {#if isSelf}<Badge tone="muted">{$t('users.you')}</Badge>{/if}
                <Badge tone={active ? 'ok' : 'muted'}>
                  {active ? $t('roster.onDuty') : $t('roster.offDuty')}
                </Badge>
              </div>
              <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                <span>{$t('roster.qualification')}: {qualificationLabel(e.qualification)}</span>
                {#if e.roleAtEvent}<span>· {e.roleAtEvent}</span>{/if}
                <span>· {$t('roster.checkedIn')}: {fmt(e.checkedInAt)}</span>
                <span>· {$t('roster.checkedOut')}: {fmt(e.checkedOutAt)}</span>
              </div>
            </div>
          </div>

          {#if canManage && !isSelf}
            <div class="flex flex-wrap items-center gap-2">
              {#if active}
                <button type="button" class="btn-secondary px-4 text-sm" onclick={() => setOut(e)}>
                  {$t('roster.checkOutOther')}
                </button>
              {:else}
                <button type="button" class="btn-secondary px-4 text-sm" onclick={() => setIn(e)}>
                  {$t('roster.checkInOther')}
                </button>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>
