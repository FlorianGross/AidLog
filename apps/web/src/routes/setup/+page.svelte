<!--
  setup/+page.svelte — first-run ORG setup.

  Generates TWO identities on-device:
   1. the ORG identity   — wrapped under the ORG PASSWORD (org-key custodian),
   2. the first ADMIN's personal identity — wrapped under the ADMIN PASSWORD.

  Registers the org with the server (ROUTES.registerOrg), persists ONLY the
  ADMIN's wrapped secret + public identity locally (the admin is who logs in on
  this device), caches the org public identity for sealing, and signs the admin
  into the session.

  CRITICAL: losing a password loses data — there is no server-side recovery (the
  server cannot decrypt). The org-password-loss warning is surfaced prominently.

  ── BACKEND ASSUMPTION (registerOrg request shape) ──────────────────────────
  The contract `RegisterOrgRequest` today is { orgName, identity, wrappedSecret }
  (the ORG identity only). For an org to have a usable first ADMIN, the server
  must also persist the admin account at creation. We therefore POST an EXTENDED
  body adding `admin: { displayName, identity, wrappedSecret }` and
  `adminRole: 'admin'`. The response is expected to include both `orgId` and the
  admin's `helperId`. If the backend agent finalizes a different shape, only
  `buildRegisterOrgBody()` + the response typing below need to change.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { crypto } from '@aidlog/crypto-core';
  import type { PublicIdentity, OrgPublicInfo, WrappedSecretKey } from '@aidlog/contracts';
  import { t } from '$lib/i18n';
  import { adopt, getSession } from '$lib/crypto';
  import { saveIdentity, cacheOrgInfo } from '$lib/store';
  import { api } from '$lib/api';
  import { branding } from '$lib/branding';
  import { Icon } from '$lib/ui';

  let orgName = $state('');
  let adminName = $state('');
  let orgPassword = $state('');
  let orgPassword2 = $state('');
  let adminPassword = $state('');
  let adminPassword2 = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  function validate(): string | null {
    if (orgPassword.length < 10 || adminPassword.length < 10) return $t('auth.passwordTooShort');
    if (orgPassword !== orgPassword2 || adminPassword !== adminPassword2)
      return $t('auth.passwordMismatch');
    return null;
  }

  /** Build the (assumed-extended) registerOrg body. See file header. */
  function buildRegisterOrgBody(args: {
    orgName: string;
    orgIdentity: PublicIdentity;
    orgWrapped: WrappedSecretKey;
    adminName: string;
    adminIdentity: PublicIdentity;
    adminWrapped: WrappedSecretKey;
  }) {
    return {
      orgName: args.orgName,
      identity: args.orgIdentity,
      wrappedSecret: args.orgWrapped,
      // Admin account provisioned together with the org. The backend always
      // assigns role 'admin' to this bootstrap account, so no role field is sent
      // (the registerOrg schema is strict and rejects unknown keys).
      admin: {
        displayName: args.adminName,
        identity: args.adminIdentity,
        wrappedSecret: args.adminWrapped,
      },
    };
  }

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = validate();
    if (error) return;
    busy = true;
    try {
      await crypto.ready();

      // 1. Generate the ORG identity and the ADMIN's personal identity.
      const orgIdentity = crypto.generateIdentity();
      const orgPublic = crypto.toPublicIdentity(orgIdentity);
      const orgWrapped = await crypto.wrapIdentity(orgIdentity, orgPassword);

      const adminIdentity = crypto.generateIdentity();
      const adminPublic = crypto.toPublicIdentity(adminIdentity);
      const adminWrapped = await crypto.wrapIdentity(adminIdentity, adminPassword);

      // 2. Register the org (+ first admin) with the server. Only ciphertext +
      //    public keys leave the device.
      const body = buildRegisterOrgBody({
        orgName: orgName.trim() || 'Organisation',
        orgIdentity: orgPublic,
        orgWrapped,
        adminName: adminName.trim() || 'Administrator',
        adminIdentity: adminPublic,
        adminWrapped,
      });
      const res = (await api.registerOrg(
        body as unknown as Parameters<typeof api.registerOrg>[0],
      )) as { orgId: string; helperId?: string };
      const orgId = res.orgId;

      // 3. The org secret key is NOT kept on this device beyond registration —
      //    the org password unwraps it only when needed. Wipe it now.
      try {
        orgIdentity.box.secretKey.fill(0);
        orgIdentity.sign.secretKey.fill(0);
      } catch {
        /* buffers may be detached; ignore */
      }

      // 4. Persist ONLY the ADMIN's wrapped secret + public identity locally
      //    (this device logs in AS the admin), plus the cached org public info.
      const orgInfo: OrgPublicInfo = {
        orgId,
        orgName: body.orgName,
        identity: orgPublic,
      };
      await saveIdentity({
        id: 'self',
        role: 'admin',
        orgId,
        ...(res.helperId !== undefined ? { helperId: res.helperId } : {}),
        publicIdentity: adminPublic,
        wrappedSecret: adminWrapped,
        displayName: body.admin.displayName,
        orgInfo,
      });

      // 5. Hold the unwrapped ADMIN identity in memory for this session and
      //    cache the org public identity for sealing.
      adopt({
        identity: adminIdentity,
        role: 'admin',
        orgId,
        ...(res.helperId !== undefined ? { helperId: res.helperId } : {}),
      });
      cacheOrgInfo(orgInfo);

      // 6. Authenticate the admin to the server (best-effort).
      const sess = getSession();
      if (sess && navigator.onLine) {
        try {
          await api.authenticate(sess.identity);
        } catch {
          /* proceed; outbox/sync handles it later */
        }
      }

      orgPassword = orgPassword2 = adminPassword = adminPassword2 = '';
      await goto('/');
    } catch (err) {
      error =
        err instanceof Error
          ? `${$t('auth.registerFailed')} (${err.message})`
          : $t('auth.registerFailed');
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
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('auth.setupTitle')}</h1>
    </div>
  </div>

  <div class="card space-y-6">
    <p class="text-sm text-muted">{$t('auth.setupIntro')}</p>

    <div class="flex gap-3 rounded-xl border border-line bg-warning-soft/40 p-4" role="note">
      <span class="shrink-0 text-warning"><Icon name="alert" size={20} /></span>
      <p class="text-sm text-warning-fg">
        <strong class="font-semibold">{$t('auth.keepPasswordSafe')}</strong>
        {$t('auth.orgLostWarning')}
      </p>
    </div>

    <form class="space-y-5" onsubmit={onSubmit}>
      <div>
        <label class="field-label" for="org-name">{$t('auth.orgName')}</label>
        <input
          id="org-name"
          class="field-input"
          placeholder={$t('auth.orgNamePlaceholder')}
          bind:value={orgName}
          required
        />
      </div>

      <fieldset class="space-y-3 rounded-xl border border-line p-4">
        <legend class="px-1 text-sm font-semibold text-muted">
          {$t('auth.orgPassword')}
        </legend>
        <div>
          <label class="field-label" for="org-pw">{$t('auth.orgPassword')}</label>
          <input
            id="org-pw"
            class="field-input"
            type="password"
            autocomplete="new-password"
            bind:value={orgPassword}
            required
          />
        </div>
        <div>
          <label class="field-label" for="org-pw2">{$t('auth.repeatPassword')}</label>
          <input
            id="org-pw2"
            class="field-input"
            type="password"
            autocomplete="new-password"
            bind:value={orgPassword2}
            required
          />
        </div>
      </fieldset>

      <fieldset class="space-y-3 rounded-xl border border-line p-4">
        <legend class="px-1 text-sm font-semibold text-muted">
          {$t('roles.admin')}
        </legend>
        <div>
          <label class="field-label" for="admin-name">{$t('auth.adminName')}</label>
          <input id="admin-name" class="field-input" bind:value={adminName} required />
        </div>
        <div>
          <label class="field-label" for="admin-pw">{$t('auth.adminPassword')}</label>
          <input
            id="admin-pw"
            class="field-input"
            type="password"
            autocomplete="new-password"
            bind:value={adminPassword}
            required
          />
        </div>
        <div>
          <label class="field-label" for="admin-pw2">{$t('auth.repeatPassword')}</label>
          <input
            id="admin-pw2"
            class="field-input"
            type="password"
            autocomplete="new-password"
            bind:value={adminPassword2}
            required
          />
        </div>
        <p class="text-xs text-subtle">{$t('auth.passwordHint')}</p>
      </fieldset>

      {#if error}
        <p class="field-error" role="alert">{error}</p>
      {/if}

      <button type="submit" class="btn-primary w-full" disabled={busy}>
        {busy ? $t('auth.creatingOrg') : $t('auth.createOrg')}
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
