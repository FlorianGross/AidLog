<!--
  admin/audit/+page.svelte — organisation audit log (admin).

  Lists ROUTES.audit entries (administrative actions only — never patient data)
  as a clean timeline with a Badge per action type. EmptyState when there are no
  entries. The server is the authority; this page is read-only.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { AuditAction, AuditEntry } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { session, isAdmin } from '$lib/store';
  import { api } from '$lib/api';
  import { Icon, Badge, EmptyState } from '$lib/ui';

  let entries = $state<AuditEntry[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(true);

  // Per-action presentation: icon + badge tone.
  const META: Record<
    AuditAction,
    { icon: string; tone: 'brand' | 'ok' | 'warning' | 'danger' | 'muted' }
  > = {
    'user.invited': { icon: 'user', tone: 'brand' },
    'user.redeemed': { icon: 'check', tone: 'ok' },
    'user.disabled': { icon: 'lock', tone: 'danger' },
    'user.enabled': { icon: 'shield-check', tone: 'ok' },
    'user.role-changed': { icon: 'settings', tone: 'warning' },
    'recovery.configured': { icon: 'shield', tone: 'brand' },
    'shift.closed': { icon: 'clock', tone: 'muted' },
    'archive.anchored': { icon: 'shield-check', tone: 'ok' },
    'category.updated': { icon: 'clipboard', tone: 'brand' },
  };

  function meta(a: AuditAction): {
    icon: string;
    tone: 'brand' | 'ok' | 'warning' | 'danger' | 'muted';
  } {
    return META[a] ?? { icon: 'file-text', tone: 'muted' };
  }

  function shortKey(keyId: string | undefined): string {
    if (!keyId) return '—';
    return keyId.length > 12 ? `${keyId.slice(0, 8)}…${keyId.slice(-4)}` : keyId;
  }

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    if (!$isAdmin) {
      await goto('/');
      return;
    }
    try {
      const res = await api.listAudit();
      entries = [...res.entries].sort((a, b) => b.at.localeCompare(a.at));
    } catch {
      loadError = $t('audit.loadFailed');
    } finally {
      loading = false;
    }
  });
</script>

<section class="space-y-8">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="file-text" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('audit.title')}</h1>
    </div>
    <p class="text-muted">{$t('audit.subtitle')}</p>
  </header>

  <nav class="flex flex-wrap gap-2">
    <a class="btn-ghost px-3 text-sm" href="/admin/users/">
      <Icon name="users" size={18} />{$t('nav.users')}
    </a>
    <a class="btn-ghost px-3 text-sm" href="/admin/recovery/">
      <Icon name="shield" size={18} />{$t('nav.recovery')}
    </a>
  </nav>

  {#if loadError}
    <p class="field-error" role="alert">{loadError}</p>
  {/if}

  {#if loading}
    <p class="text-sm text-muted">{$t('common.loading')}</p>
  {:else if entries.length === 0}
    <EmptyState icon="file-text" title={$t('audit.empty')} />
  {:else}
    <ol class="space-y-2.5">
      {#each entries as entry (entry.id)}
        {@const m = meta(entry.action)}
        <li class="card flex items-start gap-3 py-4">
          <span
            class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg"
          >
            <Icon name={m.icon} size={18} />
          </span>
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <Badge tone={m.tone}>{$t(`audit.action.${entry.action}`)}</Badge>
              <span class="text-sm text-subtle">
                {new Date(entry.at).toLocaleString('de-DE')}
              </span>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted">
              <span>
                <span class="text-subtle">{$t('audit.actor')}:</span>
                <code class="font-mono text-xs">{shortKey(entry.actorKeyId)}</code>
              </span>
              {#if entry.targetKeyId}
                <span>
                  <span class="text-subtle">{$t('audit.target')}:</span>
                  <code class="font-mono text-xs">{shortKey(entry.targetKeyId)}</code>
                </span>
              {/if}
            </div>
            {#if entry.detail}
              <p class="text-sm text-fg">{entry.detail}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}
</section>
