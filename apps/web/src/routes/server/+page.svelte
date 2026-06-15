<!--
  server/+page.svelte — pick the API server URL (first-start, runtime config).

  Shown when the build opts into runtime server configuration
  (VITE_RUNTIME_API_CONFIG) or runs as a native app, and no server URL is set
  yet. The user enters their self-hosted server's base URL ONCE; it is persisted
  locally (non-secret) and every API call then targets it — no per-server rebuild.

  The URL is operational config, never key material. "Verbindung testen" hits the
  public health endpoint so a typo is caught before onboarding.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { ROUTES } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { branding } from '$lib/branding';
  import { Icon } from '$lib/ui';
  import { getApiBase, setApiBase, validateServerUrl } from '$lib/config/serverUrl';

  let url = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  // null = not tested, true/false = last test result.
  let reachable = $state<boolean | null>(null);

  onMount(() => {
    // Pre-fill when changing an already-configured server.
    url = getApiBase();
  });

  /** Probe the entered server's public health endpoint. */
  async function onTest(): Promise<void> {
    error = null;
    reachable = null;
    const base = validateServerUrl(url);
    if (!base) {
      error = $t('server.invalidUrl');
      return;
    }
    busy = true;
    try {
      const res = await fetch(base + ROUTES.health, { method: 'GET' });
      reachable = res.ok;
      if (!res.ok) error = $t('server.unreachable');
    } catch {
      reachable = false;
      error = $t('server.unreachable');
    } finally {
      busy = false;
    }
  }

  /** Persist the URL and continue into onboarding. */
  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = null;
    const base = validateServerUrl(url);
    if (!base) {
      error = $t('server.invalidUrl');
      return;
    }
    try {
      setApiBase(base);
    } catch {
      error = $t('server.invalidUrl');
      return;
    }
    await goto('/');
  }
</script>

<section class="mx-auto w-full max-w-md space-y-6">
  <div class="flex flex-col items-center gap-3 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
      <Icon name="globe" size={30} />
    </span>
    <div>
      <div class="text-sm font-medium text-muted">{branding.appName}</div>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('server.title')}</h1>
      <p class="mt-1 text-sm text-muted">{$t('server.subtitle')}</p>
    </div>
  </div>

  <form class="card space-y-4" onsubmit={onSubmit}>
    <div>
      <label class="field-label" for="server-url">{$t('server.urlLabel')}</label>
      <input
        id="server-url"
        class="field-input"
        type="url"
        inputmode="url"
        autocomplete="url"
        placeholder={$t('server.urlPlaceholder')}
        bind:value={url}
        oninput={() => {
          reachable = null;
          error = null;
        }}
        required
      />
      <p class="mt-1 text-xs text-subtle">{$t('server.hint')}</p>
    </div>

    {#if error}
      <p class="field-error" role="alert">{error}</p>
    {:else if reachable === true}
      <p class="flex items-center gap-1.5 text-sm font-medium text-ok" role="status">
        <Icon name="shield-check" size={16} />
        {$t('server.reachable')}
      </p>
    {/if}

    <div class="flex flex-col gap-2 sm:flex-row">
      <button
        type="button"
        class="btn-secondary flex-1"
        disabled={busy || !url.trim()}
        onclick={() => void onTest()}
      >
        {busy ? $t('server.testing') : $t('server.test')}
      </button>
      <button type="submit" class="btn-primary flex-1" disabled={!url.trim()}>
        <Icon name="check" size={18} />
        {$t('server.save')}
      </button>
    </div>
  </form>

  <p class="text-center text-xs text-subtle">{$t('server.note')}</p>
</section>
