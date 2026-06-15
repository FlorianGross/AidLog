/**
 * Unit tests for the pure FHIR + DIVI/MIND interop mappers. No DOM, no crypto.
 */
import { describe, it, expect } from 'vitest';
import { toFhirBundle, fhirGender, type FhirResource } from './fhir';
import { toDiviDataset } from './divi';

const EXPORTED_AT = '2026-06-14T12:00:00.000Z';

function byType(bundle: ReturnType<typeof toFhirBundle>, type: string): FhirResource[] {
  return bundle.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
}

describe('fhirGender', () => {
  it('maps schema sex codes to FHIR AdministrativeGender', () => {
    expect(fhirGender('w')).toBe('female');
    expect(fhirGender('m')).toBe('male');
    expect(fhirGender('d')).toBe('other');
    expect(fhirGender('unbekannt')).toBe('unknown');
    expect(fhirGender('')).toBe('unknown');
    expect(fhirGender(undefined)).toBe('unknown');
  });
});

describe('toFhirBundle', () => {
  it('produces a well-formed collection Bundle tagged pseudonymized', () => {
    const b = toFhirBundle({ values: {}, recordId: 'r1', exportedAt: EXPORTED_AT });
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('collection');
    expect(b.timestamp).toBe(EXPORTED_AT);
    expect(b.meta?.tag?.some((t) => t.code === 'pseudonymized')).toBe(true);
    // Patient + Encounter are always present even for an empty payload.
    expect(byType(b, 'Patient')).toHaveLength(1);
    expect(byType(b, 'Encounter')).toHaveLength(1);
  });

  it('maps gender and a pseudonymous identifier, never a real name', () => {
    const b = toFhirBundle({
      values: { geschlecht: 'w', patient_kennung: 'AB', alter: 42, altersgruppe: 'erwachsen' },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    const patient = byType(b, 'Patient')[0]!;
    expect(patient.gender).toBe('female');
    const ident = patient.identifier as Array<{ value: string }> | undefined;
    expect(ident?.[0]?.value).toBe('AB');
    // No `name` field is ever emitted.
    expect(patient.name).toBeUndefined();
    // birthDate omitted; age carried as an extension instead.
    expect(patient.birthDate).toBeUndefined();
    const ext = patient.extension as Array<{ url: string }> | undefined;
    expect(ext?.some((e) => e.url.includes('age-years'))).toBe(true);
    expect(ext?.some((e) => e.url.includes('age-band'))).toBe(true);
  });

  it('emits Observations for present vitals with units and LOINC codes', () => {
    const b = toFhirBundle({
      values: { b_spo2: 96, b_af: 14, c_puls: 80, e_temperatur: 37.2, d_bz: 110, d_gcs_total: 15 },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    const obs = byType(b, 'Observation');
    // 6 scalar vitals (no blood pressure here).
    expect(obs).toHaveLength(6);
    const spo2 = obs.find(
      (o) => (o.code as { coding: { code: string }[] }).coding[0]?.code === '59408-5',
    )!;
    const q = spo2.valueQuantity as { value: number; unit: string; system: string };
    expect(q.value).toBe(96);
    expect(q.unit).toBe('%');
    expect(q.system).toBe('http://unitsofmeasure.org');
  });

  it('combines systolic/diastolic into one BP Observation with components', () => {
    const b = toFhirBundle({
      values: { c_rr_sys: 120, c_rr_dia: 80 },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    const obs = byType(b, 'Observation');
    expect(obs).toHaveLength(1);
    const comps = obs[0]!.component as Array<{
      code: { coding: { code: string }[] };
      valueQuantity: { value: number; unit: string };
    }>;
    expect(comps).toHaveLength(2);
    expect(comps[0]?.code.coding[0]?.code).toBe('8480-6');
    expect(comps[0]?.valueQuantity.value).toBe(120);
    expect(comps[1]?.code.coding[0]?.code).toBe('8462-4');
    expect(comps[1]?.valueQuantity.unit).toBe('mmHg');
  });

  it('maps medikamente rows to MedicationAdministration and skips empty rows', () => {
    const b = toFhirBundle({
      values: {
        medikamente: [
          { mittel: 'ASS', dosis: '500', einheit: 'mg', weg: 'p.o.', uhrzeit: '10:05' },
          {}, // dropped
        ],
      },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    const meds = byType(b, 'MedicationAdministration');
    expect(meds).toHaveLength(1);
    expect((meds[0]!.medicationCodeableConcept as { text: string }).text).toBe('ASS');
    expect(meds[0]!.effectiveDateTime).toBe('10:05');
    const dosage = meds[0]!.dosage as {
      text: string;
      route: { text: string };
      dose: { value: number; unit: string };
    };
    expect(dosage.text).toBe('500 mg');
    expect(dosage.route.text).toBe('p.o.');
    expect(dosage.dose.value).toBe(500);
  });

  it('adds a Condition only when a verdachtsdiagnose is present', () => {
    const without = toFhirBundle({ values: {}, recordId: 'r1', exportedAt: EXPORTED_AT });
    expect(byType(without, 'Condition')).toHaveLength(0);
    const withDx = toFhirBundle({
      values: { verdachtsdiagnose: 'V.a. Apoplex' },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    const cond = byType(withDx, 'Condition');
    expect(cond).toHaveLength(1);
    expect((cond[0]!.code as { text: string }).text).toBe('V.a. Apoplex');
  });

  it('skips Observations whose source vitals are empty', () => {
    const b = toFhirBundle({
      values: { b_spo2: '', c_puls: null },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    expect(byType(b, 'Observation')).toHaveLength(0);
  });
});

describe('toDiviDataset', () => {
  it('groups data, marks pseudonymized, and uses the injected timestamp', () => {
    const d = toDiviDataset({
      values: { patient_kennung: 'AB', alter: 42, geschlecht: 'm', b_spo2: 96, naca: '3' },
      recordId: 'r1',
      recordHash: 'h1',
      schemaId: 'abcde-rd',
      schemaVersion: 1,
      exportedAt: EXPORTED_AT,
    });
    expect(d.meta.pseudonymized).toBe(true);
    expect(d.meta.exportedAtNote).toBe(EXPORTED_AT);
    expect(d.meta.recordId).toBe('r1');
    expect(d.meta.recordHash).toBe('h1');
    expect(d.meta.schemaId).toBe('abcde-rd');
    expect(d.patient.kennung?.value).toBe('AB');
    expect(d.patient.alter?.value).toBe(42);
    expect(d.erstbefund.b_spo2?.value).toBe(96);
    expect(d.scores.naca?.value).toBe('3');
  });

  it('omits empty fields from groups and keeps non-empty ones', () => {
    const d = toDiviDataset({
      values: { patient_kennung: '', alter: 30, c_puls: '   ' },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    expect(d.patient.kennung).toBeUndefined();
    expect(d.patient.alter?.value).toBe(30);
    expect(d.erstbefund.c_puls).toBeUndefined();
  });

  it('extracts non-empty medication rows under Maßnahmen', () => {
    const d = toDiviDataset({
      values: { medikamente: [{ mittel: 'Adrenalin', dosis: '1', einheit: 'mg' }, {}] },
      recordId: 'r1',
      exportedAt: EXPORTED_AT,
    });
    expect(d.massnahmen.medikamente).toHaveLength(1);
    expect(d.massnahmen.medikamente[0]?.mittel).toBe('Adrenalin');
  });
});
