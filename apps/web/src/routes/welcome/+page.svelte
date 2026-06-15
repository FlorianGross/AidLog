<!--
  welcome/+page.svelte — first screen on a device with NO local identity.

  Offers the three distinct onboarding paths instead of dumping a new user into
  org-setup: join with an invitation (the common case for invited helpers),
  create a brand-new organisation (only the very first admin), or add this device
  to an existing account (multi-device transfer). Identities are device-local, so
  a fresh/anonymous browser always starts here.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { branding } from '$lib/branding';
  import { Icon } from '$lib/ui';
  import { isServerConfigEnabled, getApiBase } from '$lib/config/serverUrl';

  // Only offer the server switch on builds that use runtime server config.
  const serverConfigurable = isServerConfigEnabled();
  const currentServer = $derived(getApiBase());

  const options = [
    {
      href: '/redeem/',
      icon: 'users',
      title: 'welcome.joinTitle',
      desc: 'welcome.joinDesc',
      primary: true,
    },
    {
      href: '/device-add/',
      icon: 'shield-check',
      title: 'welcome.deviceTitle',
      desc: 'welcome.deviceDesc',
      primary: false,
    },
    {
      href: '/setup/',
      icon: 'activity',
      title: 'welcome.setupTitle',
      desc: 'welcome.setupDesc',
      primary: false,
    },
  ];
</script>

<section class="mx-auto w-full max-w-md space-y-6">
  <div class="flex flex-col items-center gap-3 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
      <Icon name="activity" size={30} />
    </span>
    <div>
      <div class="text-sm font-medium text-muted">{branding.appName}</div>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('welcome.title')}</h1>
      <p class="mt-1 text-sm text-muted">{$t('welcome.subtitle')}</p>
    </div>
  </div>

  <div class="space-y-3">
    {#each options as o}
      <a
        href={o.href}
        class={`flex items-start gap-3 rounded-2xl border p-4 transition-colors ${
          o.primary
            ? 'border-brand bg-brand-soft hover:bg-brand-soft'
            : 'border-line bg-surface-1 hover:bg-surface-2'
        }`}
      >
        <span
          class={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            o.primary ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-muted'
          }`}
        >
          <Icon name={o.icon} size={20} />
        </span>
        <span class="min-w-0">
          <span class="block font-medium text-fg">{$t(o.title)}</span>
          <span class="mt-0.5 block text-sm text-muted">{$t(o.desc)}</span>
        </span>
        <span class="ml-auto self-center text-subtle"><Icon name="chevron-right" size={20} /></span>
      </a>
    {/each}
  </div>

  <p class="text-center text-sm text-muted">
    {$t('auth.haveAccount')}
    <a class="font-medium text-brand underline-offset-2 hover:underline" href="/login/"
      >{$t('auth.unlock')}</a
    >
  </p>

  {#if serverConfigurable}
    <p class="text-center text-xs text-subtle">
      {$t('server.connectedTo')}
      <span class="font-medium text-muted">{currentServer || $t('server.sameOrigin')}</span>
      ·
      <a class="font-medium text-brand underline-offset-2 hover:underline" href="/server/"
        >{$t('server.change')}</a
      >
    </p>
  {/if}
</section>
