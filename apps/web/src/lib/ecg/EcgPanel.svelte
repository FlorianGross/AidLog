<!--
  EcgPanel.svelte — the "EKG & Gerätebefunde" editor panel.

  Two concerns in one dedicated panel (NOT a generic-schema section):
    1. ECG strips: capture/select one or more 12-lead printout photos. Each is
       downscaled + EXIF-stripped on-device (REUSING $lib/bodymap/photo.ts →
       downscaleImage) and stored base64 inside the encrypted `ekg` payload, so
       it rides the record DEK with the rest of the payload. Tap a thumbnail to
       open the zoom/pan viewer (ECG detail matters).
    2. Structured findings: rhythm, rate, axis, ST change + affected leads
       (multiselect over the 12 leads), QRS width, suspicion (STEMI/NSTEMI/…),
       plus device/defi values: delivered shocks, energy (J), pacing, mode.

  The parent owns persistence: every change emits `onchange(next)` with the full
  EcgRecord; the parent stores it under `values.ekg` and the encrypted draft +
  finalize flow persist it unchanged. Touch-friendly, both themes, tokens only.
-->
<script lang="ts">
  import { crypto } from '@aidlog/crypto-core';
  import { Icon } from '$lib/ui';
  import { t } from '$lib/i18n';
  import { downscaleImage } from '$lib/bodymap/photo';
  import EcgStripThumb from './EcgStripThumb.svelte';
  import {
    ECG_RHYTHMS,
    ECG_AXES,
    ST_CHANGES,
    QRS_WIDTHS,
    ECG_VERDACHTE,
    ECG_LEADS,
    ECG_MODES,
    newEcgId,
    type EcgRecord,
    type EcgRhythm,
    type EcgAxis,
    type StChange,
    type QrsWidth,
    type EcgVerdacht,
    type EcgLead,
    type EcgMode,
    type EcgStrip,
  } from './types';

  interface Props {
    record: EcgRecord;
    readonly?: boolean;
    onchange?: (next: EcgRecord) => void;
  }
  let { record, readonly = false, onchange }: Props = $props();

  let stripBusy = $state(false);
  let stripError = $state<string | null>(null);

  /** Emit a patched record (shallow merge over the current value). */
  function patch(p: Partial<EcgRecord>): void {
    if (readonly) return;
    onchange?.({ ...record, ...p });
  }

  /** Parse a numeric <input> value, mapping empty → undefined. */
  function num(v: string): number | undefined {
    const n = Number(v);
    return v.trim() === '' || Number.isNaN(n) ? undefined : n;
  }

  function toggleLead(lead: EcgLead): void {
    if (readonly) return;
    const cur = record.stLeads ?? [];
    const next = cur.includes(lead) ? cur.filter((l) => l !== lead) : [...cur, lead];
    patch({ stLeads: next });
  }

  async function onStripPick(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file
    if (!file) return;
    stripBusy = true;
    stripError = null;
    try {
      // ECG detail matters: keep a higher longest-edge than body-map photos so a
      // zoomed-in trace stays legible, still downscaled + EXIF-stripped on-device.
      const scaled = await downscaleImage(file, { maxEdge: 2200, quality: 0.85 });
      const strip: EcgStrip = {
        id: newEcgId(),
        mediaType: scaled.mediaType,
        data: crypto.toBase64(scaled.data),
        capturedAt: new Date().toISOString(),
      };
      patch({ strips: [...record.strips, strip] });
    } catch {
      stripError = $t('ecg.stripError');
    } finally {
      stripBusy = false;
    }
  }

  function removeStrip(id: string): void {
    if (readonly) return;
    patch({ strips: record.strips.filter((s) => s.id !== id) });
  }
</script>

<div class="space-y-6">
  <!-- ECG STRIPS -->
  <section class="space-y-3">
    <h3 class="text-base font-semibold text-fg">{$t('ecg.strips')}</h3>

    {#if stripError}
      <p class="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger-fg" role="alert">
        {stripError}
      </p>
    {/if}

    {#if record.strips.length > 0}
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {#each record.strips as s (s.id)}
          <EcgStripThumb
            data={s.data}
            mediaType={s.mediaType}
            onremove={readonly ? undefined : () => removeStrip(s.id)}
          />
        {/each}
      </div>
    {:else}
      <p class="text-sm text-muted">{$t('ecg.noStrips')}</p>
    {/if}

    {#if !readonly}
      <label
        class={`btn-secondary w-full cursor-pointer text-sm ${stripBusy ? 'pointer-events-none opacity-50' : ''}`}
      >
        <Icon name="plus" size={18} />
        {stripBusy ? $t('common.loading') : $t('ecg.addStrip')}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          class="sr-only"
          onchange={onStripPick}
        />
      </label>
      <p class="text-xs text-subtle">{$t('ecg.stripHint')}</p>
    {/if}
  </section>

  <!-- 12-LEAD FINDINGS -->
  <section class="space-y-4 border-t border-line pt-5">
    <h3 class="text-base font-semibold text-fg">{$t('ecg.findings')}</h3>

    <div class="grid gap-4 sm:grid-cols-2">
      <!-- Rhythmus -->
      <label class="block">
        <span class="field-label">{$t('ecg.rhythm.label')}</span>
        <select
          class="field-input"
          disabled={readonly}
          value={record.rhythm ?? ''}
          onchange={(e) =>
            patch({ rhythm: (e.currentTarget.value || undefined) as EcgRhythm | undefined })}
        >
          <option value="">{$t('ecg.none')}</option>
          {#each ECG_RHYTHMS as r (r)}
            <option value={r}>{$t(`ecg.rhythm.${r}`)}</option>
          {/each}
        </select>
      </label>

      <!-- Frequenz -->
      <label class="block">
        <span class="field-label">{$t('ecg.frequenz')}</span>
        <input
          type="number"
          inputmode="numeric"
          min="0"
          max="400"
          class="field-input"
          disabled={readonly}
          value={record.frequenz ?? ''}
          oninput={(e) => patch({ frequenz: num(e.currentTarget.value) })}
        />
      </label>

      <!-- Lagetyp -->
      <label class="block">
        <span class="field-label">{$t('ecg.lagetyp.label')}</span>
        <select
          class="field-input"
          disabled={readonly}
          value={record.lagetyp ?? ''}
          onchange={(e) =>
            patch({ lagetyp: (e.currentTarget.value || undefined) as EcgAxis | undefined })}
        >
          <option value="">{$t('ecg.none')}</option>
          {#each ECG_AXES as a (a)}
            <option value={a}>{$t(`ecg.lagetyp.${a}`)}</option>
          {/each}
        </select>
      </label>

      <!-- QRS-Breite -->
      <label class="block">
        <span class="field-label">{$t('ecg.qrs.label')}</span>
        <select
          class="field-input"
          disabled={readonly}
          value={record.qrsWidth ?? ''}
          onchange={(e) =>
            patch({ qrsWidth: (e.currentTarget.value || undefined) as QrsWidth | undefined })}
        >
          <option value="">{$t('ecg.none')}</option>
          {#each QRS_WIDTHS as q (q)}
            <option value={q}>{$t(`ecg.qrs.${q}`)}</option>
          {/each}
        </select>
      </label>

      <!-- ST-Veränderung -->
      <label class="block">
        <span class="field-label">{$t('ecg.st.label')}</span>
        <select
          class="field-input"
          disabled={readonly}
          value={record.stChange ?? ''}
          onchange={(e) =>
            patch({ stChange: (e.currentTarget.value || undefined) as StChange | undefined })}
        >
          <option value="">{$t('ecg.none')}</option>
          {#each ST_CHANGES as st (st)}
            <option value={st}>{$t(`ecg.st.${st}`)}</option>
          {/each}
        </select>
      </label>

      <!-- Verdacht -->
      <label class="block">
        <span class="field-label">{$t('ecg.verdacht.label')}</span>
        <select
          class="field-input"
          disabled={readonly}
          value={record.verdacht ?? ''}
          onchange={(e) =>
            patch({ verdacht: (e.currentTarget.value || undefined) as EcgVerdacht | undefined })}
        >
          <option value="">{$t('ecg.none')}</option>
          {#each ECG_VERDACHTE as v (v)}
            <option value={v}>{$t(`ecg.verdacht.${v}`)}</option>
          {/each}
        </select>
      </label>
    </div>

    <!-- Betroffene Ableitungen (multiselect) — shown when an ST change is set. -->
    {#if record.stChange && record.stChange !== 'keine'}
      <fieldset class="space-y-2">
        <legend class="field-label">{$t('ecg.st.leads')}</legend>
        <div class="flex flex-wrap gap-1.5" role="group" aria-label={$t('ecg.st.leads')}>
          {#each ECG_LEADS as lead (lead)}
            {@const on = (record.stLeads ?? []).includes(lead)}
            <button
              type="button"
              disabled={readonly}
              aria-pressed={on}
              class={`min-h-touch min-w-[3rem] rounded-lg border px-3 text-sm font-medium tabular-nums transition-colors ${
                on
                  ? 'border-brand bg-brand-soft text-brand-soft-fg'
                  : 'border-line-strong bg-surface-1 text-muted hover:bg-surface-2'
              } ${readonly ? 'cursor-default opacity-70' : ''}`}
              onclick={() => toggleLead(lead)}
            >
              {lead}
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}

    <!-- Bemerkung -->
    <label class="block">
      <span class="field-label">{$t('ecg.bemerkung')}</span>
      <textarea
        rows="2"
        class="field-input"
        disabled={readonly}
        placeholder={$t('ecg.bemerkungPlaceholder')}
        value={record.bemerkung ?? ''}
        oninput={(e) => patch({ bemerkung: e.currentTarget.value || undefined })}
      ></textarea>
    </label>
  </section>

  <!-- DEVICE / DEFI -->
  <section class="space-y-4 border-t border-line pt-5">
    <h3 class="text-base font-semibold text-fg">{$t('ecg.device')}</h3>

    <div class="grid gap-4 sm:grid-cols-2">
      <!-- abgegebene Schocks -->
      <label class="block">
        <span class="field-label">{$t('ecg.shocks')}</span>
        <input
          type="number"
          inputmode="numeric"
          min="0"
          max="99"
          class="field-input"
          disabled={readonly}
          value={record.schocks ?? ''}
          oninput={(e) => patch({ schocks: num(e.currentTarget.value) })}
        />
      </label>

      <!-- Energie (J) -->
      <label class="block">
        <span class="field-label">{$t('ecg.energie')}</span>
        <input
          type="number"
          inputmode="numeric"
          min="0"
          max="400"
          step="10"
          class="field-input"
          disabled={readonly}
          value={record.energie ?? ''}
          oninput={(e) => patch({ energie: num(e.currentTarget.value) })}
        />
      </label>

      <!-- Modus -->
      <label class="block">
        <span class="field-label">{$t('ecg.mode.label')}</span>
        <select
          class="field-input"
          disabled={readonly}
          value={record.modus ?? ''}
          onchange={(e) =>
            patch({ modus: (e.currentTarget.value || undefined) as EcgMode | undefined })}
        >
          <option value="">{$t('ecg.none')}</option>
          {#each ECG_MODES as m (m)}
            <option value={m}>{$t(`ecg.mode.${m}`)}</option>
          {/each}
        </select>
      </label>

      <!-- Schrittmacher (ja/nein) -->
      <div class="block">
        <span class="field-label">{$t('ecg.pacing')}</span>
        <div
          class="inline-flex rounded-xl border border-line-strong bg-surface-1 p-0.5"
          role="group"
          aria-label={$t('ecg.pacing')}
        >
          {#each [{ v: true, k: 'common.yes' }, { v: false, k: 'common.no' }] as opt (opt.k)}
            <button
              type="button"
              disabled={readonly}
              aria-pressed={record.schrittmacher === opt.v}
              class={`min-h-touch rounded-lg px-4 text-sm font-medium transition-colors ${
                record.schrittmacher === opt.v
                  ? 'bg-brand text-brand-fg'
                  : 'text-muted hover:bg-surface-2'
              } ${readonly ? 'cursor-default' : ''}`}
              onclick={() => patch({ schrittmacher: opt.v })}
            >
              {$t(opt.k)}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </section>
</div>
