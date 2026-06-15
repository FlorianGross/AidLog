<!--
  HandoverPrint.svelte — print-optimised ÜBERGABE (handover) sheet in
  ISOBAR/SAMPLER structure, ready to physically hand to the RTW/Notarzt crew.

  Hidden on screen; visible only when printing (@media print), forced onto clean
  white with explicit print colours regardless of theme (mirrors PrintRecord).

  Contents (one sheet):
    - org / deployment header,
    - the handover sections (Identifikation, Situation, Beobachtung, Anamnese,
      Beurteilung, Empfehlung), rendered read-only from in-memory values with
      select option values mapped back to labels,
    - übergebende + übernehmende Unterschrift (images),
    - a VERIFICATION QR that encodes ONLY record id + recordHash (no patient
      data) so the receiver can verify origin/integrity,
    - an integrity line: author, createdAt, recordHash (mono).

  All data is already decrypted and in memory — nothing leaves the device. The
  user prints and chooses "Save as PDF" or prints on paper.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import { handoverSchema } from '$lib/schemas/handover';
  import type { DocField, DocSection } from '$lib/schemas/types';
  import { encodeQr } from '$lib/devicetransfer/qr';
  import {
    handoverVerifyString,
    mapToHandoverValues,
    handoverMedications,
    handoverTimeline,
    type HandoverPrintData,
  } from './handover';

  interface Props {
    data: HandoverPrintData;
  }
  let { data }: Props = $props();

  const schema = handoverSchema;

  // DIVI/MIND projection: render the ISOBAR/SAMPLER grid from a payload mapped to
  // the handover `h_*` keys (works for ABCDE and native handover records alike).
  const mappedValues = $derived(mapToHandoverValues(data.values));
  // Structured medication list + DIVI timeline are rendered explicitly below.
  const medications = $derived(handoverMedications(data.values));
  const timeline = $derived(handoverTimeline(data.values));

  function fmtTime(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE');
  }

  // --- option-value → label mapping for read-only display -------------------
  function labelFor(field: DocField, value: string): string {
    return field.options?.find((o) => o.value === value)?.label ?? value;
  }

  function display(field: DocField): string {
    const v = mappedValues[field.key];
    if (v === undefined || v === null || v === '') return '—';
    if (field.type === 'boolean') return v ? $t('common.yes') : $t('common.no');
    if (field.type === 'select') return labelFor(field, String(v));
    if (field.type === 'datetime' || field.type === 'date') {
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : d.toLocaleString('de-DE');
    }
    const unit = field.unit ? ` ${field.unit}` : '';
    return `${String(v)}${unit}`;
  }

  function textFields(fields: DocField[]): DocField[] {
    return fields.filter((f) => f.type !== 'signature');
  }

  // Non-signature sections render as field grids; the signature section renders
  // as image pairs below.
  const textSections = $derived<DocSection[]>(
    schema.sections.filter((s) => s.key !== 'unterschriften'),
  );
  const sigFields = $derived<DocField[]>(
    schema.sections
      .find((s) => s.key === 'unterschriften')
      ?.fields.filter((f) => f.type === 'signature') ?? [],
  );

  // --- verification QR (integrity-only: record id + recordHash) -------------
  const verifyString = $derived(handoverVerifyString(data.record));
  const qrMatrix = $derived(encodeQr(verifyString));
  const QUIET = 4;
  const qrDim = $derived(qrMatrix ? qrMatrix.length + QUIET * 2 : 0);
  const qrPath = $derived.by(() => {
    if (!qrMatrix) return '';
    let d = '';
    for (let r = 0; r < qrMatrix.length; r++) {
      for (let c = 0; c < qrMatrix.length; c++) {
        if (qrMatrix[r]![c]) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
      }
    }
    return d;
  });

  // --- in-memory signature image object URLs --------------------------------
  const urls: string[] = [];
  function imgUrl(bytes: Uint8Array, mediaType: string): string {
    const url = URL.createObjectURL(
      new Blob([bytes.slice().buffer], { type: mediaType || 'image/png' }),
    );
    urls.push(url);
    return url;
  }
  onDestroy(() => {
    for (const u of urls) URL.revokeObjectURL(u);
  });

  const createdAt = $derived(new Date(data.record.createdAt).toLocaleString('de-DE'));
</script>

<div class="handover-print" data-print-theme="light">
  <!-- Header -->
  <header class="ho-header">
    <div>
      {#if data.orgName}<p class="ho-org">{data.orgName}</p>{/if}
      <h1 class="ho-title">{$t('handover.title')}</h1>
      <p class="ho-sub">{data.deploymentTitle}</p>
    </div>
    <div class="ho-meta">
      <p>#{data.record.seq}</p>
      <p>{createdAt}</p>
    </div>
  </header>

  <!-- ISOBAR/SAMPLER sections -->
  {#each textSections as sec (sec.key)}
    <section class="ho-section">
      <h2 class="ho-section-title">
        <span class="ho-badge">{sec.badge ?? sec.title.slice(0, 1)}</span>{sec.title}
      </h2>
      <dl class="ho-dl">
        {#each textFields(sec.fields) as field (field.key)}
          <div class={field.span === 2 ? 'ho-dl-full' : ''}>
            <dt>{field.label}</dt>
            <dd>{display(field)}</dd>
          </div>
        {/each}
      </dl>
    </section>
  {/each}

  <!-- Medikamentengabe (strukturierte Liste, DIVI/MIND) -->
  {#if medications.length > 0}
    <section class="ho-section">
      <h2 class="ho-section-title">
        <span class="ho-badge">℞</span>{$t('handover.medications')}
      </h2>
      <table class="ho-med-table">
        <thead>
          <tr>
            <th>{$t('handover.medMittel')}</th>
            <th>{$t('handover.medDosis')}</th>
            <th>{$t('handover.medWeg')}</th>
            <th>{$t('handover.medUhrzeit')}</th>
            <th>{$t('handover.medPerson')}</th>
          </tr>
        </thead>
        <tbody>
          {#each medications as med, i (i)}
            <tr>
              <td>{med.mittel || '—'}</td>
              <td>{[med.dosis, med.einheit].filter(Boolean).join(' ') || '—'}</td>
              <td>{med.weg || '—'}</td>
              <td>{med.uhrzeit || '—'}</td>
              <td>{med.person || '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <!-- Einsatz-Zeitschiene (DIVI/MIND) -->
  {#if timeline.length > 0}
    <section class="ho-section">
      <h2 class="ho-section-title"><span class="ho-badge">⏱</span>{$t('handover.timeline')}</h2>
      <dl class="ho-dl">
        {#each timeline as step (step.label)}
          <div>
            <dt>{step.label}</dt>
            <dd>{fmtTime(step.value)}</dd>
          </div>
        {/each}
      </dl>
    </section>
  {/if}

  <!-- Signatures -->
  {#if sigFields.length > 0}
    <section class="ho-section">
      <h2 class="ho-section-title"><span class="ho-badge">✓</span>{$t('handover.signatures')}</h2>
      <div class="ho-sigs">
        {#each sigFields as field (field.key)}
          {@const sig = data.signatures[field.key]}
          <div class="ho-sig">
            <p class="ho-sig-label">{field.label}</p>
            {#if sig}
              <img class="ho-sig-img" src={imgUrl(sig.data, sig.mediaType)} alt={field.label} />
            {:else}
              <div class="ho-sig-line"></div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Verification QR (integrity-only) + integrity line -->
  <section class="ho-section ho-verify">
    <div class="ho-verify-qr">
      {#if qrMatrix}
        <svg
          width="120"
          height="120"
          viewBox={`0 0 ${qrDim} ${qrDim}`}
          role="img"
          aria-label="QR"
          shape-rendering="crispEdges"
        >
          <rect width={qrDim} height={qrDim} fill="#ffffff" />
          <path d={qrPath} fill="#000000" />
        </svg>
      {/if}
    </div>
    <div class="ho-verify-text">
      <p class="ho-verify-hint">{$t('handover.qrHint')}</p>
      <dl class="ho-dl">
        <div>
          <dt>{$t('export.author')}</dt>
          <dd>{data.authorName ?? data.record.authorKeyId}</dd>
        </div>
        <div>
          <dt>{$t('export.createdAt')}</dt>
          <dd>{createdAt}</dd>
        </div>
        <div class="ho-dl-full">
          <dt>{$t('export.recordHash')}</dt>
          <dd class="ho-hash">{data.record.recordHash}</dd>
        </div>
      </dl>
    </div>
  </section>
</div>

<style>
  /* Hidden on screen; materialises only for the print medium. */
  .handover-print {
    display: none;
  }

  @media print {
    :global(body > *) {
      visibility: hidden;
    }
    .handover-print,
    .handover-print * {
      visibility: visible;
    }
    .handover-print {
      display: block;
      position: absolute;
      inset: 0;
      width: 100%;
      color: #0f172a;
      background: #ffffff;
      padding: 16mm 12mm;
      font-size: 11pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      page-break-after: always;
    }

    .ho-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 6pt;
      margin-bottom: 6pt;
    }
    .ho-org {
      font-size: 10pt;
      font-weight: 600;
      color: #0f766e;
      margin: 0;
    }
    .ho-title {
      font-size: 16pt;
      font-weight: 700;
      margin: 2pt 0 0;
      color: #0f172a;
    }
    .ho-sub {
      font-size: 9pt;
      color: #475569;
      margin: 1pt 0 0;
    }
    .ho-meta {
      text-align: right;
      font-size: 9pt;
      color: #475569;
    }
    .ho-meta p {
      margin: 0;
    }

    .ho-section {
      margin-bottom: 8pt;
      page-break-inside: avoid;
    }
    .ho-section-title {
      display: flex;
      align-items: center;
      gap: 6pt;
      font-size: 11pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 3pt;
      margin: 0 0 4pt;
    }
    .ho-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16pt;
      height: 16pt;
      border-radius: 999px;
      background: #ccfbf1;
      color: #0f766e;
      font-size: 8pt;
      font-weight: 700;
    }
    .ho-dl {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3pt 12pt;
      margin: 0;
    }
    .ho-dl-full {
      grid-column: 1 / -1;
    }
    .ho-dl dt {
      font-size: 8pt;
      color: #64748b;
      font-weight: 600;
    }
    .ho-dl dd {
      font-size: 10pt;
      color: #0f172a;
      margin: 0 0 2pt;
      white-space: pre-wrap;
    }
    .ho-hash {
      font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 8pt;
      word-break: break-all;
    }

    .ho-med-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    .ho-med-table th,
    .ho-med-table td {
      border: 1px solid #cbd5e1;
      padding: 2pt 4pt;
      text-align: left;
      vertical-align: top;
    }
    .ho-med-table th {
      background: #f1f5f9;
      font-size: 8pt;
      color: #475569;
      font-weight: 600;
    }

    .ho-sigs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12pt;
    }
    .ho-sig-label {
      font-size: 8pt;
      color: #64748b;
      font-weight: 600;
      margin: 0 0 2pt;
    }
    .ho-sig-img {
      max-height: 70px;
      max-width: 100%;
      border: 1px solid #cbd5e1;
      background: #fff;
    }
    .ho-sig-line {
      border-bottom: 1px solid #94a3b8;
      height: 40px;
    }

    .ho-verify {
      display: flex;
      gap: 12pt;
      align-items: flex-start;
      border: 1px solid #0f766e;
      border-radius: 6pt;
      padding: 6pt 8pt;
      margin-top: 12pt;
    }
    .ho-verify-qr {
      flex: none;
    }
    .ho-verify-text {
      flex: 1;
      min-width: 0;
    }
    .ho-verify-hint {
      font-size: 8pt;
      color: #475569;
      font-style: italic;
      margin: 0 0 4pt;
    }
  }
</style>
