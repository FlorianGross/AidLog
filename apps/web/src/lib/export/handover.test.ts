/**
 * Unit tests for the pure DIVI/MIND handover-mapping helpers. No DOM, no crypto.
 */
import { describe, it, expect } from 'vitest';
import { mapToHandoverValues, handoverMedications, handoverTimeline } from './handover';

describe('mapToHandoverValues', () => {
  it('projects ABCDE keys onto handover h_* keys', () => {
    const m = mapToHandoverValues({ patient_kennung: 'AB', d_gcs_total: 14, naca: '3' });
    expect(m.h_patient_kennung).toBe('AB');
    expect(m.h_gcs).toBe(14);
    expect(m.h_naca).toBe('3');
  });

  it('keeps an existing h_* value over the mapped ABCDE source', () => {
    const m = mapToHandoverValues({ h_gcs: 9, d_gcs_total: 14 });
    expect(m.h_gcs).toBe(9);
  });

  it('does not invent values for absent sources', () => {
    const m = mapToHandoverValues({});
    expect(m.h_gcs).toBeUndefined();
  });
});

describe('handoverMedications', () => {
  it('returns non-empty rows from the structured group', () => {
    const rows = handoverMedications({
      medikamente: [
        { mittel: 'ASS', dosis: '500', einheit: 'mg', weg: 'p.o.' },
        {}, // dropped
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ mittel: 'ASS', dosis: '500', einheit: 'mg', weg: 'p.o.' });
    expect(rows[0]?.mittel).toBe('ASS');
  });

  it('falls back to the legacy free-text key as one synthetic row', () => {
    const rows = handoverMedications({ m_medikamentengabe: 'Adrenalin 1mg i.v.' });
    expect(rows).toEqual([{ mittel: 'Adrenalin 1mg i.v.' }]);
  });

  it('returns [] when nothing is documented', () => {
    expect(handoverMedications({})).toEqual([]);
  });
});

describe('handoverTimeline', () => {
  it('collects documented steps in canonical order and drops empties', () => {
    const t = handoverTimeline({
      alarmzeit: '2026-06-14T10:00:00.000Z',
      zeit_transportbeginn: '2026-06-14T10:20:00.000Z',
    });
    expect(t.map((s) => s.label)).toEqual(['Alarmierung', 'Transportbeginn']);
    expect(t[0]?.value).toBe('2026-06-14T10:00:00.000Z');
  });
});
