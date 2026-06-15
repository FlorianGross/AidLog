<!--
  Verstaendigungshilfe.svelte — standalone communication aid.

  Independent of the intake flow: the responder picks a patient language and the
  panel shows common emergency phrases (pictogram + German label + translated
  phrase) so they can point at / read out a phrase to a foreign-language patient.

  Arabic renders RTL. Non-German locales are MACHINE-DRAFTED (banner shown).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Icon } from '$lib/ui';
  import { AID_PHRASES, INTAKE_LANGS, LANG_LABELS, isMachineDrafted, phrasesFor } from './phrases';
  import { isRtl, type IntakeLang } from './types';

  interface Props {
    /** Initial patient language; defaults to English. */
    lang?: IntakeLang;
  }
  let { lang = 'en' }: Props = $props();

  // `lang` only seeds the initial selection; the picker below drives `selected`.
  const initialLang = untrack(() => lang);
  let selected = $state<IntakeLang>(initialLang);
  const phrases = $derived(phrasesFor(selected));
  const rtl = $derived(isRtl(selected));
</script>

<div class="space-y-4">
  <!-- Language picker (responder-facing, German labels) -->
  <div>
    <span class="field-label">Sprache der Patientin / des Patienten</span>
    <div class="flex flex-wrap gap-2">
      {#each INTAKE_LANGS as l (l)}
        <button
          type="button"
          aria-pressed={selected === l}
          class={`flex min-h-touch items-center gap-2 rounded-xl border px-4 text-base transition-colors ${
            selected === l
              ? 'border-line-strong bg-brand-soft text-brand-soft-fg'
              : 'border-line bg-surface-1 text-fg hover:bg-surface-2'
          }`}
          onclick={() => (selected = l)}
        >
          <span aria-hidden="true">{LANG_LABELS[l].flag}</span>
          <span>{LANG_LABELS[l].endonym}</span>
        </button>
      {/each}
    </div>
  </div>

  {#if isMachineDrafted(selected)}
    <p class="badge-warning w-full justify-start rounded-xl px-3 py-2 text-sm">
      <Icon name="alert" size={16} />
      Maschinell übersetzt – fachliche Prüfung ausstehend. Im Zweifel professionelle Dolmetschung hinzuziehen.
    </p>
  {/if}

  <!-- Phrase cards -->
  <ul class="grid gap-3 sm:grid-cols-2">
    {#each AID_PHRASES as item (item.key)}
      <li class="tile flex items-start gap-3">
        <span class="text-2xl leading-none" aria-hidden="true">{item.icon}</span>
        <div class="min-w-0 flex-1">
          <p class="text-sm text-muted">{item.de}</p>
          <p class="mt-1 text-lg font-medium text-fg" lang={selected} dir={rtl ? 'rtl' : 'ltr'}>
            {phrases[item.key]}
          </p>
        </div>
      </li>
    {/each}
  </ul>
</div>
