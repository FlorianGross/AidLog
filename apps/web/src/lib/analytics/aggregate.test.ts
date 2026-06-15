/**
 * Unit tests for the pure analytics aggregation + anonymised export. No crypto,
 * no DOM — exercises the whitelist, dedup-by-supersede, time series, vitals,
 * disposition and the injury heatmap binning.
 */
import { describe, it, expect } from 'vitest';
import { aggregate, type DecryptedEntry } from './aggregate';
import { toCsv, toJson, ANONYMISATION_NOTICE } from './export';

function entry(p: Partial<DecryptedEntry> & { payload: Record<string, unknown> }): DecryptedEntry {
  return {
    id: p.id ?? crypto.randomUUID(),
    deploymentId: p.deploymentId ?? crypto.randomUUID(),
    seq: p.seq ?? 0,
    createdAt: p.createdAt ?? '2026-01-15T10:00:00.000Z',
    supersedes: p.supersedes ?? null,
    payload: p.payload,
  };
}

describe('aggregate', () => {
  it('counts deployments and protocols, dedups superseded records', () => {
    const dep = 'd1';
    const r0 = entry({ id: 'r0', deploymentId: dep, seq: 0, payload: { u_verbleib: 'rtw' } });
    // r1 supersedes r0 → r0 dropped from the protocol view, both processed.
    const r1 = entry({
      id: 'r1',
      deploymentId: dep,
      seq: 1,
      supersedes: 'r0',
      payload: { u_verbleib: 'klinik' },
    });
    const other = entry({ deploymentId: 'd2', payload: { u_verbleib: 'verweigerung' } });

    const res = aggregate([r0, r1, other]);
    expect(res.totalDeployments).toBe(2);
    expect(res.totalProtocols).toBe(2); // latest of d1 + d2
    expect(res.recordsProcessed).toBe(3);
    // disposition: d1 latest = klinik (transport), d2 = verweigerung (refusal)
    expect(res.disposition.transport).toBe(1);
    expect(res.disposition.refusal).toBe(1);
  });

  it('excludes training (Übungs-/Demo-Modus) records entirely', () => {
    const real = entry({ deploymentId: 'd1', payload: { u_verbleib: 'klinik' } });
    const training = entry({
      deploymentId: 'd2',
      payload: { __training__: true, u_verbleib: 'rtw', ersteindruck: 'kritisch' },
    });
    const res = aggregate([real, training]);
    // The training deployment/record is dropped up front: not a deployment, not a
    // protocol, not processed, and contributes nothing to disposition.
    expect(res.totalDeployments).toBe(1);
    expect(res.totalProtocols).toBe(1);
    expect(res.recordsProcessed).toBe(1);
    expect(res.disposition.transport).toBe(1); // only the real klinik record
    expect(res.distributions.some((d) => d.field === 'ersteindruck')).toBe(false);
  });

  it('builds categorical distributions only for whitelisted fields', () => {
    const res = aggregate([
      entry({
        payload: { ersteindruck: 'kritisch', patient_kennung: 'A.B.', einsatzort: 'Halle 3' },
      }),
      entry({ payload: { ersteindruck: 'kritisch' } }),
      entry({ payload: { ersteindruck: 'unauffaellig' } }),
    ]);
    const dist = res.distributions.find((d) => d.field === 'ersteindruck');
    expect(dist).toBeDefined();
    expect(dist!.total).toBe(3);
    expect(dist!.counts[0]).toEqual({ value: 'kritisch', count: 2 });
    // Identifying fields never become a distribution.
    expect(res.distributions.some((d) => d.field === 'patient_kennung')).toBe(false);
    expect(res.distributions.some((d) => d.field === 'einsatzort')).toBe(false);
  });

  it('averages vitals and drops out-of-range typos', () => {
    const res = aggregate([
      entry({ payload: { c_puls: 80 } }),
      entry({ payload: { c_puls: 120 } }),
      entry({ payload: { c_puls: 9999 } }), // out of range → ignored
    ]);
    const puls = res.vitals.find((v) => v.key === 'c_puls');
    expect(puls).toBeDefined();
    expect(puls!.count).toBe(2);
    expect(puls!.average).toBe(100);
  });

  it('bins body-map markers into a heatmap and breaks down by type/severity', () => {
    const markers = [
      { id: 'm1', x: 0.5, y: 0.1, side: 'front', type: 'wunde', severity: 'schwer' },
      { id: 'm2', x: 0.5, y: 0.1, side: 'front', type: 'wunde', severity: 'leicht' },
      { id: 'm3', x: 0.2, y: 0.9, side: 'back', type: 'fraktur', severity: 'mittel' },
    ];
    const res = aggregate([entry({ payload: { bodymap: markers } })]);
    expect(res.injuries.total).toBe(3);
    expect(res.injuries.byType.wunde).toBe(2);
    expect(res.injuries.bySeverity.schwer).toBe(1);
    // Two markers share a cell → peak 2.
    expect(res.heatPeak).toBe(2);
    const hot = res.heat.find((h) => h.side === 'front' && h.count === 2);
    expect(hot).toBeDefined();
  });

  it('builds per-day and per-month series sorted ascending', () => {
    const res = aggregate([
      entry({ createdAt: '2026-02-01T08:00:00.000Z', payload: {} }),
      entry({ createdAt: '2026-01-15T08:00:00.000Z', payload: {} }),
      entry({ createdAt: '2026-01-15T20:00:00.000Z', payload: {} }),
    ]);
    expect(res.perMonth.map((b) => b.label)).toEqual(['2026-01', '2026-02']);
    const jan = res.perDay.find((b) => b.label === '2026-01-15');
    expect(jan!.count).toBe(2);
  });
});

describe('anonymised export', () => {
  const res = aggregate([
    entry({ payload: { ersteindruck: 'kritisch', c_puls: 88, patient_kennung: 'X.Y.' } }),
  ]);

  it('JSON export carries the anonymisation notice and no raw payload', () => {
    const json = toJson(res);
    expect(json).toContain(ANONYMISATION_NOTICE);
    expect(json).not.toContain('X.Y.'); // identifier never present
  });

  it('CSV export is aggregate-only and uses a label resolver', () => {
    const csv = toCsv(res, (kind, key) => (kind === 'field' ? `LABEL_${key}` : key));
    expect(csv).toContain(ANONYMISATION_NOTICE);
    expect(csv).toContain('LABEL_ersteindruck');
    expect(csv).not.toContain('X.Y.');
  });
});
