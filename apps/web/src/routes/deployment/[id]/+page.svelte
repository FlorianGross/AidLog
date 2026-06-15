<!--
  deployment/[id]/+page.svelte — TABBED ABCDE/SAMPLER documentation editor.

  Layout:
   - Sticky header: deployment name + overall completeness + actions
     (Entwurf speichern · Dokumentation abschließen).
   - LEFT in-page drawer: one entry per schema section (badge + title +
     per-section completeness ring). Collapses behind a button on mobile.
   - Main pane: the active section's fields, rendered by SectionForm (which
     supports text/textarea/number/select/multiselect/boolean/date/time/
     datetime/scale/signature).

  Persistence: the in-progress payload (+ captured signature images) is
  auto-saved as an ENCRYPTED draft in IndexedDB (doc/draftStore — ciphertext
  only, DEK self-sealed to the local identity; drafts never leave the device).

  Finalize: validates required fields, builds the immutable signed ProtocolRecord
  (DEK → encrypt payload + signature blobs → seal DEK to ORG [+ helper while
  shift open] → prevHash → hash → Ed25519 sign), enqueues to the outbox, marks
  the local draft finalised, then offers co-signature.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n';
  import { activeSchema, loadActiveSchema } from '$lib/schemas/store';
  import type { DocSchema } from '$lib/schemas/types';
  import {
    categories,
    loadCategories,
    categoryById,
    schemaForCategory,
    CATEGORY_ID_KEY,
  } from '$lib/categories';
  import SectionForm from '$lib/doc/SectionForm.svelte';
  import RequestCosign from '$lib/cosign/RequestCosign.svelte';
  import { overallProgress, sectionProgress, missingRequired } from '$lib/doc/completeness';
  import {
    loadDraft,
    saveDraft,
    markDraftFinalized,
    type Draft,
    type DraftSignature,
    type DraftPhotoEntry,
  } from '$lib/doc/draftStore';
  import { finalizeDraft } from '$lib/doc/finalize';
  import { loadSupervisors } from '$lib/supervisors';
  import { QuickEntry } from '$lib/quickentry';
  import { isLeadOrAdmin, ownQualification } from '$lib/store';
  import { getSession } from '$lib/crypto';
  import {
    getChainHead,
    getDeployment,
    getOrgInfo,
    bumpDeploymentCount,
    flush,
    type DeploymentMeta,
  } from '$lib/store';
  import { api } from '$lib/api';
  import { Icon, Badge } from '$lib/ui';
  import type { ProtocolRecord } from '@aidlog/contracts';
  import { VitalTrendEditor, ScorePanel } from '$lib/vitals';
  import { VITALVERLAUF_KEY, asReadings, type VitalReading } from '$lib/vitals/types';
  import { gcsFromSubscores } from '$lib/vitals/indicators';
  import { BodyMapPhotoEditor } from '$lib/bodymap';
  import { BODYMAP_KEY, asMarkers, type BodyMarker, type DraftPhoto } from '$lib/bodymap/types';
  import { ResusPanel, ResusLogView } from '$lib/resus';
  import { REANIMATION_KEY, asResusLog, type ResusLog } from '$lib/resus/types';
  import { ConsentPanel, ConsentView } from '$lib/consent';
  import {
    EINWILLIGUNG_KEY,
    asConsentRecord,
    consentSigField,
    type ConsentRecord,
  } from '$lib/consent/types';
  import {
    PrintRecord,
    triggerPrint,
    type PrintRecordData,
    HandoverPrint,
    type HandoverPrintData,
    toFhirBundle,
    toDiviDataset,
    downloadJson,
  } from '$lib/export';
  import { SelfIntakeKiosk, Verstaendigungshilfe } from '$lib/selfintake';
  import {
    SELFINTAKE_KEY,
    asSelfIntakeRecord,
    LANG_LABELS,
    isMachineDrafted,
    type SelfIntakeRecord,
  } from '$lib/selfintake';
  import { EcgPanel, EcgView, EKG_KEY, asEcgRecord, ecgItemCount, type EcgRecord } from '$lib/ecg';

  const deploymentId = $derived($page.params.id ?? '');

  // Dedicated (non-schema) panels appended to the section drawer.
  const VITALS_TAB = '__vitals__';
  const BODYMAP_TAB = '__bodymap__';
  const RESUS_TAB = '__resus__';
  const CONSENT_TAB = '__consent__';
  const SELFINTAKE_TAB = '__selfintake__';
  const ECG_TAB = '__ecg__';

  // Special (non-schema) tab keys, so we can tell them from schema sections.
  const SPECIAL_TABS = new Set<string>([
    VITALS_TAB,
    BODYMAP_TAB,
    RESUS_TAB,
    CONSENT_TAB,
    SELFINTAKE_TAB,
    ECG_TAB,
  ]);

  let meta = $state<DeploymentMeta | undefined>(undefined);

  // The protocol schema is loaded DYNAMICALLY. For a deployment created under a
  // protocol CATEGORY we render that category's OWN schema; `schemaForCategory`
  // falls back to the org-active schema and then the ABCDE default when the
  // category has no schema. OLD deployments (no `categoryId`) resolve to the
  // org-active / ABCDE default — backward compatible, never breaks a draft.
  // Reading `$categories` / `$activeSchema` keeps this reactive to admin edits.
  const deploymentCategory = $derived(
    $categories.length > 0 ? categoryById(meta?.categoryId) : undefined,
  );
  // `schemaForCategory` reads the current category schema, falling back to the
  // org-active schema (passed explicitly so this derived depends on it and
  // re-resolves if an admin swaps the org template) and finally ABCDE.
  const schema = $derived<DocSchema>(schemaForCategory(deploymentCategory, $activeSchema));

  // Empty until the schema effect picks the first section (or a user taps a tab).
  let activeKey = $state('');
  let drawerOpen = $state(false);
  // "Zusatzmodule" group in the drawer: collapsed by default to keep the core
  // ABCDE/SAMPLER flow front-and-centre. Auto-opens when an extra module is the
  // active tab (e.g. after a deep link or selecting one), so the selection stays
  // visible without the user re-expanding it.
  let extrasOpen = $state(false);
  let status = $state<string | null>(null);
  let busy = $state(false);
  let finalized = $state(false);
  let finalizedRecord = $state<ProtocolRecord | null>(null);
  let showCosign = $state(false);
  let printing = $state(false);
  // Übergabe (handover) print sheet — materialises only while printing.
  let printingHandover = $state(false);
  // Schnell-Erfassung (quick patient contact) sheet — available to everyone.
  let showQuickEntry = $state(false);

  async function onQuickSaved(): Promise<void> {
    // Refresh local deployment meta so the record count reflects the new contact.
    meta = await getDeployment(deploymentId);
    status = `${$t('quickentry.saved')} ✓`;
  }

  // Working draft state (decrypted, in memory).
  let values = $state<Record<string, unknown>>({});
  // Captured signature images keyed by field key.
  let signatures = $state<Record<string, DraftSignature>>({});
  // Pending record photos (body-map feature).
  let photos = $state<DraftPhotoEntry[]>([]);

  // READ-ONLY gate: a CLOSED deployment (shift ended) OR an already-finalized
  // draft opens schreibgeschützt — no saving, finalizing, or section editing.
  // Past Einsätze opened from "Meine Einsätze" land on the Verlauf view, but if
  // the editor is reached for a closed deployment it must not be editable.
  // Creating NEW deployments and editing OPEN ones is unchanged.
  const closed = $derived(meta?.status === 'closed');
  const readOnly = $derived(finalized || closed);

  const signedFields = $derived(new Set(Object.keys(signatures)));
  const activeSection = $derived(
    schema.sections.find((s) => s.key === activeKey) ?? schema.sections[0],
  );
  const overall = $derived(overallProgress(schema, values, signedFields));

  // If the active schema changes and the current tab no longer exists, fall back
  // to the first section so the drawer + main pane stay consistent.
  $effect(() => {
    if (SPECIAL_TABS.has(activeKey)) return;
    if (!schema.sections.some((s) => s.key === activeKey)) {
      activeKey = schema.sections[0]?.key ?? '';
    }
  });

  // Vital-sign series + body-map markers ride along in `values` (encrypted payload).
  const vitals = $derived(asReadings(values[VITALVERLAUF_KEY]));
  const markers = $derived(asMarkers(values[BODYMAP_KEY]));
  // Resuscitation record rides along under the stable `reanimation` key.
  const resus = $derived(asResusLog(values[REANIMATION_KEY]));
  // Consent / refusal record rides along under the stable `einwilligung` key.
  const consent = $derived<ConsentRecord>(asConsentRecord(values[EINWILLIGUNG_KEY]));
  // Patient self-intake (raw answers + chosen language) rides along under the
  // stable `selbstauskunft` key (E2E-encrypted like every other panel).
  const selfIntake = $derived<SelfIntakeRecord | null>(asSelfIntakeRecord(values[SELFINTAKE_KEY]));
  // 12-lead ECG & device findings ride along under the stable `ekg` key. Strip
  // images are base64 inside this structured value, so they inherit the record's
  // E2E payload encryption + draft persistence (no separate blob/upload path).
  const ecg = $derived<EcgRecord>(asEcgRecord(values[EKG_KEY]));
  // Kiosk overlay: when active, the responder chrome is hidden and the device is
  // handed to the patient.
  let kioskActive = $state(false);
  const suggestedGcs = $derived(
    gcsFromSubscores(values['d_gcs_augen'], values['d_gcs_verbal'], values['d_gcs_motorik']),
  );

  // Dedicated (non-schema) feature panels, grouped under a collapsible
  // "Zusatzmodule" section in the drawer. Each carries its own count badge so
  // nothing is hidden when the group is collapsed.
  const extraTabs = $derived([
    { key: VITALS_TAB, badge: '♥', title: $t('doc.tabVitals'), count: vitals.length },
    {
      key: BODYMAP_TAB,
      badge: '⚑',
      title: $t('doc.tabBodymap'),
      count: markers.length + photos.length,
    },
    { key: ECG_TAB, badge: '〜', title: $t('ecg.tab'), count: ecgItemCount(ecg) },
    { key: RESUS_TAB, badge: '✚', title: $t('resus.tab'), count: resus.events.length },
    { key: CONSENT_TAB, badge: '§', title: $t('consent.tab'), count: consent.items.length },
    {
      key: SELFINTAKE_TAB,
      badge: '🗣',
      title: $t('selfintake.title'),
      count: selfIntake ? 1 : 0,
    },
  ]);
  // Sum of all extra-module indicators, shown on the collapsed group header.
  const extrasCount = $derived(extraTabs.reduce((n, tab) => n + tab.count, 0));

  // Keep the group expanded whenever an extra module is the active tab so the
  // current selection is never hidden behind a collapsed header.
  $effect(() => {
    if (SPECIAL_TABS.has(activeKey)) extrasOpen = true;
  });

  // Print/PDF data (in-memory, already decrypted).
  const printData = $derived<PrintRecordData | null>(
    finalizedRecord
      ? {
          orgName: getOrgInfo()?.orgName,
          deploymentTitle: meta?.title ?? schema.title,
          record: finalizedRecord,
          values,
          vitals,
          markers,
          photos: photos as DraftPhoto[],
          signatures,
          // Author display name is not held in the in-memory session; the print
          // view falls back to the authorKeyId.
          authorName: undefined,
          cosignatures: [],
        }
      : null,
  );

  // Handover (Übergabe) print data — reuses the already-decrypted in-memory
  // record + values; the QR encodes only id + recordHash (no patient data).
  const handoverData = $derived<HandoverPrintData | null>(
    finalizedRecord
      ? {
          orgName: getOrgInfo()?.orgName,
          deploymentTitle: meta?.title ?? schema.title,
          record: finalizedRecord,
          values,
          signatures,
          authorName: undefined,
        }
      : null,
  );

  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  onMount(async () => {
    const s = getSession();
    if (!s) {
      await goto('/login/');
      return;
    }
    // Pull the active protocol schema (org template or default) AND the protocol
    // categories. The `activeSchema` + `categories` subscriptions above keep
    // `schema` in sync afterwards (incl. resolving this deployment's category).
    void loadActiveSchema();
    void loadCategories();
    // Refresh the cached supervisor public keys so records finalized in this
    // editor (full protocol OR quick contact) are sealed to current leads/admins.
    void loadSupervisors();
    meta = await getDeployment(deploymentId);
    const draft = await loadDraft(deploymentId);
    if (draft) {
      values = draft.values;
      signatures = Object.fromEntries(draft.signatures.map((sig) => [sig.field, sig]));
      photos = draft.photos ?? [];
      finalized = draft.finalized;
    }
  });

  function currentDraft(): Draft {
    // Embed the deployment's category id in the payload under a reserved key so it
    // travels END-TO-END (encrypted) with every finalized record — a reader who
    // can decrypt the record learns which category schema produced it, independent
    // of the local DeploymentMeta. Not a DocField, so it never renders as a form
    // field. Omitted entirely for old deployments without a categoryId.
    const catId = meta?.categoryId;
    const payload = catId ? { ...values, [CATEGORY_ID_KEY]: catId } : values;
    return {
      deploymentId,
      schemaId: schema.schemaId,
      schemaVersion: schema.version,
      values: payload,
      signatures: Object.values(signatures),
      photos,
      finalized,
      updatedAt: new Date().toISOString(),
    };
  }

  function scheduleSave(): void {
    if (readOnly) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveDraft(currentDraft()).catch(() => {});
    }, 600);
  }

  function onField(key: string, value: unknown): void {
    values = { ...values, [key]: value };
    scheduleSave();
  }

  function onSignature(key: string, png: Uint8Array | null): void {
    if (png === null) {
      const next = { ...signatures };
      delete next[key];
      signatures = next;
    } else {
      signatures = {
        ...signatures,
        [key]: {
          field: key,
          mediaType: 'image/png',
          data: png,
          capturedAt: new Date().toISOString(),
        },
      };
    }
    scheduleSave();
  }

  function onVitals(next: VitalReading[]): void {
    values = { ...values, [VITALVERLAUF_KEY]: next };
    scheduleSave();
  }

  function onMarkers(next: BodyMarker[]): void {
    values = { ...values, [BODYMAP_KEY]: next };
    scheduleSave();
  }

  function onResus(next: ResusLog): void {
    values = { ...values, [REANIMATION_KEY]: next };
    scheduleSave();
  }

  function onConsent(next: ConsentRecord): void {
    values = { ...values, [EINWILLIGUNG_KEY]: next };
    scheduleSave();
  }

  function onEcg(next: EcgRecord): void {
    values = { ...values, [EKG_KEY]: next };
    scheduleSave();
  }

  // --- Patient self-intake (Selbstauskunft) ---------------------------------
  function startSelfIntake(): void {
    if (readOnly) return;
    kioskActive = true;
  }

  // The kiosk emits the raw record + a prefill patch for the protocol fields.
  // We store the raw answers verbatim under `selbstauskunft` AND merge the
  // prefill into `values` so the responder can review/edit before finalize.
  function onSelfIntakeFinish(record: SelfIntakeRecord, prefill: Record<string, unknown>): void {
    values = { ...values, ...prefill, [SELFINTAKE_KEY]: record };
    kioskActive = false;
    activeKey = SELFINTAKE_TAB;
    scheduleSave();
  }

  function onSelfIntakeCancel(): void {
    kioskActive = false;
  }

  // Object URLs for in-memory consent signature previews (item.id → URL), rebuilt
  // whenever the captured signature bytes change. Revoked on teardown/change so we
  // don't leak. The signature BYTES ride the existing draft signature flow keyed
  // by `consent-sig:<id>`; here we only materialise a preview for the editor.
  let consentSigUrls = $state<Record<string, string>>({});
  $effect(() => {
    const next: Record<string, string> = {};
    for (const item of consent.items) {
      const sig = signatures[consentSigField(item.id)];
      if (sig) {
        next[item.id] = URL.createObjectURL(
          new Blob([sig.data.slice().buffer], { type: sig.mediaType || 'image/png' }),
        );
      }
    }
    consentSigUrls = next;
    return () => {
      for (const url of Object.values(next)) URL.revokeObjectURL(url);
    };
  });

  function onPhotos(next: DraftPhoto[]): void {
    photos = next as DraftPhotoEntry[];
    scheduleSave();
  }

  async function exportPdf(): Promise<void> {
    if (!finalizedRecord) return;
    printing = true;
    // Let <PrintRecord> mount/paint (incl. image object URLs) before printing.
    await new Promise((r) => setTimeout(r, 50));
    triggerPrint();
  }

  async function exportHandover(): Promise<void> {
    if (!finalizedRecord) return;
    printingHandover = true;
    // Let <HandoverPrint> mount/paint (QR + signature images) before printing.
    await new Promise((r) => setTimeout(r, 50));
    triggerPrint();
  }

  // --- Machine-readable, pseudonymized data export (FHIR / DIVI-MIND) -------
  // Pure client-side mapping over the already-decrypted in-memory values; the
  // produced JSON is pseudonymized (no real names / secrets) and triggers a
  // local file download — nothing is sent anywhere. Same finalize gate as the
  // PDF/handover exports above.
  let dataMenuOpen = $state(false);

  function exportFhir(): void {
    if (!finalizedRecord) return;
    const bundle = toFhirBundle({
      values,
      recordId: finalizedRecord.id,
      recordHash: finalizedRecord.recordHash,
      schemaId: schema.schemaId,
      schemaVersion: schema.version,
      exportedAt: new Date().toISOString(),
      training: meta?.training === true,
    });
    downloadJson(`aidlog-fhir-${finalizedRecord.id}.json`, bundle);
    dataMenuOpen = false;
  }

  function exportDivi(): void {
    if (!finalizedRecord) return;
    const dataset = toDiviDataset({
      values,
      recordId: finalizedRecord.id,
      recordHash: finalizedRecord.recordHash,
      schemaId: schema.schemaId,
      schemaVersion: schema.version,
      exportedAt: new Date().toISOString(),
      training: meta?.training === true,
    });
    downloadJson(`aidlog-divi-${finalizedRecord.id}.json`, dataset);
    dataMenuOpen = false;
  }

  function sectionPct(key: string): number {
    const sec = schema.sections.find((s) => s.key === key);
    if (!sec) return 0;
    return Math.round(sectionProgress(sec, values, signedFields).ratio * 100);
  }

  async function saveDraftNow(): Promise<void> {
    if (readOnly) return;
    busy = true;
    status = $t('common.loading');
    try {
      await saveDraft(currentDraft());
      status = `${$t('doc.draft')} · ${$t('common.save')} ✓`;
    } catch {
      status = $t('errors.generic');
    } finally {
      busy = false;
    }
  }

  async function finalize(): Promise<void> {
    if (readOnly || busy) return;
    // HARD finalize gate: required DocFields (+ group minItems) must be present.
    // Honours signature capture via `signedFields`. Quick-entry / journal use
    // separate save paths and are unaffected.
    const missing = missingRequired(schema, values, signedFields);
    if (missing.length > 0) {
      status = `${$t('finalize.gateTitle')} ${$t('finalize.missingFields')}: ${missing
        .map((m) => m.label)
        .join(', ')}`;
      // Jump the editor to the first missing field's section so the user can fix it.
      const firstSection = missing[0]?.sectionKey;
      if (firstSection && schema.sections.some((s) => s.key === firstSection)) {
        activeKey = firstSection;
        drawerOpen = false;
      }
      return;
    }
    if (!confirm($t('doc.finalizeConfirm'))) return;

    busy = true;
    status = $t('common.loading');
    try {
      // Persist latest before finalising.
      await saveDraft(currentDraft());
      const head = await getChainHead(deploymentId);
      const { record } = await finalizeDraft({
        draft: currentDraft(),
        head: head ? { lastSeq: head.lastSeq, lastRecordHash: head.lastRecordHash } : undefined,
        shiftOpen: meta?.status !== 'closed',
        photos,
        training: meta?.training === true,
      });
      await bumpDeploymentCount(deploymentId);
      await markDraftFinalized(deploymentId);
      finalized = true;
      finalizedRecord = record;

      status = navigator.onLine ? $t('common.syncing') : $t('common.offline');
      if (navigator.onLine) {
        try {
          await flush(api);
          status = `${$t('doc.finalized')} ✓`;
        } catch {
          status = `${$t('doc.finalized')} · ${$t('common.offline')}`;
        }
      } else {
        status = `${$t('doc.finalized')} · ${$t('common.queued')}`;
      }
    } catch (err) {
      finalized = false;
      finalizedRecord = null;
      status = err instanceof Error ? err.message : $t('errors.generic');
    } finally {
      busy = false;
    }
  }
</script>

<section class="space-y-4">
  <!-- Sticky header -->
  <header
    class="sticky top-0 z-20 -mx-4 flex flex-col gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-4"
  >
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-center gap-3">
        <button
          type="button"
          class="btn-secondary px-3 text-sm lg:hidden"
          aria-expanded={drawerOpen}
          aria-label={$t('doc.sections')}
          onclick={() => (drawerOpen = !drawerOpen)}
        >
          <Icon name="menu" size={18} />
          <span class="sr-only sm:not-sr-only">{$t('doc.sections')}</span>
        </button>
        <div class="min-w-0">
          <h1 class="flex items-center gap-2 truncate text-xl font-semibold text-fg">
            {#if meta?.training}<Badge tone="warning">{$t('training.badge')}</Badge>{/if}
            <span class="truncate">{meta?.title ?? schema.title}</span>
          </h1>
          <p class="flex flex-wrap items-center gap-2 text-sm text-muted">
            {#if deploymentCategory}
              <span
                class="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium"
                title={deploymentCategory.name}
              >
                <span
                  class="h-2 w-2 rounded-full"
                  style={`background:${deploymentCategory.color || 'var(--color-brand, currentColor)'}`}
                  aria-hidden="true"
                ></span>
                {deploymentCategory.name}
              </span>
            {/if}
            <span>{overall.percent}% · {overall.filled}/{overall.total}</span>
            {#if finalized}<Badge tone="brand">{$t('doc.finalized')}</Badge>{/if}
          </p>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <a href={`/deployment/${deploymentId}/verlauf/`} class="btn-secondary px-4 text-sm">
          <Icon name="clock" size={18} />
          <span class="hidden sm:inline">{$t('verlauf.link')}</span>
        </a>
        <!-- Schnell-Erfassung: quick patient contact (everyone). -->
        <button
          type="button"
          class="btn-secondary px-4 text-sm"
          onclick={() => (showQuickEntry = true)}
        >
          <Icon name="plus" size={18} />
          <span class="hidden sm:inline">{$t('quickentry.action')}</span>
        </button>
        <!-- Einsatztagebuch (everyone may add; reading is gated inside). -->
        <a href={`/deployment/${deploymentId}/tagebuch/`} class="btn-secondary px-4 text-sm">
          <Icon name="clipboard" size={18} />
          <span class="hidden sm:inline">{$t('journal.link')}</span>
        </a>
        <!-- Anwesenheit/Dienst (everyone may self check-in; manage gated inside). -->
        <a href={`/deployment/${deploymentId}/dienst/`} class="btn-secondary px-4 text-sm">
          <Icon name="users" size={18} />
          <span class="hidden sm:inline">{$t('roster.link')}</span>
        </a>
        <!-- Materialverbrauch (everyone may log; remove gated inside). -->
        <a href={`/deployment/${deploymentId}/material/`} class="btn-secondary px-4 text-sm">
          <Icon name="clipboard" size={18} />
          <span class="hidden sm:inline">{$t('material.consumption.link')}</span>
        </a>
        <!-- Veranstaltungs-Stammdaten bearbeiten (lokal pro Gerät, alle). -->
        <a href={`/deployment/${deploymentId}/setup/`} class="btn-secondary px-4 text-sm">
          <Icon name="edit" size={18} />
          <span class="hidden sm:inline">{$t('veranstaltung.editLink')}</span>
        </a>
        <!-- Einsatzstatistik (lead + admin only). -->
        {#if $isLeadOrAdmin}
          <a href={`/deployment/${deploymentId}/statistik/`} class="btn-secondary px-4 text-sm">
            <Icon name="activity" size={18} />
            <span class="hidden sm:inline">{$t('eventstats.link')}</span>
          </a>
        {/if}
        {#if !readOnly}
          <button type="button" class="btn-secondary px-4 text-sm" onclick={startSelfIntake}>
            <Icon name="users" size={18} />
            <span class="hidden sm:inline">{$t('selfintake.start')}</span>
          </button>
          <button
            type="button"
            class="btn-secondary px-4 text-sm"
            disabled={busy}
            onclick={saveDraftNow}
          >
            {$t('doc.saveDraft')}
          </button>
          <button type="button" class="btn-primary px-4 text-sm" disabled={busy} onclick={finalize}>
            {$t('doc.finalize')}
          </button>
        {:else if finalized}
          <button type="button" class="btn-secondary px-4 text-sm" onclick={exportPdf}>
            <Icon name="file-text" size={18} />
            {$t('doc.exportPdf')}
          </button>
          <button type="button" class="btn-secondary px-4 text-sm" onclick={exportHandover}>
            <Icon name="arrow-up-right" size={18} />
            <span class="hidden sm:inline">{$t('handover.print')}</span>
          </button>
          <!-- Machine-readable, pseudonymized data export (FHIR / DIVI-MIND). -->
          <div class="relative">
            <button
              type="button"
              class="btn-secondary px-4 text-sm"
              aria-haspopup="menu"
              aria-expanded={dataMenuOpen}
              onclick={() => (dataMenuOpen = !dataMenuOpen)}
            >
              <Icon name="download" size={18} />
              <span class="hidden sm:inline">{$t('export.dataMenu')}</span>
              <span aria-hidden="true">▾</span>
            </button>
            {#if dataMenuOpen}
              <div
                class="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-1 shadow-lg"
                role="menu"
              >
                <button
                  type="button"
                  class="btn-ghost w-full justify-start px-3 text-sm"
                  role="menuitem"
                  onclick={exportFhir}
                >
                  {$t('export.fhir')}
                </button>
                <button
                  type="button"
                  class="btn-ghost w-full justify-start px-3 text-sm"
                  role="menuitem"
                  onclick={exportDivi}
                >
                  {$t('export.divi')}
                </button>
                <p class="px-3 py-1.5 text-xs text-subtle">{$t('export.pseudonymizedNote')}</p>
              </div>
            {/if}
          </div>
          <button
            type="button"
            class="btn-primary px-4 text-sm"
            onclick={() => (showCosign = true)}
          >
            <Icon name="signature" size={18} />
            {$t('doc.requestCosign')}
          </button>
        {/if}
        <a href="/" class="btn-ghost px-3 text-sm">{$t('common.back')}</a>
      </div>
    </div>

    <!-- Overall completeness bar -->
    <div class="flex items-center gap-3">
      <span class="text-xs font-medium uppercase tracking-wide text-subtle"
        >{$t('doc.overall')}</span
      >
      <div
        class="h-2 flex-1 overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-valuenow={overall.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={$t('doc.completeness')}
      >
        <div
          class="h-full rounded-full bg-brand transition-all"
          style={`width:${overall.percent}%`}
        ></div>
      </div>
      <span class="w-10 text-right text-xs tabular-nums text-muted">{overall.percent}%</span>
    </div>
  </header>

  {#if meta?.training}
    <p
      class="flex items-center gap-2 rounded-xl border border-warning bg-warning-soft px-4 py-2 text-sm font-medium text-warning-fg"
      role="status"
    >
      <Icon name="alert" size={18} />
      {$t('training.banner')}
    </p>
  {/if}

  {#if closed}
    <p
      class="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2 text-sm font-medium text-muted"
      role="status"
    >
      <Icon name="lock" size={18} />
      {$t('myEinsaetze.readOnlyBanner')}
    </p>
  {/if}

  {#if status}
    <p class="rounded-xl bg-brand-soft px-4 py-2 text-sm text-brand-soft-fg" aria-live="polite">
      {status}
    </p>
  {/if}

  <div class="flex gap-4">
    <!-- LEFT section drawer -->
    <nav
      class={`${drawerOpen ? 'block' : 'hidden'} fixed inset-0 z-30 overflow-y-auto bg-surface p-4 lg:static lg:z-auto lg:block lg:w-72 lg:flex-none lg:bg-transparent lg:p-0`}
      aria-label={$t('doc.sections')}
    >
      <div class="mb-3 flex items-center justify-between lg:hidden">
        <span class="text-lg font-semibold text-fg">{$t('doc.sections')}</span>
        <button
          type="button"
          class="btn-ghost min-h-0 rounded-lg p-2"
          aria-label={$t('common.close')}
          onclick={() => (drawerOpen = false)}
        >
          <Icon name="x" size={20} />
        </button>
      </div>
      <ul class="space-y-1">
        {#each schema.sections as sec (sec.key)}
          {@const pct = sectionPct(sec.key)}
          {@const isActive = activeKey === sec.key}
          <li>
            <button
              type="button"
              aria-current={isActive ? 'true' : undefined}
              class={`flex min-h-touch w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                isActive
                  ? 'border-line-strong bg-surface-1'
                  : 'border-transparent hover:bg-surface-2'
              }`}
              onclick={() => {
                activeKey = sec.key;
                drawerOpen = false;
              }}
            >
              <span
                class={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-semibold ${
                  isActive ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-muted'
                }`}
                aria-hidden="true"
              >
                {sec.badge ?? sec.title.slice(0, 1)}
              </span>
              <span class="min-w-0 flex-1">
                <span
                  class={`block truncate text-base font-medium ${isActive ? 'text-fg' : 'text-muted'}`}
                >
                  {sec.title}
                </span>
                <span class="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-surface-3">
                  <span
                    class="block h-full rounded-full bg-brand transition-all"
                    style={`width:${pct}%`}
                  ></span>
                </span>
              </span>
              <span class="flex-none text-xs tabular-nums text-subtle">{pct}%</span>
            </button>
          </li>
        {/each}
      </ul>

      <!-- Zusatzmodule: the dedicated (non-schema) feature panels, grouped under
           a collapsible header so the core ABCDE/SAMPLER flow above stays
           prominent. Collapsed by default; each module keeps its count badge so
           nothing is hidden. Auto-expands when an extra module is active. -->
      <div class="mt-4 border-t border-line pt-3">
        <button
          type="button"
          class="flex min-h-touch w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-2"
          aria-expanded={extrasOpen}
          aria-controls="extra-modules"
          onclick={() => (extrasOpen = !extrasOpen)}
        >
          <span
            class={`flex-none text-subtle transition-transform ${extrasOpen ? 'rotate-90' : ''}`}
          >
            <Icon name="chevron-right" size={18} />
          </span>
          <span class="flex-1 text-xs font-semibold uppercase tracking-wide text-subtle">
            {$t('doc.extraModules')}
          </span>
          {#if extrasCount > 0}
            <span class="flex-none"><Badge tone="muted">{extrasCount}</Badge></span>
          {/if}
        </button>

        {#if extrasOpen}
          <ul id="extra-modules" class="mt-1 space-y-1">
            {#each extraTabs as tab (tab.key)}
              {@const isActive = activeKey === tab.key}
              <li>
                <button
                  type="button"
                  aria-current={isActive ? 'true' : undefined}
                  class={`flex min-h-touch w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-line-strong bg-surface-1'
                      : 'border-transparent hover:bg-surface-2'
                  }`}
                  onclick={() => {
                    activeKey = tab.key;
                    drawerOpen = false;
                  }}
                >
                  <span
                    class={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-sm font-semibold ${
                      isActive ? 'bg-brand text-brand-fg' : 'bg-surface-2 text-muted'
                    }`}
                    aria-hidden="true"
                  >
                    {tab.badge}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span
                      class={`block truncate text-base font-medium ${isActive ? 'text-fg' : 'text-muted'}`}
                    >
                      {tab.title}
                    </span>
                  </span>
                  {#if tab.count > 0}
                    <span class="flex-none"><Badge tone="muted">{tab.count}</Badge></span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </nav>

    <!-- MAIN pane -->
    <main class="min-w-0 flex-1">
      {#if activeKey === VITALS_TAB}
        <div class="card">
          <div class="mb-5 flex items-start gap-3 border-b border-line pb-4">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand-soft-fg"
              aria-hidden="true">♥</span
            >
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-fg">{$t('vitals.title')}</h2>
              <p class="mt-0.5 text-sm text-muted">{$t('vitals.chartTitle')}</p>
            </div>
          </div>
          <VitalTrendEditor
            readings={vitals}
            readonly={readOnly}
            {suggestedGcs}
            onchange={onVitals}
          />
          <div class="mt-6 border-t border-line pt-5">
            <div class="mb-3">
              <h3 class="text-base font-semibold text-fg">{$t('scores.title')}</h3>
              <p class="text-sm text-muted">{$t('scores.subtitle')}</p>
            </div>
            <ScorePanel readings={vitals} {values} />
          </div>
        </div>
      {:else if activeKey === RESUS_TAB}
        <div class="card">
          <div class="mb-5 flex items-start gap-3 border-b border-line pb-4">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-danger-soft text-base font-semibold text-danger-fg"
              aria-hidden="true">✚</span
            >
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-fg">{$t('resus.title')}</h2>
              <p class="mt-0.5 text-sm text-muted">{$t('resus.subtitle')}</p>
            </div>
          </div>
          <ResusPanel log={resus} readonly={readOnly} onchange={onResus} />
        </div>
      {:else if activeKey === BODYMAP_TAB}
        <div class="card">
          <div class="mb-5 flex items-start gap-3 border-b border-line pb-4">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand-soft-fg"
              aria-hidden="true">⚑</span
            >
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-fg">{$t('doc.tabBodymap')}</h2>
              <p class="mt-0.5 text-sm text-muted">{$t('bodymap.tapHint')}</p>
            </div>
          </div>
          <BodyMapPhotoEditor
            {markers}
            photos={photos as DraftPhoto[]}
            readonly={readOnly}
            onmarkers={onMarkers}
            onphotos={onPhotos}
          />
        </div>
      {:else if activeKey === ECG_TAB}
        <div class="card">
          <div class="mb-5 flex items-start gap-3 border-b border-line pb-4">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand-soft-fg"
              aria-hidden="true">〜</span
            >
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-fg">{$t('ecg.title')}</h2>
              <p class="mt-0.5 text-sm text-muted">{$t('ecg.subtitle')}</p>
            </div>
          </div>
          <EcgPanel record={ecg} readonly={readOnly} onchange={onEcg} />
        </div>
      {:else if activeKey === CONSENT_TAB}
        <div class="card">
          <div class="mb-5 flex items-start gap-3 border-b border-line pb-4">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand-soft-fg"
              aria-hidden="true">§</span
            >
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-fg">{$t('consent.title')}</h2>
              <p class="mt-0.5 text-sm text-muted">{$t('consent.subtitle')}</p>
            </div>
          </div>
          <ConsentPanel
            record={consent}
            signaturePreviews={consentSigUrls}
            {values}
            readonly={readOnly}
            onchange={onConsent}
            onsignature={onSignature}
          />
        </div>
      {:else if activeKey === SELFINTAKE_TAB}
        <div class="card">
          <div class="mb-5 flex items-start gap-3 border-b border-line pb-4">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand-soft-fg"
              aria-hidden="true">🗣</span
            >
            <div class="min-w-0 flex-1">
              <h2 class="text-lg font-semibold text-fg">{$t('selfintake.title')}</h2>
              <p class="mt-0.5 text-sm text-muted">{$t('selfintake.subtitle')}</p>
            </div>
            {#if !readOnly}
              <button type="button" class="btn-primary px-4 text-sm" onclick={startSelfIntake}>
                <Icon name="users" size={18} />
                {selfIntake ? $t('selfintake.reopen') : $t('selfintake.start')}
              </button>
            {/if}
          </div>

          <!-- Review of what the patient entered (read-only; edit in Anamnese). -->
          {#if selfIntake}
            <div class="mb-6">
              <h3 class="text-base font-semibold text-fg">{$t('selfintake.review')}</h3>
              <p class="mt-0.5 text-sm text-muted">{$t('selfintake.reviewHint')}</p>
              <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="brand">
                  {LANG_LABELS[selfIntake.lang].flag}
                  {LANG_LABELS[selfIntake.lang].endonym}
                </Badge>
                <span class="text-subtle">
                  {$t('selfintake.completedAt')}: {new Date(selfIntake.completedAt).toLocaleString(
                    'de-DE',
                  )}
                </span>
              </div>
              {#if isMachineDrafted(selfIntake.lang)}
                <p class="badge-warning mt-3 w-full justify-start rounded-xl px-3 py-2 text-sm">
                  <Icon name="alert" size={16} />
                  {$t('selfintake.machineDrafted')}
                </p>
              {/if}
              <dl class="mt-4 grid gap-3 sm:grid-cols-2">
                {#each Object.entries(selfIntake.answers) as [k, v] (k)}
                  {#if v !== undefined && v !== '' && v !== null && v !== 'na'}
                    <div class="tile">
                      <dt class="text-xs uppercase tracking-wide text-subtle">{k}</dt>
                      <dd class="mt-0.5 break-words text-sm text-fg">{String(v)}</dd>
                    </div>
                  {/if}
                {/each}
              </dl>
              <p class="mt-3 text-sm text-ok-fg">
                <Icon name="check" size={14} />
                {$t('selfintake.prefilled')}
              </p>
            </div>
          {:else}
            <p class="mb-6 text-sm text-muted">{$t('selfintake.noAnswers')}</p>
          {/if}

          <!-- Standalone communication aid (Verständigungshilfe). -->
          <div class="border-t border-line pt-5">
            <h3 class="text-base font-semibold text-fg">{$t('selfintake.aidTitle')}</h3>
            <p class="mb-4 text-sm text-muted">{$t('selfintake.aidSubtitle')}</p>
            <Verstaendigungshilfe lang={selfIntake?.lang ?? 'en'} />
          </div>
        </div>
      {:else if activeSection}
        <div class="card">
          <div class="mb-5 flex items-start gap-3 border-b border-line pb-4">
            <span
              class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-brand-soft text-base font-semibold text-brand-soft-fg"
              aria-hidden="true"
            >
              {activeSection.badge ?? activeSection.title.slice(0, 1)}
            </span>
            <div class="min-w-0">
              <h2 class="text-lg font-semibold text-fg">{activeSection.title}</h2>
              {#if activeSection.description}
                <p class="mt-0.5 text-sm text-muted">{activeSection.description}</p>
              {/if}
            </div>
          </div>
          <SectionForm
            section={activeSection}
            {values}
            {signedFields}
            readonly={readOnly}
            userQualification={$ownQualification}
            onchange={onField}
            onsignature={onSignature}
          />
        </div>
      {/if}
    </main>
  </div>

  <!-- Read-only review: surfaces the computed scores + resuscitation log after
       finalize (the print / cosign views may pick these up later). -->
  {#if finalized}
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="card">
        <h2 class="mb-3 text-lg font-semibold text-fg">{$t('scores.title')}</h2>
        <ScorePanel readings={vitals} {values} compact />
      </div>
      <div class="card">
        <h2 class="mb-3 text-lg font-semibold text-fg">{$t('resus.title')}</h2>
        <ResusLogView log={resus} />
      </div>
      <div class="card lg:col-span-2">
        <h2 class="mb-3 text-lg font-semibold text-fg">{$t('ecg.title')}</h2>
        <EcgView record={ecg} />
      </div>
      <div class="card lg:col-span-2">
        <h2 class="mb-3 text-lg font-semibold text-fg">{$t('consent.title')}</h2>
        <ConsentView record={consent} signatureUrls={consentSigUrls} {values} />
      </div>
    </div>
  {/if}
</section>

{#if showCosign && finalizedRecord}
  <RequestCosign record={finalizedRecord} onclose={() => (showCosign = false)} />
{/if}

<!-- Schnell-Erfassung: builds a real signed quick-contact record in this
     deployment (sealed to org + helper + supervisors), independent of the full
     ABCDE draft above. -->
<QuickEntry
  open={showQuickEntry}
  {deploymentId}
  onClose={() => (showQuickEntry = false)}
  onSaved={onQuickSaved}
/>

<!-- Print/PDF render: screen-hidden, materialises only for the print medium. -->
{#if printing && printData}
  <PrintRecord data={printData} />
{/if}

<!-- Übergabe (handover) sheet: screen-hidden, materialises only for printing.
     Carries an integrity-only QR (record id + recordHash; no patient data). -->
{#if printingHandover && handoverData}
  <HandoverPrint data={handoverData} />
{/if}

<!-- Patient self-intake kiosk: full-screen overlay. While active the responder
     chrome above is covered; the patient answers in their language, then the
     responder reviews the prefilled Anamnese fields. -->
{#if kioskActive}
  <SelfIntakeKiosk
    initial={selfIntake}
    onfinish={onSelfIntakeFinish}
    oncancel={onSelfIntakeCancel}
  />
{/if}
