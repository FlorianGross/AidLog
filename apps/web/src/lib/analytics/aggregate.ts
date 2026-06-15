/**
 * analytics/aggregate.ts — pure, in-memory aggregation of decrypted org records
 * into a fully ANONYMISED {@link AnalyticsResult}.
 *
 * This module reads ONLY the whitelisted fields in `types.ts`. It never copies a
 * free-text value, identifier, note, signature or blob into its output, so the
 * result (and any export of it) is aggregate-only by construction. It holds no
 * key material and performs no I/O — it is trivially unit-testable.
 */
import { asMarkers, BODYMAP_KEY, type BodyMarker } from '$lib/bodymap/types';
import { isTrainingPayload } from '$lib/training';
import {
  CATEGORICAL_FIELDS,
  VITAL_FIELDS,
  TRANSPORT_VALUES,
  REFUSAL_VALUES,
  type AnalyticsResult,
  type FieldDistribution,
  type HeatRegion,
  type InjuryBreakdown,
  type TimeBucket,
  type VitalStat,
} from './types';

/** A decrypted record reduced to the metadata aggregation needs + its payload. */
export interface DecryptedEntry {
  id: string;
  deploymentId: string;
  seq: number;
  /** ISO 8601 client clock from the record. */
  createdAt: string;
  supersedes?: string | null;
  /** The decrypted, parsed form payload (flat Record keyed by field key). */
  payload: Record<string, unknown>;
}

/** Heatmap grid resolution (cells per axis). Coarse, to read as regions. */
const HEAT_COLS = 6;
const HEAT_ROWS = 12;

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v;
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Day bucket key (YYYY-MM-DD) from an ISO timestamp, or null if unparseable. */
function dayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
function monthKey(iso: string): string | null {
  const k = dayKey(iso);
  return k ? k.slice(0, 7) : null;
}

function bumpSeries(map: Map<string, number>, key: string | null): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toBuckets(map: Map<string, number>): TimeBucket[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Reduce decrypted entries to the latest (highest seq, non-superseded) record
 * per deployment for "protocol" counts and distributions, while still counting
 * every processed record. Superseded ids are dropped from the protocol view so
 * a corrected protocol is not double-counted.
 */
export function aggregate(entries: DecryptedEntry[]): AnalyticsResult {
  // ÜBUNGS-/DEMO-MODUS: exclude TRAINING/exercise records from the admin
  // Auswertung so practice data never pollutes real statistics. They are dropped
  // up front (not counted in recordsProcessed) — the analytics reflect real ops.
  const realEntries = entries.filter((e) => !isTrainingPayload(e.payload));
  entries = realEntries;

  const supersededIds = new Set<string>();
  for (const e of entries) if (e.supersedes) supersededIds.add(e.supersedes);

  // Latest record per deployment (by seq) that is itself not superseded.
  const latestByDeployment = new Map<string, DecryptedEntry>();
  for (const e of entries) {
    if (supersededIds.has(e.id)) continue;
    const cur = latestByDeployment.get(e.deploymentId);
    if (!cur || e.seq > cur.seq) latestByDeployment.set(e.deploymentId, e);
  }
  const protocols = [...latestByDeployment.values()];

  // --- time series (over the protocol set) ---
  const perDayMap = new Map<string, number>();
  const perMonthMap = new Map<string, number>();
  for (const p of protocols) {
    bumpSeries(perDayMap, dayKey(p.createdAt));
    bumpSeries(perMonthMap, monthKey(p.createdAt));
  }

  // --- categorical distributions (whitelist only) ---
  const distMaps = new Map<string, Map<string, number>>();
  for (const field of CATEGORICAL_FIELDS) distMaps.set(field, new Map());

  // --- disposition (transport vs refusal) from u_verbleib ---
  let transport = 0;
  let refusal = 0;
  let dispOther = 0;

  // --- vitals (averaged, in-range) ---
  const vitalAcc = new Map<string, { sum: number; n: number; min: number; max: number }>();

  // --- injury heatmap + breakdown ---
  const heatMap = new Map<string, number>(); // key: `${side}:${col}:${row}`
  const byType: InjuryBreakdown['byType'] = {};
  const bySeverity: InjuryBreakdown['bySeverity'] = {};
  let injuryTotal = 0;

  for (const p of protocols) {
    const payload = p.payload;

    for (const field of CATEGORICAL_FIELDS) {
      const raw = payload[field];
      // Multiselect values can be arrays; count each chosen option.
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        const sv = asString(v);
        if (!sv) continue;
        const m = distMaps.get(field)!;
        m.set(sv, (m.get(sv) ?? 0) + 1);
      }
    }

    const verbleib = asString(payload['u_verbleib']);
    if (verbleib) {
      if (TRANSPORT_VALUES.has(verbleib)) transport++;
      else if (REFUSAL_VALUES.has(verbleib)) refusal++;
      else dispOther++;
    }

    for (const spec of VITAL_FIELDS) {
      const n = asNumber(payload[spec.key]);
      if (n === null || n < spec.min || n > spec.max) continue;
      const acc = vitalAcc.get(spec.key) ?? { sum: 0, n: 0, min: Infinity, max: -Infinity };
      acc.sum += n;
      acc.n += 1;
      acc.min = Math.min(acc.min, n);
      acc.max = Math.max(acc.max, n);
      vitalAcc.set(spec.key, acc);
    }

    const markers: BodyMarker[] = asMarkers(payload[BODYMAP_KEY]);
    for (const mk of markers) {
      injuryTotal++;
      byType[mk.type] = (byType[mk.type] ?? 0) + 1;
      bySeverity[mk.severity] = (bySeverity[mk.severity] ?? 0) + 1;
      const col = Math.min(HEAT_COLS - 1, Math.max(0, Math.floor(mk.x * HEAT_COLS)));
      const row = Math.min(HEAT_ROWS - 1, Math.max(0, Math.floor(mk.y * HEAT_ROWS)));
      const key = `${mk.side}:${col}:${row}`;
      heatMap.set(key, (heatMap.get(key) ?? 0) + 1);
    }
  }

  const distributions: FieldDistribution[] = [];
  for (const [field, m] of distMaps) {
    if (m.size === 0) continue;
    const counts = [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
    const total = counts.reduce((s, c) => s + c.count, 0);
    distributions.push({ field, total, counts });
  }

  const vitals: VitalStat[] = [];
  for (const spec of VITAL_FIELDS) {
    const acc = vitalAcc.get(spec.key);
    if (!acc || acc.n === 0) continue;
    vitals.push({
      key: spec.key,
      unit: spec.unit,
      count: acc.n,
      average: Math.round((acc.sum / acc.n) * 10) / 10,
      min: acc.min,
      max: acc.max,
    });
  }

  const heat: HeatRegion[] = [];
  let heatPeak = 0;
  for (const [key, count] of heatMap) {
    const [side, colStr, rowStr] = key.split(':');
    const col = Number(colStr);
    const row = Number(rowStr);
    heat.push({
      side: side as HeatRegion['side'],
      col,
      row,
      cx: (col + 0.5) / HEAT_COLS,
      cy: (row + 0.5) / HEAT_ROWS,
      count,
    });
    if (count > heatPeak) heatPeak = count;
  }

  const injuries: InjuryBreakdown = { byType, bySeverity, total: injuryTotal };

  return {
    totalDeployments: latestByDeployment.size,
    totalProtocols: protocols.length,
    recordsProcessed: entries.length,
    perDay: toBuckets(perDayMap),
    perMonth: toBuckets(perMonthMap),
    distributions,
    disposition: {
      transport,
      refusal,
      other: dispOther,
      total: transport + refusal + dispOther,
    },
    vitals,
    heat,
    heatPeak,
    injuries,
    generatedAt: new Date().toISOString(),
  };
}

export { HEAT_COLS, HEAT_ROWS };
