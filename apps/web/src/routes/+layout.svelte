<!--
  +layout.svelte — the app shell.

  Persistent left drawer (collapsible on desktop, off-canvas on mobile) + a top
  header with page context, theme toggle, an online/offline + sync indicator and
  a user chip. All sensitive state lives in memory (crypto session); locking
  wipes it.

  On auth routes (login / setup / redeem) the chrome is suppressed — those run
  before an identity is unlocked.
-->
<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t, locale, initLocale, dirFor } from '$lib/i18n';
  import { branding } from '$lib/branding';
  import { connectivity, session, initConnectivity, syncNow, loadIdentity } from '$lib/store';
  import { lock } from '$lib/crypto';
  import { api } from '$lib/api';
  import { initTheme } from '$lib/theme';
  import { initDisplayMode } from '$lib/display';
  import { startIdleWatch, stopIdleWatch } from '$lib/security';
  import Drawer from '$lib/components/Drawer.svelte';
  import { Icon, ThemeToggle, Avatar } from '$lib/ui';

  let { children } = $props();

  let drawerOpen = $state(false);
  let drawerCollapsed = $state(false);
  let displayName = $state<string | null>(null);

  // Routes that render WITHOUT the app shell (pre-unlock auth flows).
  const AUTH_ROUTES = ['/login', '/setup', '/redeem', '/recover', '/device-add', '/welcome'];
  const isAuthRoute = $derived(AUTH_ROUTES.some((r) => $page.url.pathname.startsWith(r)));

  // Map the current route to a header title (i18n keyed).
  const pageTitleKey = $derived.by(() => {
    const p = $page.url.pathname;
    if (p.startsWith('/cosign')) return 'nav.cosign';
    if (p.startsWith('/admin/users')) return 'nav.users';
    if (p.startsWith('/profile')) return 'nav.profile';
    if (p.startsWith('/deployment')) return 'deployment.title';
    return 'nav.dashboard';
  });

  // Keep <html lang/dir> in sync with the active locale. Arabic switches the
  // whole document to right-to-left; everything else stays left-to-right.
  $effect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.setAttribute('lang', $locale);
    root.setAttribute('dir', dirFor($locale));
  });

  onMount(() => {
    initTheme();
    initDisplayMode();
    initLocale();
    const teardown = initConnectivity();
    // Inactivity auto-lock + lock-on-background. The watcher self-arms once a
    // session is unlocked and re-arms after each login, so starting it once
    // here is sufficient.
    startIdleWatch();
    void loadIdentity().then((id) => (displayName = id?.displayName ?? null));
    return () => {
      teardown();
      stopIdleWatch();
    };
  });

  function handleLock(): void {
    lock();
    api.setToken(null);
    drawerOpen = false;
    void goto('/login/');
  }
</script>

{#if isAuthRoute}
  <!-- Bare, centered layout for auth flows. -->
  <div class="mx-auto flex min-h-full max-w-2xl flex-col px-4 py-6">
    <main class="flex flex-1 items-center justify-center">
      {@render children?.()}
    </main>
    <footer class="px-4 py-3 text-center text-xs text-subtle">
      {$t('app.zeroKnowledge')}
    </footer>
  </div>
{:else}
  <div class="flex min-h-full bg-surface">
    <Drawer
      open={drawerOpen}
      collapsed={drawerCollapsed}
      onClose={() => (drawerOpen = false)}
      onToggleCollapse={() => (drawerCollapsed = !drawerCollapsed)}
      onLock={handleLock}
    />

    <div class="flex min-h-full flex-1 flex-col">
      <header
        class="sticky top-0 z-10 flex h-16 items-center justify-between gap-3 border-b border-line bg-surface-1/95 px-4 backdrop-blur"
      >
        <div class="flex min-w-0 items-center gap-2">
          <!-- Hamburger (mobile only) -->
          <button
            type="button"
            class="btn-ghost min-h-touch min-w-touch px-2 lg:hidden"
            aria-label={$t('nav.openMenu')}
            aria-expanded={drawerOpen}
            onclick={() => (drawerOpen = true)}
          >
            <Icon name="menu" size={24} />
          </button>
          <h1 class="truncate text-lg font-semibold text-fg">{$t(pageTitleKey)}</h1>
        </div>

        <div class="flex items-center gap-1.5 sm:gap-2">
          <!-- Connectivity / outbox indicator -->
          <span
            class="hidden min-h-touch items-center gap-1.5 rounded-xl px-3 text-sm font-medium sm:inline-flex"
            class:text-ok={$connectivity.online}
            class:text-warning={!$connectivity.online}
            aria-live="polite"
          >
            <span
              class="h-2.5 w-2.5 rounded-full"
              class:bg-ok={$connectivity.online}
              class:bg-warning={!$connectivity.online}
            ></span>
            {$connectivity.online ? $t('common.online') : $t('common.offline')}
            {#if $connectivity.pending > 0}
              <span class="badge-muted">
                {$connectivity.pending}
                {$t('common.queued')}
              </span>
            {/if}
          </span>

          {#if $connectivity.online && $session.unlocked}
            <button
              type="button"
              class="btn-secondary min-h-touch px-3 text-sm"
              onclick={() => void syncNow()}
              disabled={$connectivity.syncing}
            >
              {$connectivity.syncing ? $t('common.syncing') : $t('common.sync')}
            </button>
          {/if}

          <ThemeToggle />

          {#if $session.unlocked}
            <!-- User chip -->
            <a
              href="/profile/"
              class="flex min-h-touch items-center gap-2 rounded-xl px-1.5 transition-colors hover:bg-surface-2"
              aria-label={$t('nav.profile')}
            >
              <Avatar name={displayName} size={32} />
              <span class="hidden min-w-0 pr-1 text-left leading-tight md:block">
                <span class="block truncate text-sm font-medium text-fg"
                  >{displayName ?? branding.appName}</span
                >
                {#if $session.role}
                  <span class="block text-xs text-subtle">{$t(`roles.${$session.role}`)}</span>
                {/if}
              </span>
            </a>
          {/if}
        </div>
      </header>

      <main class="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
        {@render children?.()}
      </main>

      <footer class="px-4 py-3 text-center text-xs text-subtle">
        {$t('app.zeroKnowledge')}
      </footer>
    </div>
  </div>
{/if}
