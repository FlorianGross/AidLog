/**
 * analytics/types.ts — ORG ANALYTICS data model + the ANONYMISATION WHITELIST.
 *
 * SECURITY / PRIVACY BOUNDARY (see also $lib/crypto/session.ts, ARCHITECTURE.md):
 *   - Analytics are computed CLIENT-SIDE by an admin/lead who has unlocked the
 *     ORG key. The org password, the org secret, and every decrypted payload
 *     live in memory ONLY for the duration of a run and are zeroed afterwards.
 *   - NOTHING decrypted is ever persisted or sent to the server. The export
 *     contains ONLY the AGGREGATES defined here — never a raw payload.
 *   - The ANONYMISATION is explicit and lives in CODE: aggregation reads a
 *     WHITELIST of safe, non-identifying field keys (categorical / numeric vital
 *     ranges). Free-text and direct identifiers (patient name/initials, location,
 *     hand-over names, notes, signatures) are NEVER read into an aggregate.
 */
import type { BodySide, InjuryType, InjurySeverity } from '$lib/bodymap/types';

/**
 * Field keys that are SAFE to aggregate: bounded categorical selects or numeric
 * vitals. These map to the ABCDE starter schema (`$lib/schemas/abcde`). Anything
 * NOT in a whitelist below is treated as potentially identifying and ignored.
 *
 * IDENTIFYING / FREE-TEXT KEYS DELIBERATELY EXCLUDED (never aggregated):
 *   patient_kennung, einsatzort, einsatznummer, auffindesituation, s_symptome,
 *   a_allergien, m_medikamente, p_vorerkrankungen, e_ereignis, e_bodycheck,
 *   e_verletzungen, m_*-textareas, u_uebergabe_an, u_zielklinik, *_bemerkung,
 *   schmerz_lokalisation, sig_* (signatures), and any blob/photo.
 */

/** Categorical fields → counted by option value. */
export const CATEGORICAL_FIELDS = [
  'ersteindruck', // kritisch / lebensbedrohlich / unauffällig
  'altersgruppe',
  'geschlecht',
  'a_status', // Atemweg
  'b_atemmuster',
  'b_auskultation',
  'c_puls_qualitaet',
  'c_haut',
  'c_blutung',
  'd_avpu',
  'd_pupillen',
  'm_reanimation',
  'u_verbleib', // transport / refusal categories
  'schwangerschaft',
  'e_waermemanagement',
] as const;
export type CategoricalField = (typeof CATEGORICAL_FIELDS)[number];

/** Numeric vitals → averaged (with a plausible clamp range to drop typos). */
export interface VitalSpec {
  key: string;
  /** i18n-independent stable id; the UI maps it to a label. */
  unit: string;
  min: number;
  max: number;
}
export const VITAL_FIELDS: VitalSpec[] = [
  { key: 'b_af', unit: '/min', min: 0, max: 80 },
  { key: 'b_spo2', unit: '%', min: 0, max: 100 },
  { key: 'c_puls', unit: '/min', min: 0, max: 300 },
  { key: 'c_rr_sys', unit: 'mmHg', min: 0, max: 300 },
  { key: 'c_rr_dia', unit: 'mmHg', min: 0, max: 200 },
  { key: 'd_bz', unit: 'mg/dl', min: 0, max: 1000 },
  { key: 'e_temperatur', unit: '°C', min: 20, max: 45 },
  { key: 'schmerz_nrs', unit: 'NRS', min: 0, max: 10 },
];

/** The `u_verbleib` option values that count as a transport (vs. refusal/on-site). */
export const TRANSPORT_VALUES = new Set(['rtw', 'notarzt', 'klinik']);
/** Option values that count as a refusal of transport/treatment. */
export const REFUSAL_VALUES = new Set(['verweigerung']);

/** A counted category: option value + how often it occurred. */
export interface CategoryCount {
  value: string;
  count: number;
}

/** Aggregated counts for one categorical field. */
export interface FieldDistribution {
  field: string;
  total: number;
  counts: CategoryCount[];
}

/** Aggregated numeric vital (average over present, in-range values). */
export interface VitalStat {
  key: string;
  unit: string;
  count: number;
  average: number;
  min: number;
  max: number;
}

/** One bucket on the protocols-over-time series. */
export interface TimeBucket {
  /** ISO date (YYYY-MM-DD) for daily, or YYYY-MM for monthly. */
  label: string;
  count: number;
}

/** Aggregated heatmap weight for one body region/side. */
export interface HeatRegion {
  side: BodySide;
  /** grid cell column/row indices (for shading) and their 0..1 centre. */
  col: number;
  row: number;
  cx: number;
  cy: number;
  count: number;
}

/** Counts of injury markers by type and severity (non-identifying). */
export interface InjuryBreakdown {
  byType: Partial<Record<InjuryType, number>>;
  bySeverity: Partial<Record<InjurySeverity, number>>;
  total: number;
}

/** The complete, fully-anonymised analytics result. */
export interface AnalyticsResult {
  /** Distinct deploymentIds seen. */
  totalDeployments: number;
  /** Distinct, non-superseded protocol records. */
  totalProtocols: number;
  /** How many records were decrypted/processed (incl. superseded). */
  recordsProcessed: number;
  /** Daily series (sparse — only days with data). */
  perDay: TimeBucket[];
  /** Monthly series. */
  perMonth: TimeBucket[];
  /** Distributions for each whitelisted categorical field (non-empty only). */
  distributions: FieldDistribution[];
  /** transport vs refusal vs other, derived from u_verbleib. */
  disposition: { transport: number; refusal: number; other: number; total: number };
  /** Averaged vitals. */
  vitals: VitalStat[];
  /** Injury heatmap regions (grid-binned marker density). */
  heat: HeatRegion[];
  /** Peak count across heat regions (for shading normalisation). */
  heatPeak: number;
  /** Injury type/severity breakdown. */
  injuries: InjuryBreakdown;
  /** Time the analysis was computed (for the export header). */
  generatedAt: string;
}
