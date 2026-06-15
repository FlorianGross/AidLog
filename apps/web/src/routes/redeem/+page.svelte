<!--
  redeem/+page.svelte — redeem a single-use invitation code.

  The redeemer enters the code + display name + a chosen password, generates an
  identity on-device, wraps the secret under the password, and POSTs the PUBLIC
  identity + wrapped secret (ROUTES.redeemInvitation). The server returns the new
  account (with its server-assigned role) and the org public info.

  Only ciphertext + public keys leave the device. The password never leaves it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { crypto } from '@aidlog/crypto-core';
  import type { RedeemInvitationRequest } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { adopt, getSession } from '$lib/crypto';
  import { saveIdentity, cacheOrgInfo } from '$lib/store';
  import { api } from '$lib/api';
  import { branding } from '$lib/branding';
  import { Icon } from '$lib/ui';

  let code = $state('');

  // Prefill the code from a shared link, e.g. /redeem?code=ABC123.
  onMount(() => {
    const fromUrl = $page.url.searchParams.get('code');
    if (fromUrl) code = fromUrl.trim();
  });
  let displayName = $state('');
  let password = $state('');
  let password2 = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  function validate(): string | null {
    if (password.length < 10) return $t('auth.passwordTooShort');
    if (password !== password2) return $t('auth.passwordMismatch');
    return null;
  }

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = validate();
    if (error) return;
    busy = true;
    try {
      await crypto.ready();

      // 1. Generate identity + wrap the secret under the chosen password.
      const identity = crypto.generateIdentity();
      const publicIdentity = crypto.toPublicIdentity(identity);
      const wrappedSecret = await crypto.wrapIdentity(identity, password);

      // 2. Redeem the code. The server assigns the role from the invitation.
      const req: RedeemInvitationRequest = {
        code: code.trim(),
        displayName: displayName.trim(),
        identity: publicIdentity,
        wrappedSecret,
      };
      const res = await api.redeemInvitation(req);

      // 3. Persist ONLY the wrapped secret + public identity locally, plus the
      //    cached org public info returned by the server.
      await saveIdentity({
        id: 'self',
        role: res.account.role,
        orgId: res.account.orgId,
        helperId: res.account.helperId,
        publicIdentity,
        wrappedSecret,
        displayName: res.account.displayName,
        orgInfo: res.org,
      });

      // 4. Hold the unwrapped identity in memory; cache the org public identity.
      adopt({
        identity,
        role: res.account.role,
        orgId: res.account.orgId,
        helperId: res.account.helperId,
      });
      cacheOrgInfo(res.org);

      // 5. Authenticate to the server (best-effort).
      const sess = getSession();
      if (sess && navigator.onLine) {
        try {
          await api.authenticate(sess.identity);
        } catch {
          /* proceed; sync handles it later */
        }
      }

      password = password2 = '';
      await goto('/');
    } catch (err) {
      error =
        err instanceof Error
          ? `${$t('auth.redeemFailed')} (${err.message})`
          : $t('auth.redeemFailed');
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
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('auth.redeemTitle')}</h1>
    </div>
  </div>

  <div class="card space-y-6">
    <p class="text-sm text-muted">{$t('auth.redeemIntro')}</p>

    <form class="space-y-4" onsubmit={onSubmit}>
      <div>
        <label class="field-label" for="code">{$t('auth.inviteCode')}</label>
        <input
          id="code"
          class="field-input"
          placeholder={$t('auth.inviteCodePlaceholder')}
          autocomplete="off"
          bind:value={code}
          required
        />
      </div>
      <div>
        <label class="field-label" for="name">{$t('auth.displayName')}</label>
        <input id="name" class="field-input" bind:value={displayName} required />
      </div>
      <div>
        <label class="field-label" for="pw">{$t('auth.choosePassword')}</label>
        <input
          id="pw"
          class="field-input"
          type="password"
          autocomplete="new-password"
          bind:value={password}
          required
        />
      </div>
      <div>
        <label class="field-label" for="pw2">{$t('auth.repeatPassword')}</label>
        <input
          id="pw2"
          class="field-input"
          type="password"
          autocomplete="new-password"
          bind:value={password2}
          required
        />
      </div>
      <p class="text-xs text-subtle">{$t('auth.passwordHint')}</p>

      {#if error}
        <p class="field-error" role="alert">{error}</p>
      {/if}

      <button type="submit" class="btn-primary w-full" disabled={busy}>
        {busy ? $t('auth.redeeming') : $t('auth.redeem')}
      </button>
    </form>
  </div>

  <p class="text-center text-sm text-muted">
    {$t('auth.haveAccount')}
    <a class="font-medium text-brand underline-offset-2 hover:underline" href="/login/"
      >{$t('auth.unlock')}</a
    >
  </p>
</section>
