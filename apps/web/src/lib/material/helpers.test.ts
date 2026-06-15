/**
 * Unit tests for the inventory PURE helpers (no Svelte/DOM needed). The "now"
 * reference is always injected, so these are deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  isLowStock,
  isExpired,
  isExpiringSoon,
  materialStatus,
  EXPIRING_SOON_DAYS,
} from './helpers';

const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('isLowStock', () => {
  it('is false when there is no threshold', () => {
    expect(isLowStock({ stockQuantity: 0, minQuantity: null })).toBe(false);
    expect(isLowStock({ stockQuantity: 0, minQuantity: undefined as unknown as null })).toBe(false);
  });

  it('is true when stock is at or below the threshold', () => {
    expect(isLowStock({ stockQuantity: 5, minQuantity: 5 })).toBe(true);
    expect(isLowStock({ stockQuantity: 3, minQuantity: 5 })).toBe(true);
    expect(isLowStock({ stockQuantity: 0, minQuantity: 0 })).toBe(true);
  });

  it('is false when stock is above the threshold', () => {
    expect(isLowStock({ stockQuantity: 6, minQuantity: 5 })).toBe(false);
  });
});

describe('isExpired', () => {
  it('is false without an expiry date', () => {
    expect(isExpired({ expiresAt: null }, NOW)).toBe(false);
    expect(isExpired({ expiresAt: '' }, NOW)).toBe(false);
  });

  it('is true for a date strictly before today', () => {
    expect(isExpired({ expiresAt: '2026-06-14' }, NOW)).toBe(true);
    expect(isExpired({ expiresAt: '2020-01-01' }, NOW)).toBe(true);
  });

  it('is false for today and future dates', () => {
    expect(isExpired({ expiresAt: '2026-06-15' }, NOW)).toBe(false);
    expect(isExpired({ expiresAt: '2026-12-31' }, NOW)).toBe(false);
  });

  it('ignores malformed dates', () => {
    expect(isExpired({ expiresAt: 'not-a-date' }, NOW)).toBe(false);
  });
});

describe('isExpiringSoon', () => {
  it('is false without an expiry date', () => {
    expect(isExpiringSoon({ expiresAt: null }, NOW)).toBe(false);
  });

  it('flags a date within the default window (inclusive of today)', () => {
    expect(isExpiringSoon({ expiresAt: '2026-06-15' }, NOW)).toBe(true); // today
    expect(isExpiringSoon({ expiresAt: '2026-07-01' }, NOW)).toBe(true); // ~16 days
    const horizon = new Date('2026-07-15'); // exactly 30 days
    expect(isExpiringSoon({ expiresAt: '2026-07-15' }, NOW)).toBe(true);
    void horizon;
  });

  it('does not flag a date beyond the window', () => {
    expect(isExpiringSoon({ expiresAt: '2026-08-01' }, NOW)).toBe(false);
  });

  it('does not flag an already-expired date', () => {
    expect(isExpiringSoon({ expiresAt: '2026-06-14' }, NOW)).toBe(false);
  });

  it('respects a custom window', () => {
    expect(isExpiringSoon({ expiresAt: '2026-06-20' }, NOW, 3)).toBe(false);
    expect(isExpiringSoon({ expiresAt: '2026-06-20' }, NOW, 10)).toBe(true);
  });

  it('exports a sane default window', () => {
    expect(EXPIRING_SOON_DAYS).toBe(30);
  });
});

describe('materialStatus', () => {
  it('combines all flags', () => {
    const s = materialStatus({ stockQuantity: 2, minQuantity: 5, expiresAt: '2026-06-20' }, NOW);
    expect(s).toEqual({ lowStock: true, expired: false, expiringSoon: true });
  });

  it('marks expired without expiringSoon', () => {
    const s = materialStatus({ stockQuantity: 99, minQuantity: 5, expiresAt: '2026-01-01' }, NOW);
    expect(s).toEqual({ lowStock: false, expired: true, expiringSoon: false });
  });
});
