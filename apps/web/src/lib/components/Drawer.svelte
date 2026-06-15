<!--
  Drawer.svelte — left navigation rail / drawer for the app shell.

  Responsive:
   - Desktop (lg+): a persistent, collapsible left rail.
   - Mobile (< lg): an off-canvas drawer toggled by the header hamburger, with a
     dimming backdrop and Escape-to-close.

  Role-aware: admin/lead see Benutzerverwaltung (admins manage, leads read).
  All labels go through the i18n layer ($t). Iconography comes from the UI kit.
  Flat, clinical, medical-teal: active item is a teal-soft tile, everything sits
  on semantic surface/line tokens so both themes paint correctly.
-->
<script lang="ts">
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { branding } from '$lib/branding';
  import { session, isLeadOrAdmin, isAdmin, connectivity } from '$lib/store';
  import { Icon } from '$lib/ui';

  interface Props {
    /** Mobile off-canvas open state (ignored on desktop). */
    open: boolean;
    /** Desktop collapsed (icon-only) state. */
    collapsed: boolean;
    onClose: () => void;
    onToggleCollapse: () => void;
    /** Lock + sign out (wipes the in-memory session). */
    onLock: () => void;
  }
  let { open, collapsed, onClose, onToggleCollapse, onLock }: Props = $props();

  interface NavItem {
    href: string;
    labelKey: string;
    icon: string;
    /** Only shown when this predicate is true (role gating). */
    show?: () => boolean;
  }

  const items: NavItem[] = [
    { href: '/', labelKey: 'nav.dashboard', icon: 'dashboard' },
    // "Meine Einsätze" — every authenticated user's own authored deployments,
    // read-only and cross-device (sealed to the author via the 'author' wrapper).
    { href: '/meine-einsaetze/', labelKey: 'myEinsaetze.nav', icon: 'clipboard' },
    { href: '/cosign/', labelKey: 'nav.cosign', icon: 'signature' },
    {
      href: '/admin/users/',
      labelKey: 'nav.users',
      icon: 'users',
      show: () => $isLeadOrAdmin,
    },
    {
      href: '/admin/material/',
      labelKey: 'material.nav',
      icon: 'clipboard',
      show: () => $isLeadOrAdmin,
    },
    // Kräftebemessung (Orientierungshilfe): lead/admin planning tool.
    {
      href: '/tools/kraeftebemessung/',
      labelKey: 'nav.kraefte',
      icon: 'activity',
      show: () => $isLeadOrAdmin,
    },
    // CIRS: visible to ALL authenticated users (anonymous incident reporting).
    { href: '/cirs/', labelKey: 'cirs.nav', icon: 'alert' },
    // CIRS review: admin-gated quality-management decryption/triage.
    {
      href: '/admin/cirs/',
      labelKey: 'cirs.reviewNav',
      icon: 'shield-check',
      show: () => $isAdmin,
    },
    {
      href: '/admin/datenschutz/',
      labelKey: 'nav.privacy',
      icon: 'shield',
      show: () => $isAdmin,
    },
    { href: '/profile/', labelKey: 'nav.profile', icon: 'user' },
  ];

  const visible = $derived(items.filter((i) => !i.show || i.show()));
  const currentPath = $derived($page.url.pathname);

  function isActive(href: string): boolean {
    if (href === '/') return currentPath === '/';
    return currentPath.startsWith(href);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && open) onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<!-- Mobile backdrop -->
{#if open}
  <button
    type="button"
    class="fixed inset-0 z-20 bg-black/50 lg:hidden"
    aria-label={$t('nav.closeMenu')}
    onclick={onClose}
  ></button>
{/if}

<nav
  aria-label={$t('nav.primary')}
  class="fixed inset-y-0 left-0 z-30 flex flex-col border-r border-line bg-surface-1 transition-all duration-200
    lg:static lg:translate-x-0
    {open ? 'translate-x-0' : '-translate-x-full'}
    {collapsed ? 'lg:w-20' : 'w-64'}"
>
  <!-- Brand mark -->
  <div class="flex h-16 items-center gap-2 border-b border-line px-4">
    <a
      href="/"
      class="flex min-h-touch items-center gap-2.5 rounded-xl px-1 text-lg font-semibold text-fg {collapsed
        ? 'lg:justify-center'
        : ''}"
      onclick={onClose}
    >
      <Icon name="activity" size={26} class="shrink-0 text-brand" />
      {#if !collapsed}<span class="tracking-tight">{branding.appName}</span>{/if}
    </a>
  </div>

  <!-- Nav items -->
  <ul class="flex-1 space-y-1 overflow-y-auto p-3">
    {#each visible as item (item.href)}
      {@const active = isActive(item.href)}
      <li>
        <a
          href={item.href}
          onclick={onClose}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? $t(item.labelKey) : undefined}
          class="flex min-h-touch items-center gap-3 rounded-xl px-3 text-base font-medium transition-colors
            {active
            ? 'bg-brand-soft text-brand-soft-fg'
            : 'text-muted hover:bg-surface-2 hover:text-fg'}
            {collapsed ? 'lg:justify-center lg:px-0' : ''}"
        >
          <Icon name={item.icon} size={22} class="shrink-0" />
          {#if !collapsed}<span>{$t(item.labelKey)}</span>{/if}
        </a>
      </li>
    {/each}
  </ul>

  <!-- Status + actions -->
  <div class="space-y-1 border-t border-line p-3">
    <!-- Online / verschlüsselt indicator -->
    <div
      class="flex min-h-touch items-center gap-2.5 rounded-xl px-3 text-sm {collapsed
        ? 'lg:justify-center lg:px-0'
        : ''}"
      aria-live="polite"
    >
      <span
        class="h-2.5 w-2.5 shrink-0 rounded-full"
        class:bg-ok={$connectivity.online}
        class:bg-warning={!$connectivity.online}
      ></span>
      {#if !collapsed}
        <span class="min-w-0">
          <span class="block font-medium text-fg">
            {$connectivity.online ? $t('common.online') : $t('common.offline')}
          </span>
          <span class="flex items-center gap-1 text-xs text-subtle">
            <Icon name="lock" size={12} />
            {$t('common.encrypted')}
          </span>
        </span>
      {/if}
    </div>

    <!-- Lock / sign out -->
    <button
      type="button"
      class="flex min-h-touch w-full items-center gap-3 rounded-xl px-3 text-base font-medium text-muted transition-colors hover:bg-surface-2 hover:text-fg
        {collapsed ? 'lg:justify-center lg:px-0' : ''}"
      onclick={onLock}
      title={collapsed ? $t('nav.logout') : undefined}
    >
      <Icon name="log-out" size={22} class="shrink-0" />
      {#if !collapsed}<span>{$t('nav.logout')}</span>{/if}
    </button>

    <!-- Desktop collapse toggle -->
    <button
      type="button"
      class="hidden min-h-touch w-full items-center gap-3 rounded-xl px-3 text-sm text-subtle transition-colors hover:bg-surface-2 hover:text-fg lg:flex
        {collapsed ? 'lg:justify-center lg:px-0' : ''}"
      onclick={onToggleCollapse}
      aria-label={collapsed ? $t('nav.expand') : $t('nav.collapse')}
    >
      <Icon
        name={collapsed ? 'chevron-right' : 'chevron-left'}
        size={20}
        class="rtl-flip shrink-0"
      />
      {#if !collapsed}<span>{$t('nav.collapse')}</span>{/if}
    </button>
  </div>
</nav>
