/**
 * lib/privacy/retention.ts — pure helpers for the retention UI.
 *
 * A friendly years↔days converter so an admin can think in years while the
 * server stores an exact day count (measured from records.received_at). Pure
 * and side-effect-free so it is trivially unit-testable.
 */

/** Days per (Gregorian average) year, matching the server's 365.25 basis. */
export const DAYS_PER_YEAR = 365.25;

/** Convert a whole/partial number of years to a rounded day count (>= 1). */
export function yearsToDays(years: number): number {
  if (!Number.isFinite(years) || years <= 0) return 0;
  return Math.max(1, Math.round(years * DAYS_PER_YEAR));
}

/** Convert a day count to years, rounded to one decimal for display. */
export function daysToYears(days: number): number {
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.round((days / DAYS_PER_YEAR) * 10) / 10;
}

/**
 * Compute the policy cutoff date for a given retention period: records received
 * before this instant are eligible for erasure. Mirrors the server's
 * now() - retention_days arithmetic; for display/preview only (the server is
 * authoritative).
 */
export function policyCutoff(retentionDays: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - retentionDays * 86_400_000);
}
