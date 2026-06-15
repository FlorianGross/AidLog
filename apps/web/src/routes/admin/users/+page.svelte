<!--
  admin/users/+page.svelte — Benutzerverwaltung.

  Admin: list users, create invitations (the single-use CODE is shown ONCE in a
  copyable box), enable/disable accounts and change roles.
  Lead: read-only view (server also enforces this).
  Other roles are redirected away. The server is the authority; this guard is UX.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import {
    ROLES,
    QUALIFICATIONS,
    type Role,
    type Qualification,
    type UserAccount,
    type Invitation,
  } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { session, isAdmin, isLeadOrAdmin } from '$lib/store';
  import { api } from '$lib/api';
  import { qualificationLabel } from '$lib/qualifications';
  import { Modal, Badge, EmptyState, Icon } from '$lib/ui';

  let users = $state<UserAccount[]>([]);
  let invitations = $state<Invitation[]>([]);
  let loadError = $state<string | null>(null);
  let actionError = $state<string | null>(null);

  // Invitation form.
  let inviteRole = $state<Role>('helper');
  let inviteName = $state('');
  let inviteHours = $state(72);
  let inviteBusy = $state(false);
  /** The freshly-created single-use code, shown ONCE. */
  let newCode = $state<string | null>(null);
  let copied = $state(false);
  let copiedLink = $state(false);
  let inviteOpen = $state(false);

  /** A shareable redeem link with the code prefilled (origin known in-browser). */
  const inviteLink = $derived(
    newCode && typeof window !== 'undefined'
      ? `${window.location.origin}/redeem?code=${encodeURIComponent(newCode)}`
      : null,
  );

  const canManage = $derived($isAdmin);
  const pendingInvites = $derived(invitations.filter((i) => i.status === 'pending'));

  /** Number of active admins — used to guard the last-admin from removal. */
  const activeAdminCount = $derived(
    users.filter((u) => u.role === 'admin' && u.status === 'active').length,
  );

  /** True if removing/demoting `u` would leave the org without an active admin. */
  function isLastAdmin(u: UserAccount): boolean {
    return u.role === 'admin' && u.status === 'active' && activeAdminCount <= 1;
  }

  // --- offboarding confirm modal ---
  let offboardTarget = $state<UserAccount | null>(null);
  let restoreTarget = $state<UserAccount | null>(null);

  function askOffboard(u: UserAccount): void {
    actionError = null;
    if (isLastAdmin(u)) {
      actionError = $t('users.lastAdmin');
      return;
    }
    offboardTarget = u;
  }
  function askRestore(u: UserAccount): void {
    actionError = null;
    restoreTarget = u;
  }
  async function confirmOffboard(): Promise<void> {
    const u = offboardTarget;
    offboardTarget = null;
    if (u) await setStatus(u, 'disabled');
  }
  async function confirmRestore(): Promise<void> {
    const u = restoreTarget;
    restoreTarget = null;
    if (u) await setStatus(u, 'active');
  }

  function openInvite(): void {
    newCode = null;
    copied = false;
    actionError = null;
    inviteOpen = true;
  }

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
    try {
      const [u, inv] = await Promise.all([
        api.listUsers(),
        api.listInvitations().catch(() => ({ invitations: [] as Invitation[] })),
      ]);
      users = u.users;
      invitations = inv.invitations;
    } catch {
      loadError = $t('users.loadFailed');
    }
  }

  async function onCreateInvite(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    actionError = null;
    inviteBusy = true;
    copied = false;
    try {
      const res = await api.createInvitation({
        role: inviteRole,
        ...(inviteName.trim() ? { displayName: inviteName.trim() } : {}),
        expiresInHours: inviteHours,
      });
      newCode = res.code;
      inviteName = '';
      await refresh();
    } catch {
      actionError = $t('users.inviteFailed');
    } finally {
      inviteBusy = false;
    }
  }

  async function copyCode(): Promise<void> {
    if (!newCode) return;
    try {
      await navigator.clipboard.writeText(newCode);
      copied = true;
    } catch {
      copied = false;
    }
  }

  async function copyLink(): Promise<void> {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      copiedLink = true;
    } catch {
      copiedLink = false;
    }
  }

  async function setStatus(u: UserAccount, status: 'active' | 'disabled'): Promise<void> {
    actionError = null;
    try {
      await api.updateUser({ helperId: u.helperId, status });
      await refresh();
    } catch {
      actionError = $t('users.updateFailed');
    }
  }

  async function setRole(u: UserAccount, role: Role): Promise<void> {
    if (role === u.role) return;
    actionError = null;
    // Last-admin guard: do not let the only active admin demote themselves away.
    if (u.role === 'admin' && role !== 'admin' && isLastAdmin(u)) {
      actionError = $t('users.lastAdmin');
      await refresh(); // reset the <select> back to the stored value
      return;
    }
    try {
      await api.updateUser({ helperId: u.helperId, role });
      await refresh();
    } catch {
      actionError = $t('users.updateFailed');
    }
  }

  /** Admin: set (or clear) a user's Sanitätsdienst qualification. */
  async function setQualification(u: UserAccount, value: string): Promise<void> {
    const qualification = (value === '' ? null : value) as Qualification | null;
    if (qualification === (u.qualification ?? null)) return;
    actionError = null;
    try {
      await api.setUserQualification(u.identity.keyId, qualification);
      await refresh();
    } catch {
      actionError = $t('users.updateFailed');
    }
  }
</script>

<section class="space-y-8">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('users.title')}</h1>
      <p class="text-muted">{$t('users.subtitle')}</p>
      {#if !canManage}
        <p class="text-sm text-warning">{$t('users.readOnlyLead')}</p>
      {/if}
    </div>
    {#if canManage}
      <button type="button" class="btn-primary px-5" onclick={openInvite}>
        <Icon name="plus" size={20} />
        {$t('users.invite')}
      </button>
    {/if}
  </header>

  <!-- Admin tools (key recovery + audit). In-page links since the shell drawer
       is owned elsewhere and not edited here. -->
  {#if canManage}
    <section class="card flex flex-wrap items-center justify-between gap-3 py-4">
      <div class="space-y-0.5">
        <h2 class="text-base font-semibold text-fg">{$t('users.adminTools')}</h2>
        <p class="text-sm text-muted">{$t('users.adminToolsHint')}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <a class="btn-secondary px-4 text-sm" href="/admin/auswertung/">
          <Icon name="activity" size={18} />{$t('analytics.open')}
        </a>
        <a class="btn-secondary px-4 text-sm" href="/admin/recovery/">
          <Icon name="shield" size={18} />{$t('users.openRecovery')}
        </a>
        <a class="btn-secondary px-4 text-sm" href="/admin/audit/">
          <Icon name="file-text" size={18} />{$t('users.openAudit')}
        </a>
        <a class="btn-secondary px-4 text-sm" href="/admin/schema/">
          <Icon name="settings" size={18} />{$t('schemaEditor.open')}
        </a>
        <a class="btn-secondary px-4 text-sm" href="/admin/categories/">
          <Icon name="clipboard" size={18} />{$t('categories.open')}
        </a>
      </div>
    </section>
  {/if}

  <!-- Analytics is open to admin AND lead; leads see the users page read-only and
       the admin-tools card above is admin-only, so surface the link here too. -->
  {#if !canManage}
    <section class="card flex flex-wrap items-center justify-between gap-3 py-4">
      <div class="space-y-0.5">
        <h2 class="text-base font-semibold text-fg">{$t('analytics.title')}</h2>
        <p class="text-sm text-muted">{$t('analytics.subtitle')}</p>
      </div>
      <a class="btn-secondary px-4 text-sm" href="/admin/auswertung/">
        <Icon name="activity" size={18} />{$t('analytics.open')}
      </a>
    </section>
  {/if}

  {#if loadError}
    <p class="field-error" role="alert">{loadError}</p>
  {/if}
  {#if actionError}
    <p class="field-error" role="alert">{actionError}</p>
  {/if}

  <!-- User list -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold text-fg">{$t('users.list')}</h2>
    {#if users.length === 0}
      <EmptyState icon="users" title={$t('users.noUsers')} />
    {:else}
      <ul class="space-y-2.5">
        {#each users as u (u.helperId)}
          {@const isSelf = u.identity.keyId === $session.keyId}
          <li class="card flex flex-wrap items-center justify-between gap-3 py-4">
            <div class="flex min-w-0 items-center gap-3">
              <span
                class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-fg"
              >
                <Icon name="user" size={18} />
              </span>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="truncate font-medium text-fg">{u.displayName}</span>
                  {#if isSelf}
                    <Badge tone="muted">{$t('users.you')}</Badge>
                  {/if}
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
                  <Badge tone={u.status === 'active' ? 'ok' : 'muted'}>
                    {u.status === 'active' ? $t('users.statusActive') : $t('users.statusDisabled')}
                  </Badge>
                  <span>· {$t(`roles.${u.role}`)}</span>
                  <span>· {$t('users.qualification')}: {qualificationLabel(u.qualification)}</span>
                </div>
              </div>
            </div>

            {#if canManage && !isSelf}
              <div class="flex flex-wrap items-center gap-2">
                <label class="sr-only" for={`role-${u.helperId}`}>{$t('users.changeRole')}</label>
                <select
                  id={`role-${u.helperId}`}
                  class="field-input min-h-touch w-auto py-2 text-base"
                  value={u.role}
                  onchange={(e) => setRole(u, (e.currentTarget as HTMLSelectElement).value as Role)}
                >
                  {#each ROLES as r (r)}
                    <option value={r}>{$t(`roles.${r}`)}</option>
                  {/each}
                </select>
                <label class="sr-only" for={`qual-${u.helperId}`}>
                  {$t('users.changeQualification')}
                </label>
                <select
                  id={`qual-${u.helperId}`}
                  class="field-input min-h-touch w-auto py-2 text-base"
                  value={u.qualification ?? ''}
                  onchange={(e) =>
                    setQualification(u, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">{$t('users.qualificationNone')}</option>
                  {#each QUALIFICATIONS as q (q.value)}
                    <option value={q.value}>{q.label}</option>
                  {/each}
                </select>
                {#if u.status === 'active'}
                  <button
                    type="button"
                    class="btn-danger px-4 text-sm"
                    onclick={() => askOffboard(u)}
                    disabled={isLastAdmin(u)}
                    title={isLastAdmin(u) ? $t('users.lastAdmin') : undefined}
                  >
                    <Icon name="lock" size={16} />
                    {$t('users.offboard')}
                  </button>
                {:else}
                  <button
                    type="button"
                    class="btn-secondary px-4 text-sm"
                    onclick={() => askRestore(u)}
                  >
                    {$t('users.restoreAccess')}
                  </button>
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Pending invitations -->
  <section class="space-y-3">
    <h2 class="text-lg font-semibold text-fg">{$t('users.pendingInvites')}</h2>
    {#if pendingInvites.length === 0}
      <EmptyState icon="clock" title={$t('users.noInvites')} />
    {:else}
      <ul class="space-y-2">
        {#each pendingInvites as inv (inv.id)}
          <li class="card flex items-center justify-between gap-3 py-3 text-sm">
            <span class="font-medium text-fg">{inv.displayName || '—'}</span>
            <span class="text-muted">
              {$t(`roles.${inv.role}`)} · {$t('users.expires', {
                date: new Date(inv.expiresAt).toLocaleString('de-DE'),
              })}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</section>

<!-- Invitation modal (admin only) -->
{#if canManage}
  <Modal open={inviteOpen} title={$t('users.inviteTitle')} onClose={() => (inviteOpen = false)}>
    {#if newCode}
      <div class="space-y-3">
        <div class="flex gap-3 rounded-xl border border-line bg-warning-soft/40 p-4">
          <span class="shrink-0 text-warning"><Icon name="alert" size={20} /></span>
          <p class="text-sm text-warning-fg">{$t('users.codeOnce')}</p>
        </div>
        <div>
          <span class="field-label">{$t('users.codeLabel')}</span>
          <div class="flex items-center gap-2">
            <code
              class="min-h-touch flex-1 break-all rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-lg text-brand"
            >
              {newCode}
            </code>
            <button
              type="button"
              class="btn-secondary px-4 text-sm"
              onclick={copyCode}
              aria-label={$t('users.copy')}
            >
              <Icon name={copied ? 'check' : 'copy'} size={18} />
              {copied ? $t('users.copied') : $t('users.copy')}
            </button>
          </div>
        </div>
        {#if inviteLink}
          <div>
            <span class="field-label">{$t('users.linkLabel')}</span>
            <div class="flex items-center gap-2">
              <code
                class="min-h-touch flex-1 break-all rounded-xl bg-surface-2 px-3 py-2.5 font-mono text-sm text-muted"
              >
                {inviteLink}
              </code>
              <button
                type="button"
                class="btn-secondary px-4 text-sm"
                onclick={copyLink}
                aria-label={$t('users.copyLink')}
              >
                <Icon name={copiedLink ? 'check' : 'copy'} size={18} />
                {copiedLink ? $t('users.copied') : $t('users.copyLink')}
              </button>
            </div>
            <p class="mt-1 text-xs text-subtle">{$t('users.linkHint')}</p>
          </div>
        {/if}
      </div>
    {:else}
      <form class="space-y-4" onsubmit={onCreateInvite}>
        <div>
          <label class="field-label" for="inv-name">{$t('users.nameOptional')}</label>
          <input id="inv-name" class="field-input" bind:value={inviteName} />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="field-label" for="inv-role">{$t('users.role')}</label>
            <select id="inv-role" class="field-input" bind:value={inviteRole}>
              {#each ROLES as r (r)}
                <option value={r}>{$t(`roles.${r}`)}</option>
              {/each}
            </select>
          </div>
          <div>
            <label class="field-label" for="inv-hours">{$t('users.expiresIn')}</label>
            <input
              id="inv-hours"
              class="field-input"
              type="number"
              min="1"
              max="720"
              bind:value={inviteHours}
            />
          </div>
        </div>
        {#if actionError}
          <p class="field-error" role="alert">{actionError}</p>
        {/if}
        <button type="submit" class="btn-primary w-full" disabled={inviteBusy}>
          {inviteBusy ? $t('users.creating') : $t('users.create')}
        </button>
      </form>
    {/if}
  </Modal>

  <!-- Offboarding confirm modal -->
  <Modal
    open={offboardTarget !== null}
    title={$t('users.offboardTitle')}
    onClose={() => (offboardTarget = null)}
  >
    {#if offboardTarget}
      <div class="space-y-4">
        <p class="text-sm text-fg">
          {$t('users.offboardConfirm')}
          <span class="font-medium">{offboardTarget.displayName}</span>
        </p>
        <p class="text-sm text-muted">{$t('users.offboardExplain')}</p>
        <div class="flex gap-3 rounded-xl border border-line bg-warning-soft/40 p-3">
          <span class="shrink-0 text-warning"><Icon name="alert" size={18} /></span>
          <p class="text-sm text-warning-fg">{$t('users.offboardCaveat')}</p>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-ghost px-4" onclick={() => (offboardTarget = null)}>
            {$t('common.cancel')}
          </button>
          <button type="button" class="btn-danger px-4" onclick={confirmOffboard}>
            <Icon name="lock" size={16} />{$t('users.offboardConfirmBtn')}
          </button>
        </div>
      </div>
    {/if}
  </Modal>

  <!-- Restore-access confirm modal -->
  <Modal
    open={restoreTarget !== null}
    title={$t('users.restoreTitle')}
    onClose={() => (restoreTarget = null)}
  >
    {#if restoreTarget}
      <div class="space-y-4">
        <p class="text-sm text-fg">
          {$t('users.restoreConfirm')}
          <span class="font-medium">{restoreTarget.displayName}</span>
        </p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-ghost px-4" onclick={() => (restoreTarget = null)}>
            {$t('common.cancel')}
          </button>
          <button type="button" class="btn-primary px-4" onclick={confirmRestore}>
            {$t('users.restoreConfirmBtn')}
          </button>
        </div>
      </div>
    {/if}
  </Modal>
{/if}
