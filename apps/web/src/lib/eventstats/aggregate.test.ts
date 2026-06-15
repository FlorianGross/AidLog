/**
 * eventstats/aggregate.test.ts — per-deployment Kontakt aggregation.
 *
 * Pure logic: counts full protocols + quick contacts, derives disposition from
 * u_verbleib, drops superseded records, and buckets by hour. No crypto / I/O.
 */
import { describe, it, expect } from 'vitest';
import { aggregateEvent, isTrainingContact, type DecryptedContact } from './aggregate';
import { buildQuickPayload, isQuickPayload, QUICK_FLAG_KEY } from '$lib/quickentry';
import { TRAINING_FLAG_KEY, isTrainingPayload } from '$lib/training';

function contact(over: Partial<DecryptedContact>): DecryptedContact {
  return {
    id: over.id ?? globalThis.crypto.randomUUID(),
    seq: over.seq ?? 0,
    createdAt: over.createdAt ?? '2026-06-11T10:00:00.000Z',
    supersedes: over.supersedes ?? null,
    quick: over.quick ?? false,
    training: over.training ?? false,
    payload: over.payload ?? {},
  };
}

describe('aggregateEvent', () => {
  it('counts both full protocols and quick contacts', () => {
    const stats = aggregateEvent([
      contact({ quick: false, payload: { u_verbleib: 'klinik', ersteindruck: 'kritisch' } }),
      contact({ quick: true, payload: { [QUICK_FLAG_KEY]: true, u_verbleib: 'rtw' } }),
      contact({ quick: true, payload: { [QUICK_FLAG_KEY]: true, u_verbleib: 'verweigerung' } }),
    ]);
    expect(stats.totalContacts).toBe(3);
    expect(stats.protocolContacts).toBe(1);
    expect(stats.quickContacts).toBe(2);
  });

  it('derives transport/refusal disposition from u_verbleib', () => {
    const stats = aggregateEvent([
      contact({ payload: { u_verbleib: 'rtw' } }),
      contact({ payload: { u_verbleib: 'notarzt' } }),
      contact({ payload: { u_verbleib: 'verweigerung' } }),
      contact({ payload: { u_verbleib: 'vor_ort' } }),
    ]);
    expect(stats.disposition.transport).toBe(2);
    expect(stats.disposition.refusal).toBe(1);
    expect(stats.disposition.other).toBe(1);
    expect(stats.disposition.total).toBe(4);
  });

  it('drops superseded records', () => {
    const stats = aggregateEvent([
      contact({ id: 'a', payload: { u_verbleib: 'rtw' } }),
      contact({ id: 'b', supersedes: 'a', payload: { u_verbleib: 'vor_ort' } }),
    ]);
    expect(stats.totalContacts).toBe(1);
    expect(stats.disposition.transport).toBe(0);
    expect(stats.disposition.other).toBe(1);
  });

  it('buckets contacts by hour-of-day', () => {
    const stats = aggregateEvent([
      contact({ createdAt: '2026-06-11T08:15:00.000Z' }),
      contact({ createdAt: '2026-06-11T08:45:00.000Z' }),
    ]);
    const total = stats.perHour.reduce((s, b) => s + b.count, 0);
    expect(total).toBe(2);
  });
});

describe('quick payload marker', () => {
  it('buildQuickPayload sets the quick flag and maps versorgungsart to u_verbleib', () => {
    const p = buildQuickPayload({
      time: '2026-06-11T10:00:00.000Z',
      versorgungsart: 'rtw',
      verbleib: '',
      altersgruppe: 'erwachsen',
      geschlecht: 'w',
      beschwerde: 'Kopfschmerz',
    });
    expect(isQuickPayload(p)).toBe(true);
    expect(p.u_verbleib).toBe('rtw');
    expect(p.altersgruppe).toBe('erwachsen');
  });

  it('an explicit verbleib overrides the versorgungsart mapping', () => {
    const p = buildQuickPayload({
      time: '2026-06-11T10:00:00.000Z',
      versorgungsart: 'ambulant',
      verbleib: 'hausarzt',
      altersgruppe: 'senior',
      geschlecht: 'm',
      beschwerde: '',
    });
    expect(p.u_verbleib).toBe('hausarzt');
  });

  it('isQuickPayload is false for a full protocol payload', () => {
    expect(isQuickPayload({ u_verbleib: 'klinik' })).toBe(false);
    expect(isQuickPayload(null)).toBe(false);
  });
});

describe('training (Übungs-/Demo-Modus)', () => {
  it('isTrainingPayload / isTrainingContact detect the marker', () => {
    expect(isTrainingPayload({ [TRAINING_FLAG_KEY]: true })).toBe(true);
    expect(isTrainingContact({ [TRAINING_FLAG_KEY]: true })).toBe(true);
    expect(isTrainingPayload({ u_verbleib: 'klinik' })).toBe(false);
    expect(isTrainingPayload(null)).toBe(false);
    expect(isTrainingPayload(undefined)).toBe(false);
  });

  it('a training deployment (all training) counts contacts under the ÜBUNG flag', () => {
    const stats = aggregateEvent([
      contact({ training: true, payload: { [TRAINING_FLAG_KEY]: true, u_verbleib: 'rtw' } }),
      contact({ training: true, payload: { [TRAINING_FLAG_KEY]: true, u_verbleib: 'klinik' } }),
    ]);
    expect(stats.isTraining).toBe(true);
    expect(stats.trainingContacts).toBe(2);
    expect(stats.totalContacts).toBe(2);
  });

  it('excludes stray training records from a REAL deployment', () => {
    const stats = aggregateEvent([
      contact({ payload: { u_verbleib: 'klinik' } }),
      contact({ training: true, payload: { [TRAINING_FLAG_KEY]: true, u_verbleib: 'rtw' } }),
    ]);
    expect(stats.isTraining).toBe(false);
    expect(stats.trainingContacts).toBe(0);
    expect(stats.totalContacts).toBe(1);
    expect(stats.disposition.transport).toBe(1); // only the real klinik contact
  });
});
