<!--
  SelfIntakeKiosk.svelte — guided, large-touch, kiosk patient self-intake.

  The responder starts this and hands the device to the patient. The flow:
    1. Language picker (patient-facing endonyms).
    2. A small set of SAMPLER history questions, one per step, large touch
       targets, in the chosen language. Arabic renders RTL.
    3. A summary / thank-you step with "Fertig" (commit) and "Abbrechen".

  On "Fertig" the parent receives:
    - a SelfIntakeRecord (raw answers + chosen language) to store under the
      `selbstauskunft` payload key, AND
    - a prefill patch for the protocol `values` (the responder reviews/edits).

  This component RENDERS FULL-SCREEN over the editor (kiosk chrome) — the parent
  hides the responder UI while it is active. It holds no crypto; persistence is
  the parent editor's job (rides the encrypted draft).

  Non-German patient strings are MACHINE-DRAFTED (see phrases.ts).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Icon } from '$lib/ui';
  import { INTAKE_LANGS, LANG_LABELS, isMachineDrafted, phrasesFor } from './phrases';
  import {
    isRtl,
    prefillFromAnswers,
    type IntakeLang,
    type SelfIntakeAnswers,
    type SelfIntakeRecord,
  } from './types';

  interface Props {
    /** Existing answers to resume from (e.g. re-opening to edit). */
    initial?: SelfIntakeRecord | null;
    /** Commit: raw record + the prefill patch for the protocol `values`. */
    onfinish: (record: SelfIntakeRecord, prefill: Record<string, unknown>) => void;
    /** Abort without committing. */
    oncancel: () => void;
  }
  let { initial = null, onfinish, oncancel }: Props = $props();

  // step 0 = language picker; steps 1..N = questions; last = summary.
  type StepId =
    | 'hauptbeschwerde'
    | 'schmerz'
    | 'schmerzLokalisation'
    | 'allergien'
    | 'medikamente'
    | 'vorerkrankungen'
    | 'letzteMahlzeit'
    | 'schwangerschaft'
    | 'summary';

  const QUESTION_STEPS: StepId[] = [
    'hauptbeschwerde',
    'schmerz',
    'schmerzLokalisation',
    'allergien',
    'medikamente',
    'vorerkrankungen',
    'letzteMahlzeit',
    'schwangerschaft',
    'summary',
  ];

  // Seed local state from the `initial` prop ONCE (kiosk is mounted fresh each
  // time it opens, so an init-only seed is exactly the intended behaviour).
  const seed = untrack(() => initial);
  let lang = $state<IntakeLang>(seed?.lang ?? 'de');
  let langChosen = $state<boolean>(seed != null);
  let stepIndex = $state(0);
  let answers = $state<SelfIntakeAnswers>({ ...(seed?.answers ?? {}) });

  const p = $derived(phrasesFor(lang));
  const rtl = $derived(isRtl(lang));
  const step = $derived(QUESTION_STEPS[stepIndex]);
  // Skip the NRS detail when the patient reported no pain.
  const skipNrs = $derived(answers.schmerzVorhanden === 'nein');

  function setAnswer<K extends keyof SelfIntakeAnswers>(key: K, value: SelfIntakeAnswers[K]): void {
    answers = { ...answers, [key]: value };
  }

  function next(): void {
    if (stepIndex < QUESTION_STEPS.length - 1) stepIndex += 1;
  }
  function back(): void {
    if (stepIndex > 0) stepIndex -= 1;
    else langChosen = false;
  }

  function chooseLang(l: IntakeLang): void {
    lang = l;
    langChosen = true;
    stepIndex = 0;
  }

  function finish(): void {
    const record: SelfIntakeRecord = {
      version: 1,
      lang,
      answers,
      completedAt: new Date().toISOString(),
    };
    onfinish(record, prefillFromAnswers(answers));
  }

  const totalSteps = $derived(QUESTION_STEPS.length);
  const progressPct = $derived(Math.round(((stepIndex + 1) / totalSteps) * 100));
</script>

<!-- Full-screen kiosk overlay; sits above the editor chrome. -->
<div
  class="fixed inset-0 z-[60] flex flex-col overflow-y-auto bg-surface"
  dir={rtl ? 'rtl' : 'ltr'}
  {lang}
  role="dialog"
  aria-modal="true"
>
  <!-- Minimal kiosk header: progress + cancel (responder takeover). -->
  <header class="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
    <span class="text-sm font-semibold uppercase tracking-wide text-subtle">Selbstauskunft</span>
    {#if langChosen}
      <div class="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          class="h-full rounded-full bg-brand transition-all"
          style={`width:${progressPct}%`}
        ></div>
      </div>
    {:else}
      <span class="flex-1"></span>
    {/if}
    <button type="button" class="btn-ghost px-3 text-sm" onclick={oncancel}>
      <Icon name="x" size={18} />
      {p.cancel}
    </button>
  </header>

  <main class="mx-auto w-full max-w-xl flex-1 px-4 py-6">
    {#if !langChosen}
      <!-- Language picker -->
      <h1 class="mb-2 text-center text-2xl font-semibold text-fg">{p.chooseLanguage}</h1>
      <p class="mb-6 text-center text-sm text-muted">
        Bitte wählen Sie Ihre Sprache · Choose your language
      </p>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {#each INTAKE_LANGS as l (l)}
          <button
            type="button"
            class="flex min-h-[4rem] items-center gap-3 rounded-2xl border border-line-strong bg-surface-1 px-5 text-left text-xl font-medium text-fg hover:bg-surface-2 active:scale-[0.99]"
            onclick={() => chooseLang(l)}
          >
            <span class="text-2xl" aria-hidden="true">{LANG_LABELS[l].flag}</span>
            <span>{LANG_LABELS[l].endonym}</span>
          </button>
        {/each}
      </div>
    {:else}
      {#if isMachineDrafted(lang)}
        <p
          class="badge-warning mb-4 w-full justify-start rounded-xl px-3 py-2 text-sm"
          dir={rtl ? 'rtl' : 'ltr'}
        >
          <Icon name="alert" size={16} />
          <span>Machine-translated · maschinell übersetzt</span>
        </p>
      {/if}

      <!-- Question / summary card -->
      <div class="card min-h-[16rem]">
        {#if step === 'hauptbeschwerde'}
          {#if stepIndex === 0}
            <p class="mb-4 text-base text-muted">{p.intro}</p>
          {/if}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qHauptbeschwerde}</h2>
          <textarea
            class="field-input min-h-[6rem] py-3"
            rows="3"
            dir={rtl ? 'rtl' : 'ltr'}
            value={answers.hauptbeschwerde ?? ''}
            oninput={(e) => setAnswer('hauptbeschwerde', e.currentTarget.value)}
          ></textarea>
        {:else if step === 'schmerz'}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qSchmerzVorhanden}</h2>
          <div class="mb-6 flex gap-3">
            <button
              type="button"
              aria-pressed={answers.schmerzVorhanden === 'ja'}
              class={`flex min-h-[3.5rem] flex-1 items-center justify-center rounded-2xl border text-lg font-medium ${
                answers.schmerzVorhanden === 'ja'
                  ? 'border-line-strong bg-brand text-brand-fg'
                  : 'border-line-strong bg-surface-1 text-fg'
              }`}
              onclick={() => setAnswer('schmerzVorhanden', 'ja')}
            >
              {p.yes}
            </button>
            <button
              type="button"
              aria-pressed={answers.schmerzVorhanden === 'nein'}
              class={`flex min-h-[3.5rem] flex-1 items-center justify-center rounded-2xl border text-lg font-medium ${
                answers.schmerzVorhanden === 'nein'
                  ? 'border-line-strong bg-brand text-brand-fg'
                  : 'border-line-strong bg-surface-1 text-fg'
              }`}
              onclick={() => setAnswer('schmerzVorhanden', 'nein')}
            >
              {p.no}
            </button>
          </div>

          {#if answers.schmerzVorhanden === 'ja'}
            <h3 class="mb-3 text-lg font-medium text-fg">{p.qSchmerzSkala}</h3>
            <div class="grid grid-cols-6 gap-2 sm:grid-cols-11" dir="ltr">
              {#each Array.from({ length: 11 }, (_, i) => i) as n (n)}
                <button
                  type="button"
                  aria-pressed={answers.schmerzNrs === n}
                  class={`flex min-h-[3rem] items-center justify-center rounded-xl border text-lg font-semibold tabular-nums ${
                    answers.schmerzNrs === n
                      ? 'border-line-strong bg-brand text-brand-fg'
                      : 'border-line bg-surface-1 text-fg'
                  }`}
                  onclick={() => setAnswer('schmerzNrs', n)}
                >
                  {n}
                </button>
              {/each}
            </div>
            <div class="mt-2 flex justify-between text-xs text-subtle" dir="ltr">
              <span>0 · {p.schmerzNone}</span>
              <span>10 · {p.schmerzWorst}</span>
            </div>
          {/if}
        {:else if step === 'schmerzLokalisation'}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qSchmerzLokalisation}</h2>
          <input
            type="text"
            class="field-input"
            dir={rtl ? 'rtl' : 'ltr'}
            value={answers.schmerzLokalisation ?? ''}
            oninput={(e) => setAnswer('schmerzLokalisation', e.currentTarget.value)}
          />
        {:else if step === 'allergien'}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qAllergien}</h2>
          <input
            type="text"
            class="field-input"
            dir={rtl ? 'rtl' : 'ltr'}
            value={answers.allergien ?? ''}
            oninput={(e) => setAnswer('allergien', e.currentTarget.value)}
          />
        {:else if step === 'medikamente'}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qMedikamente}</h2>
          <textarea
            class="field-input min-h-[5rem] py-3"
            rows="2"
            dir={rtl ? 'rtl' : 'ltr'}
            value={answers.medikamente ?? ''}
            oninput={(e) => setAnswer('medikamente', e.currentTarget.value)}
          ></textarea>
        {:else if step === 'vorerkrankungen'}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qVorerkrankungen}</h2>
          <textarea
            class="field-input min-h-[5rem] py-3"
            rows="2"
            dir={rtl ? 'rtl' : 'ltr'}
            value={answers.vorerkrankungen ?? ''}
            oninput={(e) => setAnswer('vorerkrankungen', e.currentTarget.value)}
          ></textarea>
        {:else if step === 'letzteMahlzeit'}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qLetzteMahlzeit}</h2>
          <input
            type="text"
            class="field-input"
            dir={rtl ? 'rtl' : 'ltr'}
            value={answers.letzteMahlzeit ?? ''}
            oninput={(e) => setAnswer('letzteMahlzeit', e.currentTarget.value)}
          />
        {:else if step === 'schwangerschaft'}
          <h2 class="mb-4 text-xl font-semibold text-fg">{p.qSchwangerschaft}</h2>
          <div class="flex flex-col gap-3">
            {#each [{ v: 'ja', label: p.yes }, { v: 'nein', label: p.no }, { v: 'unbekannt', label: p.unknown }, { v: 'na', label: p.skip }] as opt (opt.v)}
              <button
                type="button"
                aria-pressed={answers.schwangerschaft === opt.v}
                class={`flex min-h-[3.5rem] items-center justify-center rounded-2xl border text-lg font-medium ${
                  answers.schwangerschaft === opt.v
                    ? 'border-line-strong bg-brand text-brand-fg'
                    : 'border-line-strong bg-surface-1 text-fg'
                }`}
                onclick={() =>
                  setAnswer('schwangerschaft', opt.v as SelfIntakeAnswers['schwangerschaft'])}
              >
                {opt.label}
              </button>
            {/each}
          </div>
        {:else if step === 'summary'}
          <div class="flex flex-col items-center text-center">
            <span class="mb-3 text-4xl" aria-hidden="true">✅</span>
            <h2 class="text-xl font-semibold text-fg">{p.thanks}</h2>
          </div>
        {/if}
      </div>

      <!-- Navigation -->
      <div class="mt-6 flex items-center justify-between gap-3">
        <button type="button" class="btn-secondary px-6 text-lg" onclick={back}>
          {p.back}
        </button>
        {#if step === 'summary'}
          <button type="button" class="btn-primary px-8 text-lg" onclick={finish}>
            <Icon name="check" size={20} />
            {p.finish}
          </button>
        {:else}
          <div class="flex gap-2">
            <button type="button" class="btn-ghost px-5 text-base" onclick={next}>{p.skip}</button>
            <button
              type="button"
              class="btn-primary px-8 text-lg"
              onclick={() => {
                // From the pain step: if no pain, jump past the localisation step.
                if (step === 'schmerz' && skipNrs) {
                  setAnswer('schmerzNrs', undefined);
                  stepIndex += 2;
                } else {
                  next();
                }
              }}
            >
              {p.next}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </main>
</div>
