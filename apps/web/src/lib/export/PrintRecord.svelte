<!--
  PrintRecord.svelte — print-optimised, self-contained render of a FINALIZED,
  signed record. Hidden on screen; visible only when printing (@media print),
  forced onto clean white with explicit print colours regardless of theme.

  Contents (one protocol per page):
    - org / deployment header,
    - all ABCDE/SAMPLER sections (rendered read-only here from in-memory values,
      mapping select/multiselect option values back to labels),
    - vital-sign trends (chart + table),
    - body-map (front/back + marker list),
    - attached photos,
    - an INTEGRITY / SIGNATURE block: author, createdAt + server receipt (if
      any), recordHash (mono), the author signature image, and any co-signatures.

  All data is already decrypted and in memory — nothing leaves the device, no
  server round-trip. The user prints and chooses "Save as PDF".
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from '$lib/i18n';
  import { abcdeSchema } from '$lib/schemas/abcde';
  import { computeValue } from '$lib/scores';
  import type { DocField } from '$lib/schemas/types';
  import { VitalTrendView } from '$lib/vitals';
  import { BodyMapView, PhotoGalleryView } from '$lib/bodymap';
  import type { PrintRecordData } from './printRecord';

  interface Props {
    data: PrintRecordData;
  }
  let { data }: Props = $props();

  const schema = abcdeSchema;

  // --- option-value → label mapping for read-only display -------------------
  function labelFor(field: DocField, value: string): string {
    return field.options?.find((o) => o.value === value)?.label ?? value;
  }

  function display(field: DocField): string {
    if (field.type === 'computed') {
      const c = computeValue(field, data.values);
      if (c === null) return '—';
      const max = field.compute?.max;
      return max !== undefined ? `${c} / ${max}` : String(c);
    }
    const v = data.values[field.key];
    if (v === undefined || v === null || v === '') return '—';
    if (field.type === 'boolean') return v ? $t('common.yes') : $t('common.no');
    if (field.type === 'select') return labelFor(field, String(v));
    if (field.type === 'multiselect' && Array.isArray(v)) {
      return v.length ? v.map((x) => labelFor(field, String(x))).join(', ') : '—';
    }
    if (field.type === 'datetime' || field.type === 'date') {
      const d = new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
    }
    const unit = field.unit ? ` ${field.unit}` : '';
    return `${String(v)}${unit}`;
  }

  function subDisplay(sub: DocField, raw: unknown): string {
    if (raw === undefined || raw === null || raw === '') return '—';
    if (sub.type === 'boolean') return raw ? $t('common.yes') : $t('common.no');
    if (sub.type === 'select') return labelFor(sub, String(raw));
    if (sub.type === 'multiselect' && Array.isArray(raw)) {
      return raw.length ? raw.map((x) => labelFor(sub, String(x))).join(', ') : '—';
    }
    const unit = sub.unit ? ` ${sub.unit}` : '';
    return `${String(raw)}${unit}`;
  }

  function groupRows(field: DocField): Record<string, unknown>[] {
    const v = data.values[field.key];
    return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
  }

  // Simple scalar fields render as text rows; signatures and groups render below.
  function textFields(fields: DocField[]): DocField[] {
    return fields.filter((f) => f.type !== 'signature' && f.type !== 'group');
  }
  function signatureFields(fields: DocField[]): DocField[] {
    return fields.filter((f) => f.type === 'signature');
  }
  function groupFields(fields: DocField[]): DocField[] {
    return fields.filter((f) => f.type === 'group');
  }

  // --- in-memory signature image object URLs (author + field signatures) -----
  const urls: string[] = [];
  function imgUrl(data: Uint8Array, mediaType: string): string {
    const url = URL.createObjectURL(
      new Blob([data.slice().buffer], { type: mediaType || 'image/png' }),
    );
    urls.push(url);
    return url;
  }
  onDestroy(() => {
    for (const u of urls) URL.revokeObjectURL(u);
  });

  const createdAt = $derived(new Date(data.record.createdAt).toLocaleString());
</script>

<div class="print-record" data-print-theme="light">
  <!-- Header -->
  <header class="pr-header">
    <div>
      {#if data.orgName}<p class="pr-org">{data.orgName}</p>{/if}
      <h1 class="pr-title">{data.deploymentTitle}</h1>
      <p class="pr-sub">{schema.title}</p>
    </div>
    <div class="pr-meta">
      <p>#{data.record.seq}</p>
      <p>{createdAt}</p>
    </div>
  </header>
  <p class="pr-faithful">{$t('export.faithfulRender')}</p>

  <!-- ABCDE / SAMPLER sections -->
  {#each schema.sections as sec (sec.key)}
    <section class="pr-section">
      <h2 class="pr-section-title">
        <span class="pr-badge">{sec.badge ?? sec.title.slice(0, 1)}</span>{sec.title}
      </h2>
      <dl class="pr-dl">
        {#each textFields(sec.fields) as field (field.key)}
          <div class={field.span === 2 ? 'pr-dl-full' : ''}>
            <dt>{field.label}</dt>
            <dd>{display(field)}</dd>
          </div>
        {/each}
      </dl>
      {#each groupFields(sec.fields) as field (field.key)}
        {@const list = groupRows(field)}
        {#if list.length > 0}
          <div class="pr-group">
            <p class="pr-group-label">{field.label}</p>
            <table class="pr-group-table">
              <thead>
                <tr>
                  {#each field.itemFields ?? [] as sub (sub.key)}
                    <th>{sub.label}</th>
                  {/each}
                </tr>
              </thead>
              <tbody>
                {#each list as row, i (i)}
                  <tr>
                    {#each field.itemFields ?? [] as sub (sub.key)}
                      <td>{subDisplay(sub, row[sub.key])}</td>
                    {/each}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      {/each}
      {#each signatureFields(sec.fields) as field (field.key)}
        {@const sig = data.signatures[field.key]}
        {#if sig}
          <div class="pr-sig">
            <p class="pr-sig-label">{field.label}</p>
            <img class="pr-sig-img" src={imgUrl(sig.data, sig.mediaType)} alt={field.label} />
          </div>
        {/if}
      {/each}
    </section>
  {/each}

  <!-- Vital-sign trends -->
  {#if data.vitals.length > 0}
    <section class="pr-section">
      <h2 class="pr-section-title"><span class="pr-badge">♥</span>{$t('vitals.title')}</h2>
      <VitalTrendView readings={data.vitals} />
    </section>
  {/if}

  <!-- Body-map -->
  {#if data.markers.length > 0}
    <section class="pr-section">
      <h2 class="pr-section-title"><span class="pr-badge">⚑</span>{$t('bodymap.title')}</h2>
      <BodyMapView markers={data.markers} />
    </section>
  {/if}

  <!-- Photos -->
  {#if data.photos.length > 0}
    <section class="pr-section">
      <h2 class="pr-section-title"><span class="pr-badge">▣</span>{$t('bodymap.photos')}</h2>
      <PhotoGalleryView photos={data.photos} />
    </section>
  {/if}

  <!-- Integrity / signature block -->
  <section class="pr-section pr-integrity">
    <h2 class="pr-section-title"><span class="pr-badge">✓</span>{$t('export.integrityTitle')}</h2>
    <dl class="pr-dl">
      <div>
        <dt>{$t('export.author')}</dt>
        <dd>{data.authorName ?? data.record.authorKeyId}</dd>
      </div>
      <div>
        <dt>{$t('export.createdAt')}</dt>
        <dd>{createdAt}</dd>
      </div>
      {#if data.serverReceiptAt}
        <div>
          <dt>{$t('export.serverReceipt')}</dt>
          <dd>{new Date(data.serverReceiptAt).toLocaleString()}</dd>
        </div>
      {/if}
      <div class="pr-dl-full">
        <dt>{$t('export.recordHash')}</dt>
        <dd class="pr-hash">{data.record.recordHash}</dd>
      </div>
    </dl>

    <div class="pr-signatures">
      <!-- author signature image: reuse helper field signature if present -->
      {#if data.signatures['sig_helfer']}
        <div class="pr-sig">
          <p class="pr-sig-label">{$t('export.authorSignature')}</p>
          <img
            class="pr-sig-img"
            src={imgUrl(
              data.signatures['sig_helfer'].data,
              data.signatures['sig_helfer'].mediaType,
            )}
            alt={$t('export.authorSignature')}
          />
        </div>
      {/if}

      {#if data.cosignatures.length > 0}
        <div class="pr-cosign">
          <p class="pr-sig-label">{$t('export.cosignatures')}</p>
          <ul>
            {#each data.cosignatures as c, i (i)}
              <li>{c.signer} — {new Date(c.signedAt).toLocaleString()}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </section>
</div>

<style>
  /* Hidden on screen; the print view only materialises for the print medium. */
  .print-record {
    display: none;
  }

  @media print {
    /* Hide the live app chrome so ONLY this record prints, on clean white. */
    :global(body > *) {
      visibility: hidden;
    }
    .print-record,
    .print-record * {
      visibility: visible;
    }
    .print-record {
      display: block;
      position: absolute;
      inset: 0;
      width: 100%;
      /* Force light, explicit print colours regardless of the app theme. */
      color: #0f172a;
      background: #ffffff;
      padding: 16mm 12mm;
      font-size: 11pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;

      /*
       * Re-pin the design-token CSS variables to their LIGHT values inside the
       * print subtree, so embedded token-based children (vital chart, body-map,
       * photo grid) render cleanly on white even when the app is in dark mode.
       * Mirrors the light palette from app.css.
       */
      --surface: 255 255 255;
      --surface-1: 255 255 255;
      --surface-2: 241 243 246;
      --surface-3: 232 236 241;
      --text: 15 23 42;
      --text-muted: 71 85 105;
      --text-subtle: 130 142 160;
      --line: 226 232 240;
      --line-strong: 203 213 225;
      --brand: 13 148 136;
      --brand-strong: 15 118 110;
      --brand-fg: 255 255 255;
      --brand-soft: 224 247 242;
      --brand-soft-fg: 15 118 110;
      --danger: 220 38 38;
      --danger-soft: 254 226 226;
      --danger-fg: 153 27 27;
      --warning: 202 110 8;
      --warning-soft: 254 243 199;
      --warning-fg: 146 64 14;
      --ok: 22 163 74;
      --ok-soft: 220 252 231;
      --ok-fg: 22 101 52;
    }

    /* One protocol per page. */
    .print-record {
      page-break-after: always;
    }

    .pr-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 6pt;
      margin-bottom: 4pt;
    }
    .pr-org {
      font-size: 10pt;
      font-weight: 600;
      color: #0f766e;
      margin: 0;
    }
    .pr-title {
      font-size: 16pt;
      font-weight: 700;
      margin: 2pt 0 0;
      color: #0f172a;
    }
    .pr-sub {
      font-size: 9pt;
      color: #475569;
      margin: 1pt 0 0;
    }
    .pr-meta {
      text-align: right;
      font-size: 9pt;
      color: #475569;
    }
    .pr-meta p {
      margin: 0;
    }
    .pr-faithful {
      font-size: 8pt;
      color: #64748b;
      font-style: italic;
      margin: 0 0 8pt;
    }

    .pr-section {
      margin-bottom: 8pt;
      page-break-inside: avoid;
    }
    .pr-section-title {
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
    .pr-badge {
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
    .pr-dl {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3pt 12pt;
      margin: 0;
    }
    .pr-dl-full {
      grid-column: 1 / -1;
    }
    .pr-dl dt {
      font-size: 8pt;
      color: #64748b;
      font-weight: 600;
    }
    .pr-dl dd {
      font-size: 10pt;
      color: #0f172a;
      margin: 0 0 2pt;
    }
    .pr-hash {
      font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 8pt;
      word-break: break-all;
    }
    .pr-group {
      margin-top: 4pt;
    }
    .pr-group-label {
      font-size: 8pt;
      color: #64748b;
      font-weight: 600;
      margin: 0 0 2pt;
    }
    .pr-group-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    .pr-group-table th,
    .pr-group-table td {
      border: 1px solid #cbd5e1;
      padding: 2pt 4pt;
      text-align: left;
      vertical-align: top;
    }
    .pr-group-table th {
      background: #f1f3f6;
      font-size: 8pt;
      color: #475569;
      font-weight: 600;
    }
    .pr-sig {
      margin-top: 4pt;
    }
    .pr-sig-label {
      font-size: 8pt;
      color: #64748b;
      font-weight: 600;
      margin: 0 0 2pt;
    }
    .pr-sig-img {
      max-height: 80px;
      max-width: 240px;
      border: 1px solid #cbd5e1;
      background: #fff;
    }
    .pr-integrity {
      border: 1px solid #0f766e;
      border-radius: 6pt;
      padding: 6pt 8pt;
      margin-top: 12pt;
    }
    .pr-signatures {
      margin-top: 6pt;
    }
    .pr-cosign ul {
      margin: 2pt 0 0;
      padding-left: 14pt;
      font-size: 9pt;
    }
  }
</style>
