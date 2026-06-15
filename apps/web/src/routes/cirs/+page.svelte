<!--
  cirs/+page.svelte — ANONYMOUS CIRS report submission (any authenticated user).

  A structured-but-free-form German form (Was ist passiert? / Bereich/Kontext /
  Beitragende Faktoren / mögliche Folgen / Verbesserungsvorschlag / ungefährer
  Zeitraum). On submit the content is encrypted ON THIS DEVICE under a fresh DEK,
  the DEK is sealed to the ORG public key ONLY (crypto_box_seal — anonymous
  sender), and the result is POSTed with NO author/submitter/signature. See
  $lib/cirs/submit.ts.

  ANONYMITY is surfaced honestly: strong help text (no patient/personal names),
  an anonymity banner, and — on confirmation — the honest RESIDUAL-anonymity note
  (a malicious operator could still correlate IP/timing of the live request).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { session } from '$lib/store';
  import { ApiClientError } from '$lib/api';
  import { Icon, Badge } from '$lib/ui';
  import { submitCirsReport, type CirsFormPayload } from '$lib/cirs';

  let ereignis = $state('');
  let kontext = $state('');
  let faktoren = $state('');
  let folgen = $state('');
  let vorschlag = $state('');
  let zeitraum = $state('');

  let busy = $state(false);
  let formError = $state<string | null>(null);
  let done = $state(false);

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
    }
  });

  function reset(): void {
    ereignis = '';
    kontext = '';
    faktoren = '';
    folgen = '';
    vorschlag = '';
    zeitraum = '';
    formError = null;
    done = false;
  }

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    formError = null;

    const payload: CirsFormPayload = {};
    if (ereignis.trim()) payload.ereignis = ereignis.trim();
    if (kontext.trim()) payload.kontext = kontext.trim();
    if (faktoren.trim()) payload.faktoren = faktoren.trim();
    if (folgen.trim()) payload.folgen = folgen.trim();
    if (vorschlag.trim()) payload.vorschlag = vorschlag.trim();
    if (zeitraum.trim()) payload.zeitraum = zeitraum.trim();

    // Require at least the core "what happened" content.
    if (!payload.ereignis) {
      formError = $t('cirs.emptyForm');
      return;
    }

    busy = true;
    try {
      await submitCirsReport(payload);
      done = true;
    } catch (err) {
      formError = err instanceof ApiClientError ? $t('cirs.submitFailed') : $t('cirs.submitFailed');
    } finally {
      busy = false;
    }
  }
</script>

<section class="mx-auto max-w-2xl space-y-6">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="alert" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('cirs.title')}</h1>
    </div>
    <p class="text-muted">{$t('cirs.subtitle')}</p>
  </header>

  {#if done}
    <section class="card space-y-4">
      <div class="flex gap-3">
        <span class="shrink-0 text-ok"><Icon name="shield-check" size={22} /></span>
        <div class="space-y-1">
          <h2 class="text-lg font-semibold text-fg">{$t('cirs.confirmTitle')}</h2>
          <p class="text-sm text-muted">{$t('cirs.confirmBody')}</p>
        </div>
      </div>
      <!-- HONEST residual-anonymity caveat. -->
      <p class="rounded-xl border border-line bg-surface-2 p-4 text-xs text-subtle">
        {$t('cirs.confirmResidual')}
      </p>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-secondary px-4 text-sm" onclick={reset}>
          <Icon name="alert" size={18} />{$t('cirs.newReport')}
        </button>
        <a class="btn-ghost px-4 text-sm" href="/">{$t('nav.dashboard')}</a>
      </div>
    </section>
  {:else}
    <!-- Anonymity + privacy banner -->
    <section class="flex gap-3 rounded-xl border border-line bg-surface-2 p-4">
      <span class="shrink-0 text-ok"><Icon name="lock" size={20} /></span>
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <Badge tone="ok">{$t('cirs.anonymityTitle')}</Badge>
        </div>
        <p class="text-sm text-muted">{$t('cirs.intro')}</p>
        <p class="text-sm text-muted">{$t('cirs.anonymityNote')}</p>
        <p class="text-xs text-subtle">{$t('cirs.residualNote')}</p>
      </div>
    </section>

    <!-- No-patient-data warning -->
    <p class="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-fg">
      <span class="shrink-0 text-warning"><Icon name="alert" size={18} /></span>
      <span>{$t('cirs.noPatientWarning')}</span>
    </p>

    <form class="card space-y-5" onsubmit={onSubmit}>
      <div>
        <label class="field-label" for="cirs-ereignis">{$t('cirs.fieldEreignis')}</label>
        <textarea id="cirs-ereignis" class="field-input" rows="4" bind:value={ereignis} required
        ></textarea>
        <p class="mt-1 text-xs text-subtle">{$t('cirs.fieldEreignisHint')}</p>
      </div>

      <div>
        <label class="field-label" for="cirs-kontext">{$t('cirs.fieldKontext')}</label>
        <textarea id="cirs-kontext" class="field-input" rows="2" bind:value={kontext}></textarea>
        <p class="mt-1 text-xs text-subtle">{$t('cirs.fieldKontextHint')}</p>
      </div>

      <div>
        <label class="field-label" for="cirs-faktoren">{$t('cirs.fieldFaktoren')}</label>
        <textarea id="cirs-faktoren" class="field-input" rows="3" bind:value={faktoren}></textarea>
        <p class="mt-1 text-xs text-subtle">{$t('cirs.fieldFaktorenHint')}</p>
      </div>

      <div>
        <label class="field-label" for="cirs-folgen">{$t('cirs.fieldFolgen')}</label>
        <textarea id="cirs-folgen" class="field-input" rows="2" bind:value={folgen}></textarea>
        <p class="mt-1 text-xs text-subtle">{$t('cirs.fieldFolgenHint')}</p>
      </div>

      <div>
        <label class="field-label" for="cirs-vorschlag">{$t('cirs.fieldVorschlag')}</label>
        <textarea id="cirs-vorschlag" class="field-input" rows="3" bind:value={vorschlag}
        ></textarea>
        <p class="mt-1 text-xs text-subtle">{$t('cirs.fieldVorschlagHint')}</p>
      </div>

      <div>
        <label class="field-label" for="cirs-zeitraum">{$t('cirs.fieldZeitraum')}</label>
        <input id="cirs-zeitraum" class="field-input" type="text" bind:value={zeitraum} />
        <p class="mt-1 text-xs text-subtle">{$t('cirs.fieldZeitraumHint')}</p>
      </div>

      {#if formError}
        <p class="field-error" role="alert">{formError}</p>
      {/if}

      <button type="submit" class="btn-primary w-full" disabled={busy}>
        {#if !busy}<Icon name="lock" size={18} />{/if}
        {busy ? $t('cirs.submitting') : $t('cirs.submit')}
      </button>
    </form>
  {/if}
</section>
