<!--
  login/+page.svelte — unlock the local identity with the password.

  The password unwraps the secret key IN MEMORY (via crypto-core) and is then
  discarded. It never reaches the server; auth to the server is a signed
  challenge (proof-of-possession), not the password.

  On a successful online unlock we fetch ROUTES.orgInfo and cache the org public
  identity so the documentation editor can seal DEKs to the org.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { unlock, adopt, getSession } from '$lib/crypto';
  import {
    loadIdentity,
    fetchAndCacheOrgInfo,
    cacheOrgInfo,
    loadOwnQualification,
    type StoredIdentity,
  } from '$lib/store';
  import { api } from '$lib/api';
  import { branding } from '$lib/branding';
  import { Icon } from '$lib/ui';
  import {
    isWebAuthnSupported,
    listPasskeys,
    unlockWithPasskey,
    PasskeyError,
    type StoredPasskey,
  } from '$lib/webauthn';

  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let stored = $state<StoredIdentity | null>(null);

  // Passkey unlock is offered ONLY when WebAuthn is supported AND a passkey
  // wrapper exists on THIS device.
  let passkeys = $state<StoredPasskey[]>([]);
  let passkeyBusy = $state(false);
  const canPasskey = $derived(isWebAuthnSupported() && passkeys.length > 0);

  onMount(async () => {
    stored = (await loadIdentity()) ?? null;
    if (!stored) {
      // No identity on this device yet → offer the onboarding choices
      // (join via invite / add device / create org) instead of forcing setup.
      await goto('/welcome/');
      return;
    }
    if (isWebAuthnSupported()) passkeys = await listPasskeys();
  });

  /** Shared post-unlock flow: cache org info, authenticate, navigate home. */
  async function finishUnlock(): Promise<void> {
    if (stored?.orgInfo) cacheOrgInfo(stored.orgInfo);
    // Seed the cached own-qualification from the local identity so the editor can
    // gate sections offline; refreshed from the server below when online.
    void loadOwnQualification(stored?.qualification ?? null);
    const sess = getSession();
    if (sess && navigator.onLine) {
      try {
        await api.authenticate(sess.identity);
        await fetchAndCacheOrgInfo();
        await loadOwnQualification();
      } catch {
        /* offline or unreachable — proceed; outbox syncs later */
      }
    }
    await goto('/');
  }

  async function onPasskey(): Promise<void> {
    if (!stored) return;
    error = null;
    passkeyBusy = true;
    try {
      const identity = await unlockWithPasskey(passkeys);
      adopt({
        identity,
        role: stored.role,
        orgId: stored.orgId,
        ...(stored.helperId !== undefined ? { helperId: stored.helperId } : {}),
      });
      await finishUnlock();
    } catch (err) {
      error =
        err instanceof PasskeyError && err.code === 'cancelled'
          ? $t('passkey.cancelled')
          : $t('passkey.unlockFailed');
    } finally {
      passkeyBusy = false;
    }
  }

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!stored) return;
    error = null;
    busy = true;
    try {
      await unlock({
        wrapped: stored.wrappedSecret,
        password,
        role: stored.role,
        orgId: stored.orgId,
        ...(stored.helperId !== undefined ? { helperId: stored.helperId } : {}),
      });
      password = '';
      await finishUnlock();
    } catch {
      error = $t('auth.unlockFailed');
    } finally {
      busy = false;
    }
  }
</script>

<section class="mx-auto w-full max-w-md space-y-6">
  <div class="flex flex-col items-center gap-3 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
      <Icon name="activity" size={30} />
    </span>
    <div>
      <div class="text-sm font-medium text-muted">{branding.appName}</div>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('auth.unlockTitle')}</h1>
    </div>
  </div>

  <div class="card space-y-6">
    <p class="text-sm text-muted">{$t('auth.unlockIntro')}</p>

    <form class="space-y-4" onsubmit={onSubmit}>
      <div>
        <label class="field-label" for="pw">{$t('auth.password')}</label>
        <input
          id="pw"
          class="field-input"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
        />
      </div>
      {#if error}
        <p class="field-error" role="alert">{error}</p>
      {/if}
      <button type="submit" class="btn-primary w-full" disabled={busy || !password}>
        {#if !busy}<Icon name="lock" size={18} />{/if}
        {busy ? $t('auth.unlocking') : $t('auth.unlock')}
      </button>
    </form>

    {#if canPasskey}
      <div class="flex items-center gap-3" role="separator">
        <span class="h-px flex-1 bg-line"></span>
        <span class="text-xs text-subtle">{$t('common.or')}</span>
        <span class="h-px flex-1 bg-line"></span>
      </div>
      <button
        type="button"
        class="btn-secondary w-full"
        disabled={passkeyBusy}
        onclick={() => void onPasskey()}
      >
        <Icon name="shield-check" size={18} />
        {passkeyBusy ? $t('passkey.unlocking') : $t('passkey.unlock')}
      </button>
    {/if}
  </div>

  <p class="text-center text-sm text-muted">
    {$t('auth.haveInvite')}
    <a class="font-medium text-brand underline-offset-2 hover:underline" href="/redeem/"
      >{$t('auth.redeemHere')}</a
    >
  </p>

  <p class="text-center text-sm text-muted">
    <a class="font-medium text-brand underline-offset-2 hover:underline" href="/recover/"
      >{$t('auth.orgPasswordLost')}</a
    >
  </p>

  <p class="text-center text-sm text-muted">
    {$t('device.haveAnotherDevice')}
    <a class="font-medium text-brand underline-offset-2 hover:underline" href="/device-add/"
      >{$t('device.addThisDevice')}</a
    >
  </p>
</section>
