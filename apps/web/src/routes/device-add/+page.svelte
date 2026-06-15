<!--
  device-add/+page.svelte — onboard THIS (new) device from a transfer code.

  Flow (server-less, offline-capable):
    1. obtain the transfer CODE — scanned from the source device's QR via the
       browser BarcodeDetector if available, else pasted manually,
    2. enter the one-time PIN (shown out-of-band on the source device),
    3. enter the ACCOUNT PASSWORD.
  Then: openTransfer(code, pin) → recover the password-wrapped secret + public
  identity → verifyTransfer(payload, accountPassword) (unwraps to prove the
  password) → persist locally (IndexedDB) → adopt the session → authenticate.

  This route is in AUTH_ROUTES (+layout.svelte) so it renders chrome-free, like
  /login and /setup — it runs before an identity is unlocked on this device.

  SECURITY: PIN + account password live in memory only and are cleared after
  use. Only ciphertext is decrypted here; nothing secret is logged.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { adopt, getSession } from '$lib/crypto';
  import { saveIdentity, cacheOrgInfo } from '$lib/store';
  import { api } from '$lib/api';
  import { branding } from '$lib/branding';
  import { Icon } from '$lib/ui';
  import { openTransfer, verifyTransfer } from '$lib/devicetransfer';

  let code = $state('');
  let pin = $state('');
  let password = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);

  // --- optional camera scanning (BarcodeDetector) --------------------------
  let scanSupported = $state(false);
  let scanning = $state(false);
  let videoEl: HTMLVideoElement | null = $state(null);
  let stream: MediaStream | null = null;
  let rafId = 0;

  onMount(() => {
    scanSupported =
      typeof window !== 'undefined' &&
      'BarcodeDetector' in window &&
      !!navigator.mediaDevices?.getUserMedia;
  });

  onDestroy(() => stopScan());

  async function startScan(): Promise<void> {
    error = null;
    if (!scanSupported) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Detector = (window as any).BarcodeDetector;
      const detector = new Detector({ formats: ['qr_code'] });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      scanning = true;
      // wait a tick for the bound <video> to mount
      await Promise.resolve();
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play();
      }
      const tick = async () => {
        if (!scanning || !videoEl) return;
        try {
          const codes = await detector.detect(videoEl);
          if (codes.length > 0 && codes[0].rawValue) {
            code = codes[0].rawValue as string;
            stopScan();
            return;
          }
        } catch {
          /* transient detect error — keep scanning */
        }
        rafId = requestAnimationFrame(() => void tick());
      };
      rafId = requestAnimationFrame(() => void tick());
    } catch {
      error = $t('device.scanFailed');
      stopScan();
    }
  }

  function stopScan(): void {
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (stream) {
      for (const tr of stream.getTracks()) tr.stop();
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = null;
    busy = true;
    try {
      // 1. PIN-decrypt the transfer code → recover the wrapped secret bundle.
      const payload = await openTransfer(code.trim(), pin);

      // 2. Prove the account password by unwrapping the password-wrapped secret.
      const identity = await verifyTransfer(payload, password);

      // 3. Persist locally (ciphertext only) so future logins use the password.
      await saveIdentity({
        id: 'self',
        role: payload.role,
        orgId: payload.orgId,
        ...(payload.helperId !== undefined ? { helperId: payload.helperId } : {}),
        publicIdentity: payload.publicIdentity,
        wrappedSecret: payload.wrappedSecret,
        displayName: payload.displayName,
        ...(payload.orgInfo ? { orgInfo: payload.orgInfo } : {}),
      });

      // 4. Adopt the live identity into the session + cache org public info.
      adopt({
        identity,
        role: payload.role,
        orgId: payload.orgId,
        ...(payload.helperId !== undefined ? { helperId: payload.helperId } : {}),
      });
      if (payload.orgInfo) cacheOrgInfo(payload.orgInfo);

      // 5. Authenticate to the server (best-effort; offline is fine).
      const sess = getSession();
      if (sess && navigator.onLine) {
        try {
          await api.authenticate(sess.identity);
        } catch {
          /* offline / unreachable — outbox syncs later */
        }
      }

      // Clear the transient secrets from the form.
      pin = '';
      password = '';
      code = '';
      await goto('/');
    } catch (err) {
      error =
        err instanceof Error && err.name === 'TransferError'
          ? $t('device.wrongPin')
          : $t('device.addFailed');
    } finally {
      busy = false;
    }
  }
</script>

<section class="mx-auto w-full max-w-md space-y-6">
  <div class="flex flex-col items-center gap-3 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand">
      <Icon name="monitor" size={30} />
    </span>
    <div>
      <div class="text-sm font-medium text-muted">{branding.appName}</div>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('device.addTitle')}</h1>
    </div>
  </div>

  <div class="card space-y-6">
    <p class="text-sm text-muted">{$t('device.addIntro')}</p>

    {#if scanSupported}
      <div class="space-y-3">
        {#if !scanning}
          <button type="button" class="btn-secondary w-full" onclick={() => void startScan()}>
            <Icon name="eye" size={18} />
            {$t('device.scanQr')}
          </button>
        {:else}
          <div class="overflow-hidden rounded-xl border border-line bg-surface-2">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={videoEl} class="w-full" playsinline></video>
          </div>
          <button type="button" class="btn-ghost w-full" onclick={stopScan}>
            <Icon name="x" size={18} />
            {$t('device.stopScan')}
          </button>
        {/if}
      </div>
    {/if}

    <form class="space-y-4" onsubmit={onSubmit}>
      <div>
        <label class="field-label" for="code">{$t('device.code')}</label>
        <textarea
          id="code"
          class="field-input font-mono text-xs"
          rows="3"
          autocomplete="off"
          spellcheck="false"
          placeholder={$t('device.codePlaceholder')}
          bind:value={code}
          required
        ></textarea>
      </div>

      <div>
        <label class="field-label" for="pin">{$t('device.pin')}</label>
        <input
          id="pin"
          class="field-input font-mono uppercase tracking-widest"
          autocomplete="off"
          autocapitalize="characters"
          bind:value={pin}
          required
        />
      </div>

      <div>
        <label class="field-label" for="pw">{$t('device.accountPassword')}</label>
        <input
          id="pw"
          class="field-input"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          required
        />
        <p class="mt-1 text-xs text-subtle">{$t('device.accountPasswordHint')}</p>
      </div>

      {#if error}
        <p class="field-error" role="alert">{error}</p>
      {/if}

      <button
        type="submit"
        class="btn-primary w-full"
        disabled={busy || !code || !pin || !password}
      >
        {#if !busy}<Icon name="shield-check" size={18} />{/if}
        {busy ? $t('device.adding') : $t('device.addDevice')}
      </button>
    </form>
  </div>

  <p class="text-center text-sm text-muted">
    <a class="font-medium text-brand underline-offset-2 hover:underline" href="/login/"
      >{$t('device.backToLogin')}</a
    >
  </p>
</section>
