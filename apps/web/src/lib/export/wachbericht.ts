/**
 * export/wachbericht.ts — Datenform + kleiner Builder für den WACHBERICHT
 * (Abschlussbericht einer Veranstaltung).
 *
 * Der Wachbericht aggregiert PRO EINSATZ:
 *   - Veranstaltungs-Stammdaten (lokal pro Gerät auf der DeploymentMeta),
 *   - eingesetzte Kräfte (Roster — server-synchronisiert),
 *   - Einsatzzahlen (eventstats — lokal entschlüsselte Aggregate; TRAINING ist
 *     dort bereits ausgeschlossen),
 *   - Materialverbrauch (Consumption — server-synchronisiert).
 *
 * Frei von Svelte, damit leicht testbar/erweiterbar. Hält KEINE Schlüssel und
 * macht KEINE I/O — der Aufrufer lädt die Quellen und reicht sie hinein.
 */
import type { RosterEntry, ConsumptionEntry } from '@aidlog/contracts';
import type { DeploymentMeta } from '$lib/store';
import type { EventStats } from '$lib/eventstats';

/** Aggregierter Materialposten (gleiche Items werden über Einträge summiert). */
export interface WachberichtMaterial {
  itemName: string;
  menge: number;
}

/** Alles, was die Wachbericht-Druckansicht braucht — bereits geladen, im Speicher. */
export interface WachberichtData {
  /** Org-Anzeigename (aus dem gecachten OrgInfo), falls bekannt. */
  orgName?: string;
  /** lokale Einsatz-Metadaten inkl. optionaler Veranstaltungs-Stammdaten. */
  meta: DeploymentMeta;
  /** Roster (eingesetzte Kräfte mit Check-in/-out). */
  roster: RosterEntry[];
  /** Einsatzzahlen (TRAINING bereits ausgeschlossen). */
  stats: EventStats;
  /** aggregierter Materialverbrauch. */
  material: WachberichtMaterial[];
  /** Zeitpunkt der Berichtserstellung (ISO). */
  generatedAt: string;
}

/**
 * Fasse Verbrauchs-Einträge je Item (nach itemName) zusammen und summiere die
 * Mengen. Stabil sortiert nach absteigender Menge, dann Name.
 */
export function aggregateMaterial(entries: ConsumptionEntry[]): WachberichtMaterial[] {
  const byName = new Map<string, number>();
  for (const e of entries) {
    byName.set(e.itemName, (byName.get(e.itemName) ?? 0) + e.quantity);
  }
  return [...byName.entries()]
    .map(([itemName, menge]) => ({ itemName, menge }))
    .sort((a, b) => b.menge - a.menge || a.itemName.localeCompare(b.itemName));
}

/**
 * Dienstdauer eines Roster-Eintrags in Minuten, oder null wenn unvollständig.
 * Pur (kein "now"): rechnet nur, wenn Check-in UND Check-out vorliegen.
 */
export function dienstdauerMin(entry: RosterEntry): number | null {
  if (!entry.checkedInAt || !entry.checkedOutAt) return null;
  const inMs = new Date(entry.checkedInAt).getTime();
  const outMs = new Date(entry.checkedOutAt).getTime();
  if (Number.isNaN(inMs) || Number.isNaN(outMs) || outMs < inMs) return null;
  return Math.round((outMs - inMs) / 60000);
}

/** Formatiere Minuten als "Xh Ymin" (für die Druckansicht). */
export function formatDauer(min: number | null): string {
  if (min == null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}
