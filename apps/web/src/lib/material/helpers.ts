/**
 * material/helpers.ts — PURE derivations for the inventory module.
 *
 * Low-stock + expiry status are computed from a {@link MaterialItem}'s raw
 * fields. These functions are PURE and TESTABLE: the "now" reference time is
 * always passed in by the caller (the component supplies `new Date()`), never
 * read from the ambient clock here — so the privacy-lint / no-impure-module gate
 * stays clean and the logic is deterministic in tests.
 *
 * OPERATIONAL LOGISTICS only — these helpers never touch patient/health data.
 */
import type { MaterialItem } from '@aidlog/contracts';

/** Default window (days) within which an upcoming expiry counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

/** True when the item has a threshold and its stock is at or below it. */
export function isLowStock(item: Pick<MaterialItem, 'stockQuantity' | 'minQuantity'>): boolean {
  if (item.minQuantity == null) return false;
  return item.stockQuantity <= item.minQuantity;
}

/**
 * Parse an ISO calendar date (YYYY-MM-DD) to a UTC-midnight timestamp (ms), or
 * null if absent/malformed. Using UTC midnight keeps the day comparison stable
 * regardless of the viewer's timezone.
 */
function expiryMs(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiresAt);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

/** Start-of-day (UTC) for the reference `now`, so "today" itself never counts as expired. */
function startOfDayUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

/** True when the item has an expiry date strictly before today (relative to `now`). */
export function isExpired(item: Pick<MaterialItem, 'expiresAt'>, now: Date): boolean {
  const exp = expiryMs(item.expiresAt);
  if (exp == null) return false;
  return exp < startOfDayUtc(now);
}

/**
 * True when the item expires within the next `withinDays` days (inclusive of
 * today) but is not already expired. Default window: {@link EXPIRING_SOON_DAYS}.
 */
export function isExpiringSoon(
  item: Pick<MaterialItem, 'expiresAt'>,
  now: Date,
  withinDays: number = EXPIRING_SOON_DAYS,
): boolean {
  const exp = expiryMs(item.expiresAt);
  if (exp == null) return false;
  const today = startOfDayUtc(now);
  if (exp < today) return false; // already expired
  const horizon = today + withinDays * 24 * 60 * 60 * 1000;
  return exp <= horizon;
}

export type MaterialStatus = {
  lowStock: boolean;
  expired: boolean;
  expiringSoon: boolean;
};

/** Combined status flags for an item at reference time `now`. */
export function materialStatus(
  item: Pick<MaterialItem, 'stockQuantity' | 'minQuantity' | 'expiresAt'>,
  now: Date,
  withinDays: number = EXPIRING_SOON_DAYS,
): MaterialStatus {
  return {
    lowStock: isLowStock(item),
    expired: isExpired(item, now),
    expiringSoon: isExpiringSoon(item, now, withinDays),
  };
}
