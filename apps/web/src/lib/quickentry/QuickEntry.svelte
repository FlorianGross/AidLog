<!--
  QuickEntry.svelte — SCHNELL-ERFASSUNG: add a patient contact fast.

  A lightweight Modal form: Uhrzeit (default now), Versorgungsart, Verbleib,
  Altersgruppe, Geschlecht, kurze Beschwerde (+ optional Ersteindruck). On save it
  builds a REAL signed ProtocolRecord in the given deployment via the existing
  finalize path (sealed to org + helper + supervisors, marked
  `schemaId: 'quick-contact'` / `__quick__: true`) and rides the encrypted
  outbox/sync — exactly like a full protocol, but minimal.

  Everyone may use it. It does NOT touch the full ABCDE draft of the deployment.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { Modal, Icon, Spinner, ChipSelect } from '$lib/ui';
  import { saveQuickContact } from './save';
  import {
    VERSORGUNGSART_VALUES,
    VERBLEIB_VALUES,
    ALTERSGRUPPE_VALUES,
    GESCHLECHT_VALUES,
    ERSTEINDRUCK_VALUES,
    type QuickContactInput,
    type Versorgungsart,
  } from './types';

  interface Props {
    open: boolean;
    deploymentId: string;
    onClose: () => void;
    /** Called after a contact is saved (e.g. to refresh counts). */
    onSaved?: (synced: boolean) => void;
  }
  let { open, deploymentId, onClose, onSaved }: Props = $props();

  // Local time HH:MM for the <input type="time">, defaulting to now.
  function nowHHMM(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  let time = $state(nowHHMM());
  let versorgungsart = $state<Versorgungsart>('ambulant');
  let verbleib = $state('vor_ort');
  let altersgruppe = $state('erwachsen');
  let geschlecht = $state('unbekannt');
  let ersteindruck = $state('unauffaellig');
  let beschwerde = $state('');

  let busy = $state(false);
  let error = $state<string | null>(null);

  // Chip option lists (value = stable id, label resolved via i18n). Derived so the
  // labels react to the active locale. Reuses the shared ChipSelect for big,
  // fast-tap targets — same stored values as the previous native <select>s.
  const versorgungsartOptions = $derived(
    VERSORGUNGSART_VALUES.map((v) => ({
      value: v,
      label: $t(`quickentry.versorgungsartValues.${v}`),
    })),
  );
  const verbleibOptions = $derived(
    VERBLEIB_VALUES.map((v) => ({ value: v, label: $t(`quickentry.verbleibValues.${v}`) })),
  );
  const altersgruppeOptions = $derived(
    ALTERSGRUPPE_VALUES.map((v) => ({ value: v, label: $t(`quickentry.altersgruppeValues.${v}`) })),
  );
  const geschlechtOptions = $derived(
    GESCHLECHT_VALUES.map((v) => ({ value: v, label: $t(`quickentry.geschlechtValues.${v}`) })),
  );
  const ersteindruckOptions = $derived(
    ERSTEINDRUCK_VALUES.map((v) => ({ value: v, label: $t(`quickentry.ersteindruckValues.${v}`) })),
  );

  function reset(): void {
    time = nowHHMM();
    versorgungsart = 'ambulant';
    verbleib = 'vor_ort';
    altersgruppe = 'erwachsen';
    geschlecht = 'unbekannt';
    ersteindruck = 'unauffaellig';
    beschwerde = '';
    error = null;
  }

  // Re-seed the time whenever the sheet is (re)opened.
  $effect(() => {
    if (open) time = nowHHMM();
  });

  /** Compose an ISO timestamp for today's date with the chosen HH:MM. */
  function isoFromTime(hhmm: string): string {
    const parts = hhmm.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const d = new Date();
    if (Number.isFinite(h) && Number.isFinite(m)) d.setHours(h, m, 0, 0);
    return d.toISOString();
  }

  async function onSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      const input: QuickContactInput = {
        time: isoFromTime(time),
        versorgungsart,
        verbleib,
        altersgruppe,
        geschlecht,
        beschwerde,
        ersteindruck,
      };
      const { synced } = await saveQuickContact(deploymentId, input);
      onSaved?.(synced);
      reset();
      onClose();
    } catch (err) {
      error = err instanceof Error ? err.message : $t('errors.generic');
    } finally {
      busy = false;
    }
  }
</script>

<Modal {open} title={$t('quickentry.title')} {onClose}>
  <form class="space-y-5" onsubmit={onSubmit}>
    <p class="text-sm text-muted">{$t('quickentry.intro')}</p>

    <!-- Uhrzeit: auto-filled with now; "Jetzt" re-seeds it in one tap. -->
    <div>
      <label class="field-label" for="qe-time">{$t('quickentry.time')}</label>
      <div class="flex items-stretch gap-2">
        <input
          id="qe-time"
          class="field-input min-w-0 flex-1"
          type="time"
          bind:value={time}
          required
        />
        <button
          type="button"
          class="btn-secondary min-h-touch flex-none px-3 text-sm"
          onclick={() => (time = nowHHMM())}
        >
          {$t('formx.now')}
        </button>
      </div>
    </div>

    <div>
      <span class="field-label" id="qe-versorgung">{$t('quickentry.versorgungsart')}</span>
      <ChipSelect
        options={versorgungsartOptions}
        value={versorgungsart}
        ariaLabelledby="qe-versorgung"
        onchange={(v) => (versorgungsart = v as Versorgungsart)}
      />
    </div>

    <div>
      <span class="field-label" id="qe-verbleib">{$t('quickentry.verbleib')}</span>
      <ChipSelect
        options={verbleibOptions}
        value={verbleib}
        ariaLabelledby="qe-verbleib"
        onchange={(v) => (verbleib = v)}
      />
    </div>

    <div>
      <span class="field-label" id="qe-alter">{$t('quickentry.altersgruppe')}</span>
      <ChipSelect
        options={altersgruppeOptions}
        value={altersgruppe}
        ariaLabelledby="qe-alter"
        onchange={(v) => (altersgruppe = v)}
      />
    </div>

    <div>
      <span class="field-label" id="qe-geschlecht">{$t('quickentry.geschlecht')}</span>
      <ChipSelect
        options={geschlechtOptions}
        value={geschlecht}
        ariaLabelledby="qe-geschlecht"
        onchange={(v) => (geschlecht = v)}
      />
    </div>

    <div>
      <span class="field-label" id="qe-ersteindruck">{$t('quickentry.ersteindruck')}</span>
      <ChipSelect
        options={ersteindruckOptions}
        value={ersteindruck}
        ariaLabelledby="qe-ersteindruck"
        onchange={(v) => (ersteindruck = v)}
      />
    </div>

    <div>
      <label class="field-label" for="qe-beschwerde">{$t('quickentry.beschwerde')}</label>
      <input
        id="qe-beschwerde"
        class="field-input"
        type="text"
        autocomplete="off"
        placeholder={$t('quickentry.beschwerdePlaceholder')}
        bind:value={beschwerde}
      />
    </div>

    {#if error}
      <p class="field-error" role="alert">{error}</p>
    {/if}

    <div class="flex justify-end gap-2 pt-1">
      <button type="button" class="btn-ghost px-4" onclick={onClose} disabled={busy}>
        {$t('common.cancel')}
      </button>
      <button type="submit" class="btn-primary px-5" disabled={busy}>
        {#if busy}<Spinner />{:else}<Icon name="check" size={18} />{/if}
        {$t('quickentry.save')}
      </button>
    </div>
  </form>
</Modal>
