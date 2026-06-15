<!--
  deployment/[id]/setup/+page.svelte — VERANSTALTUNGS-STAMMDATEN bearbeiten.

  Optionale, NICHT-SENSIBLE Stammdaten einer Veranstaltung (Ort, Zeitraum, Art,
  erwartete Besucherzahl, Veranstalter, Einsatzleiter). Sie werden LOKAL PRO
  GERÄT auf der DeploymentMeta gespeichert (keine Server-Synchronisation) — siehe
  Hinweis unten. Enthält bewusst KEINE Patienten-/Gesundheitsdaten.

  Erreichbar aus dem Einsatz-Header. Speichert über updateDeploymentMeta().
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { session, getDeployment, updateDeploymentMeta, type DeploymentMeta } from '$lib/store';
  import { Icon, Spinner } from '$lib/ui';

  const deploymentId = $derived($page.params.id ?? '');

  let meta = $state<DeploymentMeta | undefined>(undefined);
  let loading = $state(true);
  let saving = $state(false);
  let status = $state<string | null>(null);

  // Form fields (separate from meta so we can edit before saving).
  let ort = $state('');
  let beginn = $state('');
  let ende = $state('');
  let veranstaltungsart = $state('');
  let erwarteteBesucher = $state<number | null>(null);
  let veranstalter = $state('');
  let einsatzleiterName = $state('');

  /** Convert an ISO-8601 string to the value a <input type="datetime-local"> wants. */
  function isoToLocalInput(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // datetime-local expects "YYYY-MM-DDTHH:mm" in LOCAL time.
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /** Convert a datetime-local value back to an ISO-8601 string (or undefined). */
  function localInputToIso(local: string): string | undefined {
    if (!local) return undefined;
    const d = new Date(local);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  onMount(async () => {
    if (!$session.unlocked) {
      await goto('/login/');
      return;
    }
    meta = await getDeployment(deploymentId);
    if (meta) {
      ort = meta.ort ?? '';
      beginn = isoToLocalInput(meta.beginn);
      ende = isoToLocalInput(meta.ende);
      veranstaltungsart = meta.veranstaltungsart ?? '';
      erwarteteBesucher = meta.erwarteteBesucher ?? null;
      veranstalter = meta.veranstalter ?? '';
      einsatzleiterName = meta.einsatzleiterName ?? '';
    }
    loading = false;
  });

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    saving = true;
    status = null;
    try {
      const besucher =
        erwarteteBesucher != null && Number.isFinite(erwarteteBesucher) && erwarteteBesucher >= 0
          ? Math.round(erwarteteBesucher)
          : undefined;
      const patch: Partial<DeploymentMeta> = {
        ort: ort.trim() || undefined,
        beginn: localInputToIso(beginn),
        ende: localInputToIso(ende),
        veranstaltungsart: veranstaltungsart.trim() || undefined,
        erwarteteBesucher: besucher,
        veranstalter: veranstalter.trim() || undefined,
        einsatzleiterName: einsatzleiterName.trim() || undefined,
      };
      meta = await updateDeploymentMeta(deploymentId, patch);
      status = `${$t('common.save')} ✓`;
    } catch {
      status = $t('errors.generic');
    } finally {
      saving = false;
    }
  }
</script>

<section class="mx-auto max-w-2xl space-y-6">
  <header class="space-y-1">
    <div class="flex items-center gap-2">
      <span class="text-brand"><Icon name="clipboard" size={24} /></span>
      <h1 class="text-2xl font-semibold tracking-tight text-fg">
        {$t('veranstaltung.setupTitle')}
      </h1>
    </div>
    <p class="text-muted">{meta?.title ?? deploymentId}</p>
  </header>

  <nav class="flex flex-wrap gap-2 print:hidden">
    <a class="btn-ghost px-3 text-sm" href={`/deployment/${deploymentId}/`}>
      <Icon name="arrow-left" size={18} />{$t('common.back')}
    </a>
  </nav>

  {#if loading}
    <div class="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-4">
      <Spinner />
      <p class="text-sm text-muted">{$t('common.loading')}</p>
    </div>
  {:else}
    <p class="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
      {$t('veranstaltung.localNote')}
    </p>

    <form class="card space-y-4" onsubmit={save}>
      <div>
        <label class="field-label" for="vs-ort">{$t('veranstaltung.ort')}</label>
        <input id="vs-ort" class="field-input" bind:value={ort} maxlength="200" />
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="field-label" for="vs-beginn">{$t('veranstaltung.beginn')}</label>
          <input id="vs-beginn" class="field-input" type="datetime-local" bind:value={beginn} />
        </div>
        <div>
          <label class="field-label" for="vs-ende">{$t('veranstaltung.ende')}</label>
          <input id="vs-ende" class="field-input" type="datetime-local" bind:value={ende} />
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="field-label" for="vs-art">{$t('veranstaltung.art')}</label>
          <input
            id="vs-art"
            class="field-input"
            bind:value={veranstaltungsart}
            maxlength="120"
            placeholder={$t('veranstaltung.artPlaceholder')}
          />
        </div>
        <div>
          <label class="field-label" for="vs-besucher"
            >{$t('veranstaltung.erwarteteBesucher')}</label
          >
          <input
            id="vs-besucher"
            class="field-input"
            type="number"
            min="0"
            step="1"
            bind:value={erwarteteBesucher}
          />
        </div>
      </div>

      <div>
        <label class="field-label" for="vs-veranstalter">{$t('veranstaltung.veranstalter')}</label>
        <input id="vs-veranstalter" class="field-input" bind:value={veranstalter} maxlength="200" />
      </div>

      <div>
        <label class="field-label" for="vs-el">{$t('veranstaltung.einsatzleiter')}</label>
        <input id="vs-el" class="field-input" bind:value={einsatzleiterName} maxlength="200" />
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button type="submit" class="btn-primary px-5" disabled={saving}>
          <Icon name="check" size={18} />
          {$t('common.save')}
        </button>
        {#if status}
          <p class="text-sm text-muted" aria-live="polite">{status}</p>
        {/if}
      </div>
    </form>
  {/if}
</section>
