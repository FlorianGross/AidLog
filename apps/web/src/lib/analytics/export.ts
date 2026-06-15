/**
 * analytics/export.ts — ANONYMISED report serialisation (JSON + CSV).
 *
 * The export is built ONLY from an {@link AnalyticsResult}, which is aggregate-
 * only by construction (see aggregate.ts + the whitelist in types.ts). There is
 * no code path here that can reach a raw payload, an identifier or free text, so
 * the produced files contain counts/categories/averages exclusively.
 */
import type { AnalyticsResult } from './types';

/** Resolve a stable field-key/option-value to a human label (caller supplies). */
export type LabelFn = (kind: 'field' | 'option' | 'vital', key: string, sub?: string) => string;

/** A header line embedded in every export so the anonymisation is explicit. */
export const ANONYMISATION_NOTICE =
  'Anonymisierter Auswertungsbericht — enthaelt ausschliesslich Aggregat-Zahlen ' +
  '(Kategorien, Mittelwerte, Verteilungen). Keine Klarnamen, Initialen, Freitexte, ' +
  'Orte oder Unterschriften.';

/** Build the anonymised JSON report (pretty-printed). */
export function toJson(result: AnalyticsResult): string {
  return JSON.stringify(
    {
      _notice: ANONYMISATION_NOTICE,
      generatedAt: result.generatedAt,
      totals: {
        deployments: result.totalDeployments,
        protocols: result.totalProtocols,
        recordsProcessed: result.recordsProcessed,
      },
      disposition: result.disposition,
      perMonth: result.perMonth,
      perDay: result.perDay,
      distributions: result.distributions,
      vitals: result.vitals,
      injuries: result.injuries,
      heatmap: result.heat,
    },
    null,
    2,
  );
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvCell).join(';');
}

/**
 * Build a flat CSV of every aggregate metric. One `section;key;label;value`
 * shaped table so it opens cleanly in any spreadsheet. `label` uses the supplied
 * resolver; if none is given the stable key is used.
 */
export function toCsv(result: AnalyticsResult, label?: LabelFn): string {
  const lf: LabelFn = label ?? ((_k, key, sub) => (sub ? `${key}/${sub}` : key));
  const lines: string[] = [];
  lines.push(`# ${ANONYMISATION_NOTICE}`);
  lines.push(csvRow(['Abschnitt', 'Schluessel', 'Bezeichnung', 'Wert']));

  lines.push(csvRow(['Gesamt', 'deployments', 'Einsaetze', result.totalDeployments]));
  lines.push(csvRow(['Gesamt', 'protocols', 'Protokolle', result.totalProtocols]));
  lines.push(
    csvRow(['Gesamt', 'recordsProcessed', 'Verarbeitete Datensaetze', result.recordsProcessed]),
  );

  lines.push(csvRow(['Verbleib', 'transport', 'Transport', result.disposition.transport]));
  lines.push(csvRow(['Verbleib', 'refusal', 'Verweigerung', result.disposition.refusal]));
  lines.push(csvRow(['Verbleib', 'other', 'Sonstiges', result.disposition.other]));

  for (const b of result.perMonth) {
    lines.push(csvRow(['Pro Monat', b.label, b.label, b.count]));
  }

  for (const d of result.distributions) {
    for (const c of d.counts) {
      lines.push(
        csvRow([
          'Verteilung',
          `${d.field}.${c.value}`,
          `${lf('field', d.field)} / ${lf('option', d.field, c.value)}`,
          c.count,
        ]),
      );
    }
  }

  for (const v of result.vitals) {
    lines.push(csvRow(['Vitalwert (Ø)', v.key, `${lf('vital', v.key)} (${v.unit})`, v.average]));
  }

  for (const [type, count] of Object.entries(result.injuries.byType)) {
    lines.push(csvRow(['Verletzung (Typ)', type, type, count ?? 0]));
  }
  for (const [sev, count] of Object.entries(result.injuries.bySeverity)) {
    lines.push(csvRow(['Verletzung (Schwere)', sev, sev, count ?? 0]));
  }

  return lines.join('\n');
}

/** Trigger a client-side file download of `content`. Browser only. */
export function downloadFile(filename: string, content: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
