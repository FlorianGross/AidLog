<!--
  recover/+page.svelte — perform organisation-key recovery (org password LOST).

  The admin pastes >= T of the issued Shamir shares; each is decoded (a mistyped
  share names its position), the secret is combined and imported, and the
  reconstructed box public key is verified against the org's published key check
  (orgKeyCheck / GET /api/org). On a match the admin sets a NEW org password; the
  identity is re-wrapped and PUT to ROUTES.orgKeyset (ciphertext only).

  SECURITY: the shares, the reconstructed secret and the new password live ONLY
  in this component's state during the operation and are wiped immediately after
  (onDestroy and on success) — never logged, never persisted, never sent to the
  server. A share or secret never crosses the wire; only the new wrappedSecret
  (ciphertext) does.

  An ADMIN SESSION is required: the PUT is authenticated. The org password and
  the personal login are separate concerns — the admin logs in personally, then
  recovers the org key. This is stated in the UI copy below.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import type { IdentityKeyPair } from '@aidlog/crypto-core';
  import { t } from '$lib/i18n';
  import { session } from '$lib/store';
  import { api } from '$lib/api';
  import { branding } from '$lib/branding';
  import {
    reconstructIdentity,
    rewrapIdentity,
    wipeIdentitySecret,
    ShareDecodeError,
    RecoveryMismatchError,
  } from '$lib/recovery';
  import { Icon } from '$lib/ui';

  // Step 1: collect + verify shares.
  let shareTexts = $state<string[]>(['', '', '']);
  let verifying = $state(false);
  let verifyError = $state<string | null>(null);

  // The reconstructed identity (secret material) — memory only, wiped after use.
  let recovered: IdentityKeyPair | null = null;
  let verified = $state(false);

  // Step 2: set a new org password.
  let newPassword = $state('');
  let newPassword2 = $state('');
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  let done = $state(false);

  let expectedKeyCheck = $state<string | null>(null);
  let configError = $state<string | null>(null);

  const loggedIn = $derived($session.unlocked);

  onMount(async () => {
    // Determine the expected key check: prefer recovery metadata, fall back to
    // hashing the published org box public key.
    try {
      const cfg = await api.getRecoveryConfig();
      if (cfg?.orgKeyCheck) {
        expectedKeyCheck = cfg.orgKeyCheck;
        return;
      }
    } catch {
      /* fall through to /api/org */
    }
    try {
      const org = await api.orgInfo();
      const { computeOrgKeyCheck } = await import('$lib/recovery');
      expectedKeyCheck = computeOrgKeyCheck(org.identity.boxPublicKey);
    } catch {
      configError = $t('recovery.noRecoveryConfigured');
    }
  });

  onDestroy(() => wipeAll());

  function wipeAll(): void {
    wipeIdentitySecret(recovered);
    recovered = null;
    shareTexts = shareTexts.map(() => '');
    newPassword = '';
    newPassword2 = '';
  }

  function addShare(): void {
    shareTexts = [...shareTexts, ''];
  }
  function removeShare(i: number): void {
    shareTexts = shareTexts.filter((_, idx) => idx !== i);
  }

  async function onVerify(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    verifyError = null;
    if (!expectedKeyCheck) {
      verifyError = configError ?? $t('recovery.noRecoveryConfigured');
      return;
    }
    verifying = true;
    // Drop any previous reconstruction first.
    wipeIdentitySecret(recovered);
    recovered = null;
    verified = false;
    try {
      const { identity } = await reconstructIdentity({
        shareTexts,
        expectedKeyCheck,
      });
      recovered = identity;
      verified = true;
    } catch (err) {
      if (err instanceof ShareDecodeError) {
        verifyError = $t('recovery.shareInvalid', { position: err.position });
      } else if (err instanceof RecoveryMismatchError) {
        verifyError = $t('recovery.mismatch');
      } else {
        verifyError = $t('recovery.reconstructFailed');
      }
    } finally {
      verifying = false;
    }
  }

  function validatePassword(): string | null {
    if (newPassword.length < 10) return $t('recovery.passwordTooShort');
    if (newPassword !== newPassword2) return $t('recovery.passwordMismatch');
    return null;
  }

  async function onSetPassword(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    saveError = validatePassword();
    if (saveError) return;
    if (!recovered) return;
    if (!loggedIn) {
      saveError = $t('recovery.notLoggedIn');
      return;
    }
    saving = true;
    try {
      const wrappedSecret = await rewrapIdentity({
        identity: recovered,
        newOrgPassword: newPassword,
      });
      await api.updateOrgKeyset({ wrappedSecret });
      done = true;
      // Success: wipe the reconstructed secret + the new password immediately.
      wipeAll();
      verified = false;
    } catch {
      saveError = $t('recovery.saveFailed');
    } finally {
      saving = false;
    }
  }
</script>

<section class="mx-auto w-full max-w-xl space-y-6">
  <div class="flex flex-col items-center gap-3 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
      <Icon name="shield" size={30} />
    </span>
    <div>
      <div class="text-sm font-medium text-muted">{branding.appName}</div>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('recovery.recoverTitle')}</h1>
    </div>
    <p class="max-w-md text-sm text-muted">{$t('recovery.recoverSubtitle')}</p>
  </div>

  {#if done}
    <div class="card space-y-4 text-center">
      <span
        class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-soft text-ok-fg"
      >
        <Icon name="check" size={26} />
      </span>
      <div class="space-y-1">
        <p class="text-lg font-medium text-fg">{$t('recovery.recovered')}</p>
        <p class="text-sm text-muted">{$t('recovery.recoveredHint')}</p>
      </div>
      <a class="btn-primary w-full" href="/login/">{$t('recovery.backToLogin')}</a>
    </div>
  {:else}
    <!-- Admin-session notice -->
    <div class="flex gap-3 rounded-xl border border-line bg-surface-2 p-4">
      <span class="shrink-0 text-brand"><Icon name="alert" size={20} /></span>
      <div class="space-y-2 text-sm">
        <p class="text-fg">{$t('recovery.adminSessionRequired')}</p>
        {#if !loggedIn}
          <p class="font-medium text-warning-fg">{$t('recovery.notLoggedIn')}</p>
          <a class="btn-secondary px-4 text-sm" href="/login/">{$t('recovery.goToLogin')}</a>
        {/if}
      </div>
    </div>

    {#if configError}
      <p class="field-error" role="alert">{configError}</p>
    {/if}

    <!-- Step 1: shares -->
    <section class="card space-y-4">
      <h2 class="text-lg font-semibold text-fg">{$t('recovery.sharesInput')}</h2>
      <form class="space-y-3" onsubmit={onVerify}>
        {#each shareTexts as _s, i (i)}
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <label class="field-label mb-0" for={`share-${i}`}>
                {$t('recovery.shareLabel', { position: i + 1, count: shareTexts.length })}
              </label>
              {#if shareTexts.length > 2}
                <button
                  type="button"
                  class="btn-ghost min-h-0 px-2 py-1 text-xs"
                  onclick={() => removeShare(i)}
                >
                  {$t('recovery.removeShare')}
                </button>
              {/if}
            </div>
            <textarea
              id={`share-${i}`}
              class="field-input min-h-touch font-mono text-sm"
              rows="2"
              placeholder={$t('recovery.sharePlaceholder')}
              autocomplete="off"
              spellcheck="false"
              bind:value={shareTexts[i]}
            ></textarea>
          </div>
        {/each}

        <button type="button" class="btn-ghost px-3 text-sm" onclick={addShare}>
          <Icon name="plus" size={18} />{$t('recovery.addShare')}
        </button>

        {#if verifyError}
          <p class="field-error" role="alert">{verifyError}</p>
        {/if}
        {#if verified}
          <p class="flex items-center gap-1.5 text-sm font-medium text-ok">
            <Icon name="shield-check" size={18} />{$t('recovery.keyVerified')}
          </p>
        {/if}

        <button type="submit" class="btn-primary w-full" disabled={verifying}>
          {verifying ? $t('recovery.reconstructing') : $t('recovery.reconstruct')}
        </button>
      </form>
    </section>

    <!-- Step 2: new password (only after a verified reconstruction) -->
    {#if verified}
      <section class="card space-y-4">
        <h2 class="text-lg font-semibold text-fg">{$t('recovery.setNewPassword')}</h2>
        <form class="space-y-4" onsubmit={onSetPassword}>
          <div>
            <label class="field-label" for="new-pw">{$t('recovery.newOrgPassword')}</label>
            <input
              id="new-pw"
              class="field-input"
              type="password"
              autocomplete="new-password"
              bind:value={newPassword}
              required
            />
          </div>
          <div>
            <label class="field-label" for="new-pw2">{$t('recovery.repeatOrgPassword')}</label>
            <input
              id="new-pw2"
              class="field-input"
              type="password"
              autocomplete="new-password"
              bind:value={newPassword2}
              required
            />
          </div>
          {#if saveError}
            <p class="field-error" role="alert">{saveError}</p>
          {/if}
          <button type="submit" class="btn-primary w-full" disabled={saving || !loggedIn}>
            {#if !saving}<Icon name="lock" size={18} />{/if}
            {saving ? $t('recovery.saving') : $t('recovery.saveNewPassword')}
          </button>
        </form>
      </section>
    {/if}
  {/if}
</section>
