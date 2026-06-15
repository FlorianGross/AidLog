<!--
  Wachbericht.svelte — druckbarer ABSCHLUSSBERICHT (Wachbericht) einer
  Veranstaltung, im A4-Layout.

  Auf dem Bildschirm verborgen, sichtbar nur beim Drucken (@media print), auf
  sauberem Weiß mit expliziten Druckfarben unabhängig vom Theme (analog zu
  HandoverPrint/PrintRecord). Der/die Einsatzleiter/in erzeugt ihn auf dem
  eigenen Gerät; alles ist bereits geladen/entschlüsselt — nichts verlässt das
  Gerät, der/die Nutzer/in druckt oder speichert als PDF.

  Inhalt (ein Bericht):
    - Kopf: Org-Name, Veranstaltung (Titel + Stammdaten), Erstellhinweis,
    - Kräfte: Roster (Name, Qualifikation, Dienstzeiten aus Check-in/-out),
    - Einsatzzahlen: aus eventstats (Kontakte gesamt, Versorgungsart, Verbleib,
      Ersteindruck, Demografie) — TRAINING ist dort bereits ausgeschlossen,
    - Materialverbrauch: aus dem Consumption-Endpunkt (Posten, Menge),
    - Hinweis zum Trainings-Ausschluss + Unterschriftszeile Einsatzleitung.
-->
<script lang="ts">
  import { t } from '$lib/i18n';
  import { qualificationLabel } from '@aidlog/contracts';
  import type { CategoryCount } from '$lib/analytics';
  import { dienstdauerMin, formatDauer, type WachberichtData } from './wachbericht';

  interface Props {
    data: WachberichtData;
  }
  let { data }: Props = $props();

  const stats = $derived(data.stats);

  function fmtDateTime(iso?: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('de-DE');
  }
  function fmtTime(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  // Zeitraum als "von – bis" (oder einzelner Teil), aus den Stammdaten.
  const zeitraum = $derived.by(() => {
    const b = data.meta.beginn ? fmtDateTime(data.meta.beginn) : '';
    const e = data.meta.ende ? fmtDateTime(data.meta.ende) : '';
    if (b && e) return `${b} – ${e}`;
    return b || e || '—';
  });

  // Option-Wert → Label (org-config/feste Sets, keine Daten) — wie in der Statistik.
  function optLabel(group: string, value: string): string {
    const key = `eventstats.values.${group}.${value}`;
    const label = $t(key);
    return label === key ? value : label;
  }
  function countsLine(counts: CategoryCount[], group: string): { label: string; count: number }[] {
    return counts.map((c) => ({ label: optLabel(group, c.value), count: c.count }));
  }

  const generatedAt = $derived(fmtDateTime(data.generatedAt));
</script>

<div class="wachbericht-print" data-print-theme="light">
  <!-- Kopf -->
  <header class="wb-header">
    <div>
      {#if data.orgName}<p class="wb-org">{data.orgName}</p>{/if}
      <h1 class="wb-title">{$t('wachbericht.title')}</h1>
      <p class="wb-sub">{data.meta.title}</p>
    </div>
    <div class="wb-meta">
      <p>{$t('wachbericht.generatedAt')}</p>
      <p>{generatedAt}</p>
    </div>
  </header>

  {#if stats.isTraining}
    <p class="wb-training">{$t('wachbericht.trainingBanner')}</p>
  {/if}

  <!-- Veranstaltungs-Stammdaten -->
  <section class="wb-section">
    <h2 class="wb-section-title">{$t('wachbericht.eventSection')}</h2>
    <dl class="wb-dl">
      <div>
        <dt>{$t('veranstaltung.ort')}</dt>
        <dd>{data.meta.ort || '—'}</dd>
      </div>
      <div>
        <dt>{$t('wachbericht.zeitraum')}</dt>
        <dd>{zeitraum}</dd>
      </div>
      <div>
        <dt>{$t('veranstaltung.art')}</dt>
        <dd>{data.meta.veranstaltungsart || '—'}</dd>
      </div>
      <div>
        <dt>{$t('veranstaltung.erwarteteBesucher')}</dt>
        <dd>{data.meta.erwarteteBesucher ?? '—'}</dd>
      </div>
      <div>
        <dt>{$t('veranstaltung.veranstalter')}</dt>
        <dd>{data.meta.veranstalter || '—'}</dd>
      </div>
      <div>
        <dt>{$t('veranstaltung.einsatzleiter')}</dt>
        <dd>{data.meta.einsatzleiterName || '—'}</dd>
      </div>
    </dl>
  </section>

  <!-- Eingesetzte Kräfte (Roster) -->
  <section class="wb-section">
    <h2 class="wb-section-title">
      {$t('wachbericht.forcesSection')} ({data.roster.length})
    </h2>
    {#if data.roster.length === 0}
      <p class="wb-empty">{$t('wachbericht.noForces')}</p>
    {:else}
      <table class="wb-table">
        <thead>
          <tr>
            <th>{$t('wachbericht.name')}</th>
            <th>{$t('wachbericht.qualification')}</th>
            <th>{$t('wachbericht.roleAtEvent')}</th>
            <th>{$t('wachbericht.checkIn')}</th>
            <th>{$t('wachbericht.checkOut')}</th>
            <th>{$t('wachbericht.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.roster as r (r.helperKeyId)}
            <tr>
              <td>{r.displayName}</td>
              <td>{qualificationLabel(r.qualification)}</td>
              <td>{r.roleAtEvent || '—'}</td>
              <td>{fmtTime(r.checkedInAt)}</td>
              <td>{fmtTime(r.checkedOutAt)}</td>
              <td>{formatDauer(dienstdauerMin(r))}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <!-- Einsatzzahlen -->
  <section class="wb-section">
    <h2 class="wb-section-title">{$t('wachbericht.figuresSection')}</h2>
    <div class="wb-kpis">
      <div class="wb-kpi">
        <span class="wb-kpi-num">{stats.totalContacts}</span>
        <span class="wb-kpi-label">{$t('eventstats.totalContacts')}</span>
      </div>
      <div class="wb-kpi">
        <span class="wb-kpi-num">{stats.protocolContacts}</span>
        <span class="wb-kpi-label">{$t('eventstats.protocols')}</span>
      </div>
      <div class="wb-kpi">
        <span class="wb-kpi-num">{stats.quickContacts}</span>
        <span class="wb-kpi-label">{$t('eventstats.quick')}</span>
      </div>
      <div class="wb-kpi">
        <span class="wb-kpi-num">{stats.disposition.transport}</span>
        <span class="wb-kpi-label">{$t('eventstats.transports')}</span>
      </div>
      <div class="wb-kpi">
        <span class="wb-kpi-num">{stats.disposition.refusal}</span>
        <span class="wb-kpi-label">{$t('eventstats.refusals')}</span>
      </div>
    </div>

    <div class="wb-grid">
      <div>
        <h3 class="wb-sub-title">{$t('eventstats.byVersorgungsart')}</h3>
        <dl class="wb-dl">
          {#each countsLine(stats.byVersorgungsart, 'versorgungsart') as row (row.label)}
            <div>
              <dt>{row.label}</dt>
              <dd>{row.count}</dd>
            </div>
          {:else}
            <div><dd class="wb-empty">—</dd></div>
          {/each}
        </dl>
      </div>
      <div>
        <h3 class="wb-sub-title">{$t('eventstats.byVerbleib')}</h3>
        <dl class="wb-dl">
          {#each countsLine(stats.byVerbleib, 'verbleib') as row (row.label)}
            <div>
              <dt>{row.label}</dt>
              <dd>{row.count}</dd>
            </div>
          {:else}
            <div><dd class="wb-empty">—</dd></div>
          {/each}
        </dl>
      </div>
      <div>
        <h3 class="wb-sub-title">{$t('eventstats.bySeverity')}</h3>
        <dl class="wb-dl">
          {#each countsLine(stats.bySeverity, 'ersteindruck') as row (row.label)}
            <div>
              <dt>{row.label}</dt>
              <dd>{row.count}</dd>
            </div>
          {:else}
            <div><dd class="wb-empty">—</dd></div>
          {/each}
        </dl>
      </div>
      <div>
        <h3 class="wb-sub-title">{$t('eventstats.byAge')}</h3>
        <dl class="wb-dl">
          {#each countsLine(stats.byAge, 'altersgruppe') as row (row.label)}
            <div>
              <dt>{row.label}</dt>
              <dd>{row.count}</dd>
            </div>
          {:else}
            <div><dd class="wb-empty">—</dd></div>
          {/each}
        </dl>
      </div>
      <div>
        <h3 class="wb-sub-title">{$t('eventstats.bySex')}</h3>
        <dl class="wb-dl">
          {#each countsLine(stats.bySex, 'geschlecht') as row (row.label)}
            <div>
              <dt>{row.label}</dt>
              <dd>{row.count}</dd>
            </div>
          {:else}
            <div><dd class="wb-empty">—</dd></div>
          {/each}
        </dl>
      </div>
    </div>
  </section>

  <!-- Materialverbrauch -->
  <section class="wb-section">
    <h2 class="wb-section-title">{$t('wachbericht.materialSection')}</h2>
    {#if data.material.length === 0}
      <p class="wb-empty">{$t('wachbericht.noMaterial')}</p>
    {:else}
      <table class="wb-table">
        <thead>
          <tr>
            <th>{$t('wachbericht.materialItem')}</th>
            <th>{$t('wachbericht.materialQuantity')}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.material as m (m.itemName)}
            <tr>
              <td>{m.itemName}</td>
              <td>{m.menge}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>

  <!-- Hinweise + Unterschrift -->
  <section class="wb-section">
    <p class="wb-note">{$t('wachbericht.trainingExcludedNote')}</p>
    <div class="wb-sign">
      <div class="wb-sign-line"></div>
      <p class="wb-sign-label">{$t('wachbericht.signatureLine')}</p>
    </div>
  </section>
</div>

<style>
  /* Auf dem Bildschirm verborgen; nur für das Druckmedium materialisiert. */
  .wachbericht-print {
    display: none;
  }

  @media print {
    :global(body > *) {
      visibility: hidden;
    }
    .wachbericht-print,
    .wachbericht-print * {
      visibility: visible;
    }
    .wachbericht-print {
      display: block;
      position: absolute;
      inset: 0;
      width: 100%;
      color: #0f172a;
      background: #ffffff;
      padding: 16mm 12mm;
      font-size: 10pt;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .wb-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 6pt;
      margin-bottom: 8pt;
    }
    .wb-org {
      font-size: 10pt;
      font-weight: 600;
      color: #0f766e;
      margin: 0;
    }
    .wb-title {
      font-size: 18pt;
      font-weight: 700;
      margin: 2pt 0 0;
      color: #0f172a;
    }
    .wb-sub {
      font-size: 10pt;
      color: #475569;
      margin: 1pt 0 0;
    }
    .wb-meta {
      text-align: right;
      font-size: 9pt;
      color: #475569;
    }
    .wb-meta p {
      margin: 0;
    }

    .wb-training {
      border: 1px solid #b45309;
      background: #fffbeb;
      color: #b45309;
      font-weight: 700;
      font-size: 9pt;
      padding: 4pt 8pt;
      border-radius: 4pt;
      margin: 0 0 8pt;
    }

    .wb-section {
      margin-bottom: 10pt;
      page-break-inside: avoid;
    }
    .wb-section-title {
      font-size: 12pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 3pt;
      margin: 0 0 5pt;
    }
    .wb-sub-title {
      font-size: 9pt;
      font-weight: 700;
      color: #475569;
      margin: 0 0 2pt;
    }

    .wb-dl {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2pt 12pt;
      margin: 0;
    }
    .wb-dl > div {
      display: flex;
      justify-content: space-between;
      gap: 8pt;
      border-bottom: 1px dotted #e2e8f0;
      padding: 1pt 0;
    }
    .wb-dl dt {
      font-size: 9pt;
      color: #64748b;
    }
    .wb-dl dd {
      font-size: 9pt;
      color: #0f172a;
      margin: 0;
      font-weight: 600;
      text-align: right;
    }

    .wb-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6pt 16pt;
      margin-top: 6pt;
    }

    .wb-kpis {
      display: flex;
      flex-wrap: wrap;
      gap: 8pt;
      margin-bottom: 4pt;
    }
    .wb-kpi {
      border: 1px solid #cbd5e1;
      border-radius: 4pt;
      padding: 4pt 8pt;
      text-align: center;
      min-width: 64pt;
    }
    .wb-kpi-num {
      display: block;
      font-size: 16pt;
      font-weight: 700;
      color: #0f766e;
    }
    .wb-kpi-label {
      display: block;
      font-size: 7.5pt;
      color: #64748b;
    }

    .wb-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    .wb-table th,
    .wb-table td {
      border: 1px solid #cbd5e1;
      padding: 2pt 5pt;
      text-align: left;
      vertical-align: top;
    }
    .wb-table th {
      background: #f1f5f9;
      font-size: 8pt;
      color: #475569;
      font-weight: 600;
    }

    .wb-empty {
      font-size: 9pt;
      color: #94a3b8;
      font-style: italic;
      margin: 0;
    }

    .wb-note {
      font-size: 8pt;
      color: #64748b;
      font-style: italic;
      margin: 0 0 12pt;
    }
    .wb-sign {
      margin-top: 16pt;
      width: 60%;
    }
    .wb-sign-line {
      border-bottom: 1px solid #0f172a;
      height: 28pt;
    }
    .wb-sign-label {
      font-size: 8pt;
      color: #64748b;
      margin: 2pt 0 0;
    }
  }
</style>
