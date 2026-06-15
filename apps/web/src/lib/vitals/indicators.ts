/**
 * vitals/indicators.ts — auto-computed clinical indicators from a reading series.
 *
 * Pure functions (no Svelte, no crypto) so they are trivially testable and reused
 * by both the live editor and the read-only print view. All displayed numbers are
 * rounded by the caller via the helpers here.
 */
import type { VitalReading } from './types';

/** Round to a sensible number of decimals; integers stay integers. */
export function round(n: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** GCS total from a reading's stored `gcs`, clamped to the valid 3–15 band. */
export function gcsTotal(r: VitalReading | undefined): number | null {
  if (!r || typeof r.gcs !== 'number' || Number.isNaN(r.gcs)) return null;
  return Math.min(15, Math.max(3, Math.round(r.gcs)));
}

/**
 * Build a GCS total from the three ABCDE sub-scores (eyes 1–4, verbal 1–5,
 * motor 1–6) when present in the form values. Used by the editor to suggest a
 * `gcs` for a fresh reading.
 */
export function gcsFromSubscores(eyes: unknown, verbal: unknown, motor: unknown): number | null {
  const e = Number(eyes);
  const v = Number(verbal);
  const m = Number(motor);
  if (!e || !v || !m || Number.isNaN(e + v + m)) return null;
  return Math.min(15, Math.max(3, e + v + m));
}

/** Schock-Index = HF / RR systolic. >1.0 flags decompensation risk. */
export function shockIndex(r: VitalReading | undefined): number | null {
  if (!r || typeof r.hf !== 'number' || typeof r.rrSys !== 'number') return null;
  if (!r.rrSys) return null;
  return r.hf / r.rrSys;
}

export type Stability = 'stabil' | 'grenzwertig' | 'kritisch';

/**
 * A simple, conservative stability hint from the most-relevant (latest) reading.
 * NOT a medical scoring system — a coarse colour cue only. Errs toward the worse
 * category when any single parameter is out of range.
 */
export function stabilityHint(r: VitalReading | undefined): Stability | null {
  if (!r) return null;
  let critical = false;
  let borderline = false;

  const flag = (warn: boolean, crit: boolean) => {
    if (crit) critical = true;
    else if (warn) borderline = true;
  };

  if (typeof r.spo2 === 'number') flag(r.spo2 < 94, r.spo2 < 90);
  if (typeof r.hf === 'number') flag(r.hf > 100 || r.hf < 50, r.hf > 130 || r.hf < 40);
  if (typeof r.af === 'number') flag(r.af > 20 || r.af < 10, r.af > 30 || r.af < 8);
  if (typeof r.rrSys === 'number') flag(r.rrSys < 100, r.rrSys < 90);
  const gcs = gcsTotal(r);
  if (gcs !== null) flag(gcs < 14, gcs < 9);
  const si = shockIndex(r);
  if (si !== null) flag(si > 0.9, si > 1.0);

  if (critical) return 'kritisch';
  if (borderline) return 'grenzwertig';
  return 'stabil';
}

/** Map a stability category to a Badge tone. */
export function stabilityTone(s: Stability): 'ok' | 'warning' | 'danger' {
  return s === 'stabil' ? 'ok' : s === 'grenzwertig' ? 'warning' : 'danger';
}

/**
 * Pick the most-relevant reading: the chronologically latest by "HH:mm" (falling
 * back to array order when times are missing/equal).
 */
export function latestReading(readings: VitalReading[]): VitalReading | undefined {
  let best: VitalReading | undefined;
  for (const r of readings) {
    if (!best || timeKey(r) >= timeKey(best)) best = r;
  }
  return best;
}

/** Sortable key from "HH:mm" (empty sorts first). */
export function timeKey(r: VitalReading): string {
  return r.time && /^\d{1,2}:\d{2}$/.test(r.time) ? r.time.padStart(5, '0') : '';
}

/** Readings sorted chronologically for charting/tabular display. */
export function sortedReadings(readings: VitalReading[]): VitalReading[] {
  return [...readings].sort((a, b) => timeKey(a).localeCompare(timeKey(b)));
}

/* ------------------------------------------------------------------ *
 * Live clinical scores (NEWS2, qSOFA, MEWS)
 *
 * These are EARLY-WARNING aggregate scores, computed from a single
 * (latest) vital reading plus two pieces of context that are NOT part of
 * the numeric series:
 *   - whether supplemental oxygen is being given (`o2Given`)
 *   - the AVPU consciousness level (`avpu`)
 * Both come from the documentation form values and are passed in as
 * `ScoreContext`. When `avpu` is missing we derive a coarse A vs. <A from
 * the GCS total (GCS 15 ⇒ Alert), which is good enough for the score.
 *
 * They are decision-SUPPORT only and intentionally conservative: any
 * missing input simply does not contribute points, and the displayed
 * total carries a `complete` flag so the UI can warn when inputs are
 * partial. All numbers shown are integers.
 * ------------------------------------------------------------------ */

/** AVPU consciousness level. */
export type Avpu = 'A' | 'V' | 'P' | 'U';

/** Extra, non-series context needed for the aggregate scores. */
export interface ScoreContext {
  /** supplemental O₂ being administered (true ⇒ +2 in NEWS2). */
  o2Given?: boolean;
  /** AVPU level; if absent it is derived from the reading's GCS. */
  avpu?: Avpu;
}

/** Risk tier → Badge tone. */
export type RiskTone = 'ok' | 'warning' | 'danger';

/** A computed score result for display. */
export interface ScoreResult {
  /** integer total, or null when no input contributed. */
  total: number | null;
  tone: RiskTone;
  /** i18n key suffix for the escalation hint, e.g. 'high' → scores.hint.high. */
  hintKey: string;
  /** true when every input the score needs was present. */
  complete: boolean;
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v);
}

/** Derive an AVPU level: explicit context wins, else map GCS (15 ⇒ A). */
export function effectiveAvpu(r: VitalReading | undefined, ctx?: ScoreContext): Avpu | null {
  if (ctx?.avpu) return ctx.avpu;
  const g = gcsTotal(r);
  if (g === null) return null;
  return g >= 15 ? 'A' : g >= 13 ? 'V' : g >= 9 ? 'P' : 'U';
}

/**
 * NEWS2 — National Early Warning Score 2 (RCP, 2017).
 *
 * Per-parameter points (scale 1, used here):
 *   Resp. rate (/min):  ≤8 → 3 | 9–11 → 1 | 12–20 → 0 | 21–24 → 2 | ≥25 → 3
 *   SpO₂ (%, scale 1):  ≤91 → 3 | 92–93 → 2 | 94–95 → 1 | ≥96 → 0
 *   Supplemental O₂:    yes → 2 | no → 0
 *   Temperature (°C):   ≤35.0 → 3 | 35.1–36.0 → 1 | 36.1–38.0 → 0 | 38.1–39.0 → 1 | ≥39.1 → 2
 *   Systolic BP (mmHg): ≤90 → 3 | 91–100 → 2 | 101–110 → 1 | 111–219 → 0 | ≥220 → 3
 *   Heart rate (/min):  ≤40 → 3 | 41–50 → 1 | 51–90 → 0 | 91–110 → 1 | 111–130 → 2 | ≥131 → 3
 *   Consciousness:      A → 0 | V/P/U (new confusion) → 3
 *
 * Escalation (aggregate): 0 → routine; 1–4 → low (ward review);
 * 5–6 or any single 3 → medium (urgent); ≥7 → high (emergency).
 */
export function news2(r: VitalReading | undefined, ctx?: ScoreContext): ScoreResult {
  if (!r) return { total: null, tone: 'ok', hintKey: 'none', complete: false };
  let total = 0;
  let anyInput = false;
  let missing = false;
  let anySingleThree = false;

  const add = (pts: number) => {
    total += pts;
    if (pts >= 3) anySingleThree = true;
  };

  if (isNum(r.af)) {
    anyInput = true;
    if (r.af <= 8) add(3);
    else if (r.af <= 11) add(1);
    else if (r.af <= 20) add(0);
    else if (r.af <= 24) add(2);
    else add(3);
  } else missing = true;

  if (isNum(r.spo2)) {
    anyInput = true;
    if (r.spo2 <= 91) add(3);
    else if (r.spo2 <= 93) add(2);
    else if (r.spo2 <= 95) add(1);
    else add(0);
  } else missing = true;

  // O₂ supplementation always counts (default: no O₂ ⇒ 0).
  add(ctx?.o2Given ? 2 : 0);

  if (isNum(r.temp)) {
    anyInput = true;
    if (r.temp <= 35.0) add(3);
    else if (r.temp <= 36.0) add(1);
    else if (r.temp <= 38.0) add(0);
    else if (r.temp <= 39.0) add(1);
    else add(2);
  } else missing = true;

  if (isNum(r.rrSys)) {
    anyInput = true;
    if (r.rrSys <= 90) add(3);
    else if (r.rrSys <= 100) add(2);
    else if (r.rrSys <= 110) add(1);
    else if (r.rrSys <= 219) add(0);
    else add(3);
  } else missing = true;

  if (isNum(r.hf)) {
    anyInput = true;
    if (r.hf <= 40) add(3);
    else if (r.hf <= 50) add(1);
    else if (r.hf <= 90) add(0);
    else if (r.hf <= 110) add(1);
    else if (r.hf <= 130) add(2);
    else add(3);
  } else missing = true;

  const avpu = effectiveAvpu(r, ctx);
  if (avpu) {
    anyInput = true;
    add(avpu === 'A' ? 0 : 3);
  } else missing = true;

  if (!anyInput) return { total: null, tone: 'ok', hintKey: 'none', complete: false };

  // Aggregate risk + escalation hint.
  let tone: RiskTone = 'ok';
  let hintKey = 'low';
  if (total >= 7) {
    tone = 'danger';
    hintKey = 'high';
  } else if (total >= 5 || anySingleThree) {
    tone = 'warning';
    hintKey = 'medium';
  } else if (total >= 1) {
    tone = 'ok';
    hintKey = 'low';
  } else {
    tone = 'ok';
    hintKey = 'routine';
  }

  return { total, tone, hintKey, complete: !missing };
}

/**
 * qSOFA — quick Sepsis-related Organ Failure Assessment.
 *
 * One point each for:
 *   Respiratory rate ≥ 22 /min
 *   Systolic BP ≤ 100 mmHg
 *   Altered mentation (GCS < 15)
 *
 * ≥2 points flags a markedly higher risk of poor outcome in suspected
 * infection → escalate.
 */
export function qsofa(r: VitalReading | undefined, ctx?: ScoreContext): ScoreResult {
  if (!r) return { total: null, tone: 'ok', hintKey: 'none', complete: false };
  let total = 0;
  let anyInput = false;
  let missing = false;

  if (isNum(r.af)) {
    anyInput = true;
    if (r.af >= 22) total += 1;
  } else missing = true;

  if (isNum(r.rrSys)) {
    anyInput = true;
    if (r.rrSys <= 100) total += 1;
  } else missing = true;

  const g = gcsTotal(r);
  const avpu = effectiveAvpu(r, ctx);
  if (g !== null) {
    anyInput = true;
    if (g < 15) total += 1;
  } else if (avpu) {
    anyInput = true;
    if (avpu !== 'A') total += 1;
  } else missing = true;

  if (!anyInput) return { total: null, tone: 'ok', hintKey: 'none', complete: false };

  const tone: RiskTone = total >= 2 ? 'danger' : total === 1 ? 'warning' : 'ok';
  const hintKey = total >= 2 ? 'sepsis' : total === 1 ? 'watch' : 'routine';
  return { total, tone, hintKey, complete: !missing };
}

/**
 * MEWS — Modified Early Warning Score (classic 5-parameter form).
 *
 *   Systolic BP (mmHg): ≤70 → 3 | 71–80 → 2 | 81–100 → 1 | 101–199 → 0 | ≥200 → 2
 *   Heart rate (/min):  <40 → 2 | 40–50 → 1 | 51–100 → 0 | 101–110 → 1 | 111–129 → 2 | ≥130 → 3
 *   Resp. rate (/min):  <9 → 2 | 9–14 → 0 | 15–20 → 1 | 21–29 → 2 | ≥30 → 3
 *   Temperature (°C):   <35 → 2 | 35–38.4 → 0 | ≥38.5 → 2
 *   AVPU:               A → 0 | V → 1 | P → 2 | U → 3
 *
 * ≥5 (or any single 3) is a common trigger threshold for urgent review.
 */
export function mews(r: VitalReading | undefined, ctx?: ScoreContext): ScoreResult {
  if (!r) return { total: null, tone: 'ok', hintKey: 'none', complete: false };
  let total = 0;
  let anyInput = false;
  let missing = false;
  let anySingleThree = false;

  const add = (pts: number) => {
    total += pts;
    if (pts >= 3) anySingleThree = true;
  };

  if (isNum(r.rrSys)) {
    anyInput = true;
    if (r.rrSys <= 70) add(3);
    else if (r.rrSys <= 80) add(2);
    else if (r.rrSys <= 100) add(1);
    else if (r.rrSys <= 199) add(0);
    else add(2);
  } else missing = true;

  if (isNum(r.hf)) {
    anyInput = true;
    if (r.hf < 40) add(2);
    else if (r.hf <= 50) add(1);
    else if (r.hf <= 100) add(0);
    else if (r.hf <= 110) add(1);
    else if (r.hf <= 129) add(2);
    else add(3);
  } else missing = true;

  if (isNum(r.af)) {
    anyInput = true;
    if (r.af < 9) add(2);
    else if (r.af <= 14) add(0);
    else if (r.af <= 20) add(1);
    else if (r.af <= 29) add(2);
    else add(3);
  } else missing = true;

  if (isNum(r.temp)) {
    anyInput = true;
    if (r.temp < 35) add(2);
    else if (r.temp <= 38.4) add(0);
    else add(2);
  } else missing = true;

  const avpu = effectiveAvpu(r, ctx);
  if (avpu) {
    anyInput = true;
    add(avpu === 'A' ? 0 : avpu === 'V' ? 1 : avpu === 'P' ? 2 : 3);
  } else missing = true;

  if (!anyInput) return { total: null, tone: 'ok', hintKey: 'none', complete: false };

  const tone: RiskTone = total >= 5 || anySingleThree ? 'danger' : total >= 3 ? 'warning' : 'ok';
  const hintKey = total >= 5 || anySingleThree ? 'urgent' : total >= 3 ? 'review' : 'routine';
  return { total, tone, hintKey, complete: !missing };
}

/**
 * Read the score context out of the flat documentation form `values`.
 * - O₂-Gabe: true if the B-section measures list O₂, an O₂ flow is set, or a
 *   yes/no flag is set.
 * - AVPU: the D-section `d_avpu` select.
 */
export function scoreContextFromValues(values: Record<string, unknown>): ScoreContext {
  const ctx: ScoreContext = {};

  const bMass = values['b_massnahmen'];
  const o2Flow = values['b_o2_fluss'];
  const o2Flag = values['o2_gabe'];
  const o2 =
    (Array.isArray(bMass) && bMass.includes('o2')) ||
    (isNum(o2Flow) && o2Flow > 0) ||
    o2Flag === 'ja' ||
    o2Flag === true;
  if (o2) ctx.o2Given = true;

  const avpu = values['d_avpu'];
  if (avpu === 'A' || avpu === 'V' || avpu === 'P' || avpu === 'U') ctx.avpu = avpu;

  return ctx;
}
