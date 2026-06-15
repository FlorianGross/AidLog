<!--
  tools/kraeftebemessung/+page.svelte — KRÄFTEBEMESSUNGS-RECHNER.

  Transparenter Punkte-Rechner in Anlehnung an den Kölner Algorithmus
  (Maurer-Schema). Eingaben (Veranstaltungsart, Besucherzahl, Struktur,
  Verhalten/Alkohol, Witterung, Dauer, Fläche/Zugänglichkeit, gefährdete
  Personen) werden live zu einem Gesamtscore summiert und auf eine Empfehlung
  abgebildet. Die Aufschlüsselung jeder Position ist sichtbar (keine Black-Box).

  ORIENTIERUNGSHILFE — ersetzt KEINE verbindliche Bemessung durch die zuständige
  Behörde/Sanitätseinsatzleitung (siehe Disclaimer unten).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n';
  import { session } from '$lib/store';
  import { Icon } from '$lib/ui';
  import {
    berechneKraefte,
    DEFAULT_INPUT,
    PUNKTE_VERANSTALTUNGSART,
    PUNKTE_BESUCHER,
    PUNKTE_STRUKTUR,
    PUNKTE_VERHALTEN,
    PUNKTE_WITTERUNG,
    PUNKTE_DAUER,
    PUNKTE_FLAECHE,
    PUNKTE_GEFAEHRDETE_PERSONEN,
    type KraefteInput,
  } from '$lib/kraeftebemessung';

  // Live-Eingabezustand (mit sinnvollen Defaults).
  let input = $state<KraefteInput>({ ...DEFAULT_INPUT });

  const ergebnis = $derived(berechneKraefte(input));

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
    }
  });

  // Auswahllisten: Wert + Punktzahl. Labels kommen aus i18n (kraefte.opt.<feld>.<wert>).
  const artOptions = Object.entries(PUNKTE_VERANSTALTUNGSART) as [string, number][];
  const besucherOptions = Object.entries(PUNKTE_BESUCHER) as [string, number][];
  const strukturOptions = Object.entries(PUNKTE_STRUKTUR) as [string, number][];
  const verhaltenOptions = Object.entries(PUNKTE_VERHALTEN) as [string, number][];
  const witterungOptions = Object.entries(PUNKTE_WITTERUNG) as [string, number][];
  const dauerOptions = Object.entries(PUNKTE_DAUER) as [string, number][];
  const flaecheOptions = Object.entries(PUNKTE_FLAECHE) as [string, number][];

  function optLabel(feld: string, wert: string): string {
    return $t(`kraefte.opt.${feld}.${wert}`);
  }
  function posLabel(key: string): string {
    return $t(`kraefte.field.${key}`);
  }
  function stufeLabel(stufe: string): string {
    return $t(`kraefte.stufe.${stufe}`);
  }
</script>

<section class="mx-auto max-w-4xl space-y-6">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="activity" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">{$t('kraefte.title')}</h1>
    </div>
    <p class="text-muted">{$t('kraefte.subtitle')}</p>
  </header>

  <!-- DISCLAIMER: Orientierungshilfe, keine verbindliche Bemessung. -->
  <p
    class="flex items-start gap-2 rounded-xl border border-warning bg-warning-soft px-4 py-3 text-sm text-warning-fg"
    role="note"
  >
    <span class="shrink-0"><Icon name="alert" size={18} /></span>
    <span>{$t('kraefte.disclaimer')}</span>
  </p>

  <div class="grid gap-6 lg:grid-cols-[3fr_2fr]">
    <!-- EINGABE -->
    <form class="card space-y-4">
      <h2 class="text-lg font-semibold text-fg">{$t('kraefte.inputTitle')}</h2>

      <div>
        <label class="field-label" for="kb-art">{$t('kraefte.field.veranstaltungsart')}</label>
        <select id="kb-art" class="field-input" bind:value={input.veranstaltungsart}>
          {#each artOptions as [val, pts] (val)}
            <option value={val}>{optLabel('veranstaltungsart', val)} (+{pts})</option>
          {/each}
        </select>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="field-label" for="kb-besucher">{$t('kraefte.field.besucher')}</label>
          <select id="kb-besucher" class="field-input" bind:value={input.besucher}>
            {#each besucherOptions as [val, pts] (val)}
              <option value={val}>{optLabel('besucher', val)} (+{pts})</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="field-label" for="kb-struktur">{$t('kraefte.field.struktur')}</label>
          <select id="kb-struktur" class="field-input" bind:value={input.struktur}>
            {#each strukturOptions as [val, pts] (val)}
              <option value={val}>{optLabel('struktur', val)} (+{pts})</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="field-label" for="kb-verhalten">{$t('kraefte.field.verhalten')}</label>
          <select id="kb-verhalten" class="field-input" bind:value={input.verhalten}>
            {#each verhaltenOptions as [val, pts] (val)}
              <option value={val}>{optLabel('verhalten', val)} (+{pts})</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="field-label" for="kb-witterung">{$t('kraefte.field.witterung')}</label>
          <select id="kb-witterung" class="field-input" bind:value={input.witterung}>
            {#each witterungOptions as [val, pts] (val)}
              <option value={val}>{optLabel('witterung', val)} (+{pts})</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="field-label" for="kb-dauer">{$t('kraefte.field.dauer')}</label>
          <select id="kb-dauer" class="field-input" bind:value={input.dauer}>
            {#each dauerOptions as [val, pts] (val)}
              <option value={val}>{optLabel('dauer', val)} (+{pts})</option>
            {/each}
          </select>
        </div>
        <div>
          <label class="field-label" for="kb-flaeche">{$t('kraefte.field.flaeche')}</label>
          <select id="kb-flaeche" class="field-input" bind:value={input.flaeche}>
            {#each flaecheOptions as [val, pts] (val)}
              <option value={val}>{optLabel('flaeche', val)} (+{pts})</option>
            {/each}
          </select>
        </div>
      </div>

      <label class="flex items-center gap-3 pt-1">
        <input type="checkbox" class="h-5 w-5" bind:checked={input.gefaehrdetePersonen} />
        <span class="text-sm text-fg">
          {$t('kraefte.field.gefaehrdetePersonen')} (+{PUNKTE_GEFAEHRDETE_PERSONEN})
        </span>
      </label>
    </form>

    <!-- ERGEBNIS -->
    <div class="space-y-4">
      <div class="card space-y-4">
        <h2 class="text-lg font-semibold text-fg">{$t('kraefte.resultTitle')}</h2>

        <div class="flex items-baseline gap-2">
          <span class="text-4xl font-bold tabular-nums text-brand">{ergebnis.score}</span>
          <span class="text-sm text-muted">{$t('kraefte.points')}</span>
        </div>

        <p class="rounded-lg bg-surface-2 px-3 py-2 text-sm font-medium text-fg">
          {$t('kraefte.recommendationLevel')}: {stufeLabel(ergebnis.empfehlung.stufe)}
        </p>

        <dl class="grid grid-cols-1 gap-2 text-sm">
          <div class="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
            <dt class="text-muted">{$t('kraefte.sanitaeter')}</dt>
            <dd class="font-semibold tabular-nums text-fg">{ergebnis.empfehlung.sanitaeter}</dd>
          </div>
          <div class="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
            <dt class="text-muted">{$t('kraefte.rettungsmittel')}</dt>
            <dd class="font-semibold tabular-nums text-fg">{ergebnis.empfehlung.rettungsmittel}</dd>
          </div>
          <div class="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2">
            <dt class="text-muted">{$t('kraefte.arztbesetzteMittel')}</dt>
            <dd class="font-semibold tabular-nums text-fg">
              {ergebnis.empfehlung.arztbesetzteMittel}
            </dd>
          </div>
        </dl>
      </div>

      <!-- TRANSPARENTE AUFSCHLÜSSELUNG -->
      <div class="card space-y-2">
        <h2 class="text-lg font-semibold text-fg">{$t('kraefte.breakdownTitle')}</h2>
        <table class="w-full text-sm">
          <tbody>
            {#each ergebnis.positionen as pos (pos.key)}
              <tr class="border-b border-line last:border-0">
                <td class="py-1.5 pr-2 text-muted">{posLabel(pos.key)}</td>
                <td class="py-1.5 pr-2 text-fg">
                  {pos.key === 'gefaehrdetePersonen'
                    ? $t(`common.${pos.wert === 'ja' ? 'yes' : 'no'}`)
                    : optLabel(pos.key, pos.wert)}
                </td>
                <td class="py-1.5 text-right font-semibold tabular-nums text-fg">+{pos.punkte}</td>
              </tr>
            {/each}
            <tr class="border-t-2 border-line-strong">
              <td class="py-1.5 pr-2 font-semibold text-fg" colspan="2">{$t('kraefte.total')}</td>
              <td class="py-1.5 text-right font-bold tabular-nums text-brand">{ergebnis.score}</td>
            </tr>
          </tbody>
        </table>
        <p class="pt-1 text-xs text-subtle">{$t('kraefte.methodNote')}</p>
      </div>
    </div>
  </div>
</section>
