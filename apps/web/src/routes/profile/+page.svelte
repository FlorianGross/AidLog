<!--
  profile/+page.svelte — Mein Profil.

  Shows the local account's display name, role, keyId and org id, plus a lock
  button. Signature-on-file is owned by the signature agent; a placeholder slot
  is left for it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t, locale, setLocale, SUPPORTED_LOCALES, LOCALE_NAMES, type Locale } from '$lib/i18n';
  import { displayMode, setDisplayMode } from '$lib/display';
  import { session } from '$lib/store';
  import { lock, getSession } from '$lib/crypto';
  import { loadIdentity, type StoredIdentity } from '$lib/store';
  import { api } from '$lib/api';
  import { Avatar, Badge, Icon } from '$lib/ui';
  import {
    isWebAuthnSupported,
    registerPasskey,
    listPasskeys,
    deletePasskey,
    PasskeyError,
    type StoredPasskey,
  } from '$lib/webauthn';
  import { crypto } from '@aidlog/crypto-core';
  import { createTransfer } from '$lib/devicetransfer';
  import QrCode from '$lib/devicetransfer/QrCode.svelte';
  import { Modal } from '$lib/ui';
  import {
    securitySettings,
    setIdleMinutes,
    setLockOnBackground,
    wipeDevice,
    IDLE_OPTIONS,
    type IdleMinutes,
  } from '$lib/security';
  import {
    isPushSupported,
    getStatus as getPushStatus,
    subscribe as subscribePush,
    unsubscribe as unsubscribePush,
    type PushStatus,
  } from '$lib/push';

  let stored = $state<StoredIdentity | null>(null);

  // --- security settings ---------------------------------------------------
  function idleLabel(m: IdleMinutes): string {
    if (m === 0) return $t('security.idleOff');
    if (m === 1) return $t('security.minutesOne');
    return $t('security.minutes', { count: m });
  }

  // --- device wipe ---------------------------------------------------------
  let wipeOpen = $state(false);
  let wiping = $state(false);

  async function confirmWipe(): Promise<void> {
    wiping = true;
    try {
      await wipeDevice();
    } finally {
      wiping = false;
      wipeOpen = false;
      // Land on the setup route — after a wipe there is no local identity.
      await goto('/setup/');
    }
  }

  // --- passkeys ------------------------------------------------------------
  const passkeySupported = isWebAuthnSupported();
  let passkeys = $state<StoredPasskey[]>([]);
  let passkeyBusy = $state(false);
  let passkeyError = $state<string | null>(null);
  let passkeyOk = $state<string | null>(null);

  // --- device transfer -----------------------------------------------------
  let transferBusy = $state(false);
  let transferError = $state<string | null>(null);
  let transfer = $state<{ code: string; pin: string } | null>(null);
  let copied = $state(false);

  // --- push notifications --------------------------------------------------
  const pushSupported = isPushSupported();
  let pushStatus = $state<PushStatus | null>(null);
  let pushBusy = $state(false);
  let pushError = $state<string | null>(null);

  async function refreshPush(): Promise<void> {
    if (!pushSupported) return;
    pushStatus = await getPushStatus();
  }

  async function enablePush(): Promise<void> {
    pushError = null;
    pushBusy = true;
    try {
      const res = await subscribePush(stored?.displayName ?? $t('push.deviceLabel'));
      if (!res.ok) {
        pushError =
          res.reason === 'denied'
            ? $t('push.permissionDenied')
            : res.reason === 'not-configured'
              ? $t('push.notConfigured')
              : res.reason === 'unsupported'
                ? $t('push.unsupported')
                : $t('push.enableFailed');
      }
      await refreshPush();
    } finally {
      pushBusy = false;
    }
  }

  async function disablePush(): Promise<void> {
    pushError = null;
    pushBusy = true;
    try {
      await unsubscribePush();
      await refreshPush();
    } finally {
      pushBusy = false;
    }
  }

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    stored = (await loadIdentity()) ?? null;
    if (passkeySupported) passkeys = await listPasskeys();
    await refreshPush();
  });

  function handleLock(): void {
    lock();
    api.setToken(null);
    void goto('/login/');
  }

  async function addPasskey(): Promise<void> {
    passkeyError = passkeyOk = null;
    const sess = getSession();
    if (!sess) return;
    passkeyBusy = true;
    try {
      await crypto.ready();
      await registerPasskey({
        identity: sess.identity,
        userId: crypto.fromBase64(sess.keyId),
        userName: stored?.displayName ?? sess.keyId.slice(0, 12),
        label: navigator.platform || $t('passkey.thisDevice'),
      });
      passkeys = await listPasskeys();
      passkeyOk = $t('passkey.registered');
    } catch (err) {
      passkeyError =
        err instanceof PasskeyError && err.code === 'prf-unsupported'
          ? $t('passkey.prfUnsupported')
          : err instanceof PasskeyError && err.code === 'cancelled'
            ? $t('passkey.cancelled')
            : $t('passkey.registerFailed');
    } finally {
      passkeyBusy = false;
    }
  }

  async function removePasskey(credentialId: string): Promise<void> {
    passkeyError = passkeyOk = null;
    await deletePasskey(credentialId);
    passkeys = await listPasskeys();
  }

  async function startTransfer(): Promise<void> {
    transferError = null;
    copied = false;
    const sess = getSession();
    if (!sess || !stored) return;
    transferBusy = true;
    try {
      transfer = await createTransfer({
        role: sess.role,
        orgId: sess.orgId,
        ...(sess.helperId !== undefined ? { helperId: sess.helperId } : {}),
        displayName: stored.displayName,
        publicIdentity: stored.publicIdentity,
        wrappedSecret: stored.wrappedSecret,
        ...(stored.orgInfo ? { orgInfo: stored.orgInfo } : {}),
      });
    } catch {
      transferError = $t('device.createFailed');
    } finally {
      transferBusy = false;
    }
  }

  function cancelTransfer(): void {
    transfer = null;
    copied = false;
  }

  async function copyCode(): Promise<void> {
    if (!transfer) return;
    try {
      await navigator.clipboard.writeText(transfer.code);
      copied = true;
    } catch {
      /* clipboard blocked — the code is still selectable on screen */
    }
  }
</script>

<section class="mx-auto max-w-xl space-y-6">
  <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('profile.title')}</h1>

  <!-- Identity card -->
  <div class="card flex items-center gap-4">
    <Avatar name={stored?.displayName} size={56} />
    <div class="min-w-0">
      <div class="truncate text-lg font-semibold text-fg">{stored?.displayName ?? '—'}</div>
      <div class="mt-1">
        {#if $session.role}
          <Badge tone="brand">{$t(`roles.${$session.role}`)}</Badge>
        {:else}
          <span class="text-muted">—</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Details -->
  <dl class="card space-y-4">
    <div class="flex items-center justify-between gap-4">
      <dt class="text-muted">{$t('profile.displayName')}</dt>
      <dd class="font-medium text-fg">{stored?.displayName ?? '—'}</dd>
    </div>
    <div class="border-t border-line"></div>
    <div class="flex items-center justify-between gap-4">
      <dt class="text-muted">{$t('profile.role')}</dt>
      <dd class="font-medium text-fg">
        {$session.role ? $t(`roles.${$session.role}`) : '—'}
      </dd>
    </div>
    <div class="border-t border-line"></div>
    <div class="flex items-center justify-between gap-4">
      <dt class="shrink-0 text-muted">{$t('profile.orgId')}</dt>
      <dd class="truncate font-mono text-sm text-muted">{$session.orgId ?? '—'}</dd>
    </div>
    <div class="border-t border-line"></div>
    <div class="flex items-start justify-between gap-4">
      <dt class="shrink-0 text-muted">{$t('profile.keyId')}</dt>
      <dd class="break-all text-right font-mono text-xs text-muted">{$session.keyId ?? '—'}</dd>
    </div>
  </dl>

  <!-- Darstellung & Sprache: UI language + glove/large-font display mode. -->
  <div class="card space-y-5">
    <div>
      <h2 class="flex items-center gap-2 font-semibold text-fg">
        <Icon name="monitor" size={18} />
        {$t('settings.title')}
      </h2>
      <p class="mt-1 text-sm text-subtle">{$t('settings.subtitle')}</p>
    </div>

    <!-- Language selector (all 7 locales, native names) -->
    <div class="space-y-2">
      <label class="field-label" for="ui-language">{$t('settings.language')}</label>
      <select
        id="ui-language"
        class="field-input"
        value={$locale}
        onchange={(e) => setLocale(e.currentTarget.value as Locale)}
      >
        {#each SUPPORTED_LOCALES as loc (loc)}
          <option value={loc}>{LOCALE_NAMES[loc]}</option>
        {/each}
      </select>
      <p class="text-xs text-subtle">{$t('settings.languageHint')}</p>
    </div>

    <div class="border-t border-line"></div>

    <!-- Glove / large-font display mode -->
    <div class="flex items-start justify-between gap-4">
      <label class="min-w-0 flex-1" for="display-glove">
        <span class="block font-medium text-fg">{$t('settings.displayGlove')}</span>
        <span class="mt-1 block text-xs text-subtle">{$t('settings.displayGloveHint')}</span>
      </label>
      <input
        id="display-glove"
        type="checkbox"
        role="switch"
        class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong text-brand focus:ring-brand"
        checked={$displayMode === 'glove'}
        onchange={(e) => setDisplayMode(e.currentTarget.checked ? 'glove' : 'normal')}
      />
    </div>
  </div>

  <!-- Signature-on-file: owned by the signature agent. Placeholder slot. -->
  <div class="rounded-2xl border border-dashed border-line-strong p-5">
    <div class="font-medium text-fg">{$t('profile.signatureOnFile')}</div>
    <p class="mt-1 text-sm text-subtle">{$t('profile.signaturePlaceholder')}</p>
  </div>

  <!-- Passkey unlock (this device). Hidden entirely when unsupported. -->
  {#if passkeySupported}
    <div class="card space-y-4">
      <div>
        <h2 class="font-semibold text-fg">{$t('passkey.title')}</h2>
        <p class="mt-1 text-sm text-subtle">{$t('passkey.intro')}</p>
      </div>

      {#if passkeys.length > 0}
        <ul class="space-y-2">
          {#each passkeys as pk (pk.credentialId)}
            <li
              class="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2"
            >
              <span class="flex min-w-0 items-center gap-2">
                <Icon name="shield-check" size={18} />
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-fg">{pk.label}</span>
                  <span class="block text-xs text-subtle"
                    >{new Date(pk.createdAt).toLocaleDateString()}</span
                  >
                </span>
              </span>
              <button
                type="button"
                class="btn-ghost min-h-touch px-2 text-danger"
                aria-label={$t('passkey.remove')}
                onclick={() => void removePasskey(pk.credentialId)}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-muted">{$t('passkey.none')}</p>
      {/if}

      {#if passkeyError}<p class="field-error" role="alert">{passkeyError}</p>{/if}
      {#if passkeyOk}<p class="text-sm font-medium text-ok">{passkeyOk}</p>{/if}

      <button
        type="button"
        class="btn-secondary w-full"
        disabled={passkeyBusy}
        onclick={() => void addPasskey()}
      >
        <Icon name="plus" size={18} />
        {passkeyBusy ? $t('passkey.registering') : $t('passkey.add')}
      </button>
    </div>
  {/if}

  <!-- Multi-device onboarding: hand this identity to another device. -->
  <div class="card space-y-4">
    <div>
      <h2 class="font-semibold text-fg">{$t('device.transferTitle')}</h2>
      <p class="mt-1 text-sm text-subtle">{$t('device.transferIntro')}</p>
    </div>

    {#if !transfer}
      {#if transferError}<p class="field-error" role="alert">{transferError}</p>{/if}
      <button
        type="button"
        class="btn-secondary w-full"
        disabled={transferBusy}
        onclick={() => void startTransfer()}
      >
        <Icon name="monitor" size={18} />
        {transferBusy ? $t('device.creating') : $t('device.addAnotherDevice')}
      </button>
    {:else}
      <div class="flex flex-col items-center gap-4">
        <QrCode value={transfer.code} />

        <div class="w-full rounded-xl border border-line bg-surface-2 p-3">
          <div class="mb-1 text-xs font-medium text-muted">{$t('device.code')}</div>
          <p class="break-all font-mono text-xs text-fg">{transfer.code}</p>
        </div>

        <button type="button" class="btn-ghost w-full" onclick={() => void copyCode()}>
          <Icon name="copy" size={18} />
          {copied ? $t('device.copied') : $t('device.copyCode')}
        </button>

        <!-- PIN shown SEPARATELY (out-of-band) from the code/QR. -->
        <div class="w-full rounded-xl border border-warning/40 bg-warning-soft/40 p-3 text-center">
          <div class="text-xs font-medium text-warning-fg">{$t('device.pinLabel')}</div>
          <div class="mt-1 font-mono text-2xl font-semibold tracking-[0.3em] text-fg">
            {transfer.pin}
          </div>
          <p class="mt-1 text-xs text-warning-fg">{$t('device.pinHint')}</p>
        </div>

        <button type="button" class="btn-ghost w-full" onclick={cancelTransfer}>
          <Icon name="x" size={18} />
          {$t('common.close')}
        </button>
      </div>
    {/if}
  </div>

  <!-- Benachrichtigungen: enable/disable web push (operational alerts only). -->
  {#if pushSupported}
    <div class="card space-y-4">
      <div>
        <h2 class="flex items-center gap-2 font-semibold text-fg">
          <Icon name="activity" size={18} />
          {$t('push.title')}
        </h2>
        <p class="mt-1 text-sm text-subtle">{$t('push.intro')}</p>
        <p class="mt-2 rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">
          {$t('push.privacyNote')}
        </p>
      </div>

      {#if pushStatus && !pushStatus.serverConfigured}
        <p class="text-sm text-muted">{$t('push.notConfigured')}</p>
      {:else if pushStatus?.permission === 'denied'}
        <p class="field-error" role="alert">{$t('push.permissionDenied')}</p>
      {:else}
        <p class="text-sm font-medium {pushStatus?.subscribed ? 'text-ok' : 'text-muted'}">
          {pushStatus?.subscribed ? $t('push.enabled') : $t('push.disabled')}
        </p>
        {#if pushError}<p class="field-error" role="alert">{pushError}</p>{/if}
        {#if pushStatus?.subscribed}
          <button
            type="button"
            class="btn-secondary w-full"
            disabled={pushBusy}
            onclick={() => void disablePush()}
          >
            <Icon name="x" size={18} />
            {pushBusy ? $t('push.working') : $t('push.disable')}
          </button>
        {:else}
          <button
            type="button"
            class="btn-secondary w-full"
            disabled={pushBusy}
            onclick={() => void enablePush()}
          >
            <Icon name="activity" size={18} />
            {pushBusy ? $t('push.working') : $t('push.enable')}
          </button>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Sicherheit: auto-lock, lock-on-background, local device wipe. -->
  <div class="card space-y-5">
    <div>
      <h2 class="flex items-center gap-2 font-semibold text-fg">
        <Icon name="shield" size={18} />
        {$t('security.title')}
      </h2>
      <p class="mt-1 text-sm text-subtle">{$t('security.intro')}</p>
    </div>

    <!-- Inactivity auto-lock -->
    <div class="space-y-2">
      <label class="field-label" for="auto-lock-timeout">{$t('security.autoLock')}</label>
      <select
        id="auto-lock-timeout"
        class="field-input"
        value={$securitySettings.idleMinutes}
        onchange={(e) => setIdleMinutes(Number(e.currentTarget.value) as IdleMinutes)}
      >
        {#each IDLE_OPTIONS as m (m)}
          <option value={m}>{idleLabel(m)}</option>
        {/each}
      </select>
      <p class="text-xs text-subtle">{$t('security.autoLockHint')}</p>
    </div>

    <div class="border-t border-line"></div>

    <!-- Lock on background -->
    <div class="flex items-start justify-between gap-4">
      <label class="min-w-0 flex-1" for="lock-on-background">
        <span class="block font-medium text-fg">{$t('security.lockOnBackground')}</span>
        <span class="mt-1 block text-xs text-subtle">{$t('security.lockOnBackgroundHint')}</span>
      </label>
      <input
        id="lock-on-background"
        type="checkbox"
        role="switch"
        class="mt-1 h-5 w-5 shrink-0 rounded border-line-strong text-brand focus:ring-brand"
        checked={$securitySettings.lockOnBackground}
        onchange={(e) => setLockOnBackground(e.currentTarget.checked)}
      />
    </div>
  </div>

  <!-- Danger zone: offboard this device. -->
  <div class="card space-y-3 border-danger/40">
    <div>
      <h2 class="flex items-center gap-2 font-semibold text-danger">
        <Icon name="alert" size={18} />
        {$t('security.danger')}
      </h2>
      <p class="mt-1 text-sm text-subtle">{$t('security.dangerHint')}</p>
    </div>
    <button type="button" class="btn-danger w-full" onclick={() => (wipeOpen = true)}>
      <Icon name="trash" size={18} />
      {$t('security.wipeAction')}
    </button>
  </div>

  <button type="button" class="btn-danger w-full" onclick={handleLock}>
    <Icon name="lock" size={18} />
    {$t('profile.lockNow')}
  </button>
</section>

<Modal
  open={wipeOpen}
  title={$t('security.wipeConfirmTitle')}
  onClose={() => {
    if (!wiping) wipeOpen = false;
  }}
>
  <div class="space-y-3 text-sm">
    <p class="text-fg">{$t('security.wipeWarning')}</p>
    <p class="rounded-xl border border-warning/40 bg-warning-soft/40 p-3 text-warning-fg">
      {$t('security.wipeUnsyncedWarning')}
    </p>
    <p class="text-subtle">{$t('security.wipeIrreversible')}</p>
  </div>
  {#snippet footer()}
    <button type="button" class="btn-ghost" disabled={wiping} onclick={() => (wipeOpen = false)}>
      {$t('common.cancel')}
    </button>
    <button type="button" class="btn-danger" disabled={wiping} onclick={() => void confirmWipe()}>
      <Icon name="trash" size={18} />
      {wiping ? $t('security.wiping') : $t('security.wipeConfirm')}
    </button>
  {/snippet}
</Modal>
