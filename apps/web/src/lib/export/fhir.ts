/**
 * export/fhir.ts — pseudonymized FHIR R4 export (pure, client-side).
 *
 * `toFhirBundle` maps an already-decrypted ABCDE protocol payload onto a
 * minimal, well-formed FHIR R4 `Bundle` (type `collection`) of plain JS
 * objects. It runs purely on in-memory plaintext and NEVER sends anything
 * anywhere — the UI hands the result to `downloadJson` which triggers a local
 * file download, fully consistent with the zero-knowledge model.
 *
 * PSEUDONYMIZATION INVARIANT: the Bundle carries ONLY pseudonymous identifiers
 * (patient_kennung / initials), age, sex and coded clinical data. NO real
 * patient name, NO birthDate, NO helper secret material is ever emitted. A
 * machine-readable note on the Patient + an extension on the Bundle mark the
 * export as pseudonymized per the org's documentation.
 *
 * LOINC vs local codes: for vitals we use real LOINC codes where we are
 * confident (SpO2 59408-5, resp rate 9279-1, heart rate 8867-4, systolic
 * 8480-6, diastolic 8462-4, body temp 8310-5, glucose 2339-0, GCS total
 * 9269-2). We DO NOT invent LOINC numbers; anything uncertain would fall back
 * to the local system `https://aidlog.app/fhir/vital` keyed by the field key.
 */

/** Minimal structural typing for the FHIR objects we emit (not exhaustive). */
export interface FhirCoding {
  system?: string;
  code: string;
  display?: string;
}
export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}
export interface FhirQuantity {
  value: number;
  unit?: string;
  system?: string;
  code?: string;
}
export interface FhirResource {
  resourceType: string;
  [k: string]: unknown;
}
export interface FhirBundleEntry {
  fullUrl?: string;
  resource: FhirResource;
}
export interface FhirBundle {
  resourceType: 'Bundle';
  type: 'collection';
  meta?: { tag?: FhirCoding[] };
  timestamp?: string;
  entry: FhirBundleEntry[];
}

/** One structured medication row (from the ABCDE `medikamente` group). */
interface MedRow {
  mittel?: string;
  dosis?: string;
  einheit?: string;
  weg?: string;
  uhrzeit?: string;
  person?: string;
}

/** Input to the FHIR mapper — already-decrypted, in-memory values + metadata. */
export interface FhirExportInput {
  /** flat decrypted form values (ABCDE field map). */
  values: Record<string, unknown>;
  /** record id (used as a stable resource id suffix). */
  recordId: string;
  /** record integrity hash (carried as a Bundle tag, non-secret). */
  recordHash?: string;
  /** schema id/version for provenance. */
  schemaId?: string;
  schemaVersion?: number;
  /** ISO timestamp injected by the caller (pure module: no Date.now here). */
  exportedAt: string;
  /**
   * ÜBUNGS-/DEMO-MODUS: when true the source record is TRAINING/exercise data;
   * the Bundle is tagged with a `training` marker so exported practice data is
   * unmistakably flagged and never mistaken for a real protocol.
   */
  training?: boolean;
}

const LOCAL_VITAL_SYSTEM = 'https://aidlog.app/fhir/vital';
const PSEUDO_SYSTEM = 'https://aidlog.app/fhir/pseudonym';
const TRAINING_SYSTEM = 'https://aidlog.app/fhir/training';

/** Map the schema's sex code to a FHIR `AdministrativeGender`. */
export function fhirGender(geschlecht: unknown): 'female' | 'male' | 'other' | 'unknown' {
  switch (str(geschlecht)) {
    case 'w':
      return 'female';
    case 'm':
      return 'male';
    case 'd':
      return 'other';
    default:
      return 'unknown';
  }
}

/**
 * Build a pseudonymized FHIR R4 `Bundle` (type `collection`) from a decrypted
 * ABCDE payload. Resources whose source values are empty are skipped.
 */
export function toFhirBundle(input: FhirExportInput): FhirBundle {
  const { values, recordId, recordHash, exportedAt } = input;
  // ÜBUNG flag: prefer the explicit input, fall back to the payload marker so a
  // record finalized as training is flagged even if the caller did not pass it.
  const isTraining = input.training === true || values['__training__'] === true;
  const patientRef = `urn:uuid:patient-${recordId}`;
  const encounterRef = `urn:uuid:encounter-${recordId}`;
  const entries: FhirBundleEntry[] = [];

  // --- Patient (pseudonymous) ----------------------------------------------
  const kennung = str(values['patient_kennung']);
  const patient: FhirResource = {
    resourceType: 'Patient',
    id: `patient-${recordId}`,
    gender: fhirGender(values['geschlecht']),
    // Pseudonymization marker: machine-readable + human-readable.
    meta: { tag: [{ system: PSEUDO_SYSTEM, code: 'pseudonymized', display: 'Pseudonymisiert' }] },
    text: {
      status: 'generated',
      div: '<div xmlns="http://www.w3.org/1999/xhtml">Pseudonymisierter Datensatz – kein Klarname.</div>',
    },
  };
  if (kennung) {
    patient.identifier = [
      {
        use: 'secondary',
        system: PSEUDO_SYSTEM,
        value: kennung,
        type: { text: 'Pseudonym / Initialen' },
      },
    ];
  }
  // Age (years) and age band as extensions; birthDate is intentionally omitted
  // because only age/band is known (and a real DOB would de-pseudonymize).
  const alter = num(values['alter']);
  const ext: Record<string, unknown>[] = [];
  if (alter !== undefined) {
    ext.push({
      url: 'https://aidlog.app/fhir/age-years',
      valueQuantity: { value: alter, unit: 'a', system: 'http://unitsofmeasure.org', code: 'a' },
    });
  }
  const band = str(values['altersgruppe']);
  if (band) {
    ext.push({ url: 'https://aidlog.app/fhir/age-band', valueString: band });
  }
  if (ext.length > 0) patient.extension = ext;
  entries.push({ fullUrl: patientRef, resource: patient });

  // --- Encounter (the deployment/contact) ----------------------------------
  const start = isoOrUndef(values['zeit_erstkontakt']) ?? isoOrUndef(values['alarmzeit']);
  const end = isoOrUndef(values['u_uebergabezeit']) ?? isoOrUndef(values['zeit_transportbeginn']);
  const encounter: FhirResource = {
    resourceType: 'Encounter',
    id: `encounter-${recordId}`,
    status: 'finished',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'EMER',
      display: 'emergency',
    },
    subject: { reference: patientRef },
  };
  const ersteindruck = str(values['ersteindruck']);
  if (ersteindruck) {
    encounter.reasonCode = [{ text: ersteindruck }];
  }
  if (start || end) {
    encounter.period = {
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
    };
  }
  entries.push({ fullUrl: encounterRef, resource: encounter });

  // --- Observations (vitals present) ---------------------------------------
  const obsCtx = { patientRef, encounterRef, recordId, effective: start };

  pushObs(entries, obsCtx, values['b_spo2'], {
    key: 'b_spo2',
    loinc: '59408-5',
    display: 'Sauerstoffsättigung (SpO₂)',
    unit: '%',
    ucum: '%',
  });
  pushObs(entries, obsCtx, values['b_af'], {
    key: 'b_af',
    loinc: '9279-1',
    display: 'Atemfrequenz',
    unit: '/min',
    ucum: '/min',
  });
  pushObs(entries, obsCtx, values['c_puls'], {
    key: 'c_puls',
    loinc: '8867-4',
    display: 'Herzfrequenz',
    unit: '/min',
    ucum: '/min',
  });
  pushObs(entries, obsCtx, values['e_temperatur'], {
    key: 'e_temperatur',
    loinc: '8310-5',
    display: 'Körpertemperatur',
    unit: '°C',
    ucum: 'Cel',
  });
  pushObs(entries, obsCtx, values['d_bz'], {
    key: 'd_bz',
    loinc: '2339-0',
    display: 'Blutzucker (Glukose)',
    unit: 'mg/dl',
    ucum: 'mg/dL',
  });
  pushObs(entries, obsCtx, values['d_gcs_total'], {
    key: 'd_gcs_total',
    loinc: '9269-2',
    display: 'Glasgow Coma Scale (gesamt)',
    unit: '{score}',
    ucum: '{score}',
  });

  // Blood pressure: a single Observation with systolic/diastolic components.
  const sys = num(values['c_rr_sys']);
  const dia = num(values['c_rr_dia']);
  if (sys !== undefined || dia !== undefined) {
    const components: Record<string, unknown>[] = [];
    if (sys !== undefined) {
      components.push({
        code: {
          coding: [
            { system: 'http://loinc.org', code: '8480-6', display: 'Systolischer Blutdruck' },
          ],
        },
        valueQuantity: quantity(sys, 'mmHg', 'mm[Hg]'),
      });
    }
    if (dia !== undefined) {
      components.push({
        code: {
          coding: [
            { system: 'http://loinc.org', code: '8462-4', display: 'Diastolischer Blutdruck' },
          ],
        },
        valueQuantity: quantity(dia, 'mmHg', 'mm[Hg]'),
      });
    }
    entries.push({
      fullUrl: `urn:uuid:obs-rr-${recordId}`,
      resource: {
        resourceType: 'Observation',
        id: `obs-rr-${recordId}`,
        status: 'final',
        category: vitalCategory(),
        code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blutdruck' }] },
        subject: { reference: patientRef },
        encounter: { reference: encounterRef },
        ...(start ? { effectiveDateTime: start } : {}),
        component: components,
      },
    });
  }

  // --- MedicationAdministration per medikamente row ------------------------
  const meds = medRows(values['medikamente']);
  meds.forEach((m, i) => {
    const dose =
      m.dosis !== undefined && m.dosis !== ''
        ? {
            ...(numStr(m.dosis) !== undefined
              ? { dose: { value: numStr(m.dosis), ...(m.einheit ? { unit: m.einheit } : {}) } }
              : {}),
            text: [m.dosis, m.einheit].filter(Boolean).join(' '),
          }
        : undefined;
    const resource: FhirResource = {
      resourceType: 'MedicationAdministration',
      id: `medadmin-${recordId}-${i}`,
      status: 'completed',
      medicationCodeableConcept: { text: m.mittel ?? '' },
      subject: { reference: patientRef },
      context: { reference: encounterRef },
    };
    if (m.uhrzeit) resource.effectiveDateTime = m.uhrzeit;
    if (dose) {
      resource.dosage = {
        ...(dose.text ? { text: dose.text } : {}),
        ...(m.weg ? { route: { text: m.weg } } : {}),
        ...('dose' in dose && dose.dose ? { dose: dose.dose } : {}),
      };
    } else if (m.weg) {
      resource.dosage = { route: { text: m.weg } };
    }
    entries.push({ fullUrl: `urn:uuid:medadmin-${recordId}-${i}`, resource });
  });

  // --- Condition for verdachtsdiagnose (text only) -------------------------
  const dx = str(values['verdachtsdiagnose']);
  if (dx) {
    entries.push({
      fullUrl: `urn:uuid:condition-${recordId}`,
      resource: {
        resourceType: 'Condition',
        id: `condition-${recordId}`,
        clinicalStatus: {
          coding: [
            { system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' },
          ],
        },
        verificationStatus: {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
              code: 'provisional',
              display: 'Verdachtsdiagnose',
            },
          ],
        },
        code: { text: dx },
        subject: { reference: patientRef },
        encounter: { reference: encounterRef },
      },
    });
  }

  const bundle: FhirBundle = {
    resourceType: 'Bundle',
    type: 'collection',
    timestamp: exportedAt,
    meta: {
      tag: [{ system: PSEUDO_SYSTEM, code: 'pseudonymized', display: 'Pseudonymisiert' }],
    },
    entry: entries,
  };
  if (recordHash) {
    // Carry the non-secret integrity hash as an additional bundle tag.
    bundle.meta!.tag!.push({ system: 'https://aidlog.app/fhir/recordHash', code: recordHash });
  }
  if (isTraining) {
    // ÜBUNG: tag training/exercise exports so they are unmistakably practice data.
    bundle.meta!.tag!.push({ system: TRAINING_SYSTEM, code: 'training', display: 'Übung / Demo' });
  }
  return bundle;
}

// --- helpers ---------------------------------------------------------------

interface VitalSpec {
  key: string;
  loinc?: string;
  display: string;
  unit: string;
  ucum?: string;
}

function pushObs(
  entries: FhirBundleEntry[],
  ctx: { patientRef: string; encounterRef: string; recordId: string; effective?: string },
  raw: unknown,
  spec: VitalSpec,
): void {
  const v = num(raw);
  if (v === undefined) return;
  const coding: FhirCoding = spec.loinc
    ? { system: 'http://loinc.org', code: spec.loinc, display: spec.display }
    : { system: LOCAL_VITAL_SYSTEM, code: spec.key, display: spec.display };
  entries.push({
    fullUrl: `urn:uuid:obs-${spec.key}-${ctx.recordId}`,
    resource: {
      resourceType: 'Observation',
      id: `obs-${spec.key}-${ctx.recordId}`,
      status: 'final',
      category: vitalCategory(),
      code: { coding: [coding] },
      subject: { reference: ctx.patientRef },
      encounter: { reference: ctx.encounterRef },
      ...(ctx.effective ? { effectiveDateTime: ctx.effective } : {}),
      valueQuantity: quantity(v, spec.unit, spec.ucum),
    },
  });
}

function vitalCategory(): Record<string, unknown>[] {
  return [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'vital-signs',
          display: 'Vital Signs',
        },
      ],
    },
  ];
}

function quantity(value: number, unit: string, ucum?: string): FhirQuantity {
  return {
    value,
    unit,
    system: 'http://unitsofmeasure.org',
    code: ucum ?? unit,
  };
}

function medRows(raw: unknown): MedRow[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[])
    .map((r) => ({
      mittel: str(r.mittel) || undefined,
      dosis: str(r.dosis) || undefined,
      einheit: str(r.einheit) || undefined,
      weg: str(r.weg) || undefined,
      uhrzeit: str(r.uhrzeit) || undefined,
      person: str(r.person) || undefined,
    }))
    .filter((m) => m.mittel || m.dosis || m.weg || m.uhrzeit || m.person);
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function numStr(v: unknown): number | undefined {
  return num(v);
}

function isoOrUndef(v: unknown): string | undefined {
  const s = str(v);
  return s || undefined;
}

/**
 * Trigger a local JSON file download (browser only). Builds a Blob and clicks a
 * transient <a>. No network, no server — the file stays on the device. Shared
 * by both the FHIR and DIVI exports.
 */
export function downloadJson(filename: string, obj: unknown): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
