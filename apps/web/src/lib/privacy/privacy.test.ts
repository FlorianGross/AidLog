/**
 * Unit tests for the PURE privacy helpers (no crypto, no DOM, no server):
 * the years↔days converter, the policy cutoff maths, and the Art. 30
 * Verarbeitungsverzeichnis builder (which must contain no personal data).
 */
import { describe, it, expect } from 'vitest';
import { yearsToDays, daysToYears, policyCutoff, DAYS_PER_YEAR } from './retention';
import { buildRopa, ropaToJson } from './ropa';

describe('retention years↔days', () => {
  it('converts years to a rounded day count', () => {
    expect(yearsToDays(10)).toBe(Math.round(10 * DAYS_PER_YEAR)); // 3653
    expect(yearsToDays(1)).toBe(365);
    expect(yearsToDays(0)).toBe(0);
    expect(yearsToDays(-5)).toBe(0);
  });

  it('never returns a positive-years value below 1 day', () => {
    expect(yearsToDays(0.0001)).toBe(1);
  });

  it('converts days back to years rounded to one decimal', () => {
    expect(daysToYears(3653)).toBe(10);
    expect(daysToYears(365)).toBe(1);
    expect(daysToYears(0)).toBe(0);
  });

  it('round-trips approximately', () => {
    const days = yearsToDays(7);
    expect(daysToYears(days)).toBeCloseTo(7, 1);
  });

  it('computes a cutoff in the past', () => {
    const now = new Date('2026-06-12T00:00:00.000Z');
    const cutoff = policyCutoff(365, now);
    expect(cutoff.getTime()).toBe(now.getTime() - 365 * 86_400_000);
    expect(cutoff.getTime()).toBeLessThan(now.getTime());
  });
});

describe('Verarbeitungsverzeichnis (Art. 30)', () => {
  it('templates the org name + retention and lists the TOMs', () => {
    const doc = buildRopa({ orgName: 'DRK Musterstadt', retentionDays: 3653 });
    expect(doc.orgName).toBe('DRK Musterstadt');
    const json = ropaToJson(doc);
    expect(json).toContain('DRK Musterstadt');
    expect(json).toContain('Crypto-Shredding');
    expect(json).toContain('Zero-Knowledge');
    expect(json).toContain('Art. 9');
    // retention rendered with days + approx years
    expect(json).toContain('3653');
  });

  it('handles an unconfigured retention period', () => {
    const doc = buildRopa({ orgName: 'Test', retentionDays: null });
    const json = ropaToJson(doc);
    expect(json).toContain('noch nicht konfiguriert');
  });

  it('contains no obvious personal-data placeholders beyond the org name', () => {
    const doc = buildRopa({ orgName: 'Org', retentionDays: 100 });
    // The document is factual config; it must not embed patient identifiers.
    const json = ropaToJson(doc).toLowerCase();
    expect(json).not.toContain('patient:');
    expect(json).not.toContain('geburtsdatum:');
  });
});
