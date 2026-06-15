/**
 * eventstats/aggregate.ts — per-deployment KONTAKT statistics.
 *
 * Pure, in-memory aggregation over decrypted records of ONE deployment, counting
 * BOTH full ABCDE protocols AND quick contacts (each a separate Kontakt). It
 * reads only bounded, non-identifying fields (Versorgungsart, Verbleib, severity,
 * complaint category bucket, hour, age/sex) — never free text or identifiers.
 *
 * Unlike the org analytics (one latest protocol per deployment), an event's
 * statistics count EVERY non-superseded contact record, since a Veranstaltung has
 * many patient contacts. It holds no key material and does no I/O.
 */
import { isQuickPayload } from '$lib/quickentry';
import { isTrainingPayload } from '$lib/training';
import {
  TRANSPORT_VALUES,
  REFUSAL_VALUES,
  type CategoryCount,
  type TimeBucket,
} from '$lib/analytics';

/** A decrypted record reduced to what the per-event aggregation needs. */
export interface DecryptedContact {
  id: string;
  seq: number;
  createdAt: string;
  supersedes?: string | null;
  /** true if this contact came from the Schnell-Erfassung (quick) form. */
  quick: boolean;
  /** true if this contact is TRAINING/exercise data (ÜBUNGS-/DEMO-MODUS). */
  training: boolean;
  payload: Record<string, unknown>;
}

export interface EventStats {
  /** Total Kontakte (full protocols + quick contacts), non-superseded. */
  totalContacts: number;
  protocolContacts: number;
  quickContacts: number;
  /** Verteilung Versorgungsart (quick) / u_verbleib (combined) by value. */
  byVersorgungsart: CategoryCount[];
  byVerbleib: CategoryCount[];
  /** Severity (ersteindruck) distribution. */
  bySeverity: CategoryCount[];
  /** Age-group distribution. */
  byAge: CategoryCount[];
  /** Sex distribution. */
  bySex: CategoryCount[];
  /** Complaint category buckets (coarse, from the quick `q_beschwerde` / first word). */
  byComplaint: CategoryCount[];
  /** Contacts over time, bucketed by hour-of-day (00..23). */
  perHour: TimeBucket[];
  /** Disposition: transport vs refusal vs other (from u_verbleib). */
  disposition: { transport: number; refusal: number; other: number; total: number };
  /**
   * ÜBUNGS-/DEMO-MODUS: true when EVERY counted contact is training/exercise data
   * (i.e. this is a training deployment). The statistik view shows an ÜBUNG
   * banner so practice figures are never mistaken for real ones.
   */
  isTraining: boolean;
  /** Number of training/exercise contacts among the counted contacts. */
  trainingContacts: number;
  generatedAt: string;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function bump(map: Map<string, number>, key: string | null): void {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toCounts(map: Map<string, number>): CategoryCount[] {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

/** Hour key (00..23) from an ISO timestamp, or null if unparseable. */
function hourKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return String(d.getHours()).padStart(2, '0');
}

/** Coarse complaint bucket: first significant token of a short complaint, lowercased. */
function complaintBucket(payload: Record<string, unknown>): string | null {
  const raw = asString(payload['q_beschwerde']) ?? asString(payload['s_symptome']);
  if (!raw) return null;
  const first = raw
    .toLowerCase()
    .split(/[\s,/.;-]+/)
    .find((w) => w.length >= 3);
  return first ?? null;
}

export function aggregateEvent(contacts: DecryptedContact[]): EventStats {
  // Drop superseded records (corrections append a new record with supersedes set).
  const supersededIds = new Set<string>();
  for (const c of contacts) if (c.supersedes) supersededIds.add(c.supersedes);
  let live = contacts.filter((c) => !supersededIds.has(c.id));

  // ÜBUNGS-/DEMO-MODUS: a TRAINING deployment is one whose contacts are ALL
  // training records — its statistik shows the exercise figures under an ÜBUNG
  // banner. For a REAL deployment, any stray training records are EXCLUDED so
  // practice data never inflates real figures (invariant: training never counts
  // toward a real deployment).
  const trainingCount = live.filter((c) => c.training).length;
  const isTraining = live.length > 0 && trainingCount === live.length;
  if (!isTraining) live = live.filter((c) => !c.training);

  let quickContacts = 0;
  let protocolContacts = 0;

  const versorgungMap = new Map<string, number>();
  const verbleibMap = new Map<string, number>();
  const severityMap = new Map<string, number>();
  const ageMap = new Map<string, number>();
  const sexMap = new Map<string, number>();
  const complaintMap = new Map<string, number>();
  const hourMap = new Map<string, number>();

  let transport = 0;
  let refusal = 0;
  let other = 0;

  for (const c of live) {
    if (c.quick) quickContacts++;
    else protocolContacts++;

    const p = c.payload;
    bump(versorgungMap, asString(p['q_versorgungsart']));
    bump(severityMap, asString(p['ersteindruck']));
    bump(ageMap, asString(p['altersgruppe']));
    bump(sexMap, asString(p['geschlecht']));
    bump(complaintMap, complaintBucket(p));
    bump(hourMap, hourKey(c.createdAt));

    const verbleib = asString(p['u_verbleib']);
    if (verbleib) {
      bump(verbleibMap, verbleib);
      if (TRANSPORT_VALUES.has(verbleib)) transport++;
      else if (REFUSAL_VALUES.has(verbleib)) refusal++;
      else other++;
    }
  }

  // perHour as a dense 00..23 series (only non-empty hours kept, sorted).
  const perHour: TimeBucket[] = [...hourMap.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return {
    totalContacts: live.length,
    protocolContacts,
    quickContacts,
    byVersorgungsart: toCounts(versorgungMap),
    byVerbleib: toCounts(verbleibMap),
    bySeverity: toCounts(severityMap),
    byAge: toCounts(ageMap),
    bySex: toCounts(sexMap),
    byComplaint: toCounts(complaintMap).slice(0, 8),
    perHour,
    disposition: { transport, refusal, other, total: transport + refusal + other },
    isTraining,
    trainingContacts: isTraining ? trainingCount : 0,
    generatedAt: new Date().toISOString(),
  };
}

/** True if this record is TRAINING/exercise data, from its encrypted-payload marker. */
export function isTrainingContact(payload: Record<string, unknown>): boolean {
  return isTrainingPayload(payload);
}

/** True if this record is a quick contact, from its encrypted-payload marker. */
export function isQuickContact(payload: Record<string, unknown>): boolean {
  return isQuickPayload(payload);
}
