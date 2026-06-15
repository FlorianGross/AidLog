/**
 * export/divi.ts — pseudonymized DIVI/MIND core-data export (pure, client-side).
 *
 * `toDiviDataset` projects an already-decrypted ABCDE protocol payload onto a
 * structured JSON object grouped along the DIVI/MIND (Minimaler Notarztdatensatz)
 * core-data sections: Einsatzdaten, Patient/Demografie, Erstbefund/Vitalparameter,
 * Anamnese/SAMPLER, Maßnahmen/Medikamente, Verdachtsdiagnose, NACA/GCS,
 * Übergabe/Verbleib and Zeiten. Keys are flat and readable with German labels +
 * the raw coded values.
 *
 * PSEUDONYMIZATION INVARIANT: only patient_kennung/initials, age, age band and
 * sex are emitted for the patient; NO real name and NO helper secret material.
 * The `meta` block carries `pseudonymized: true` and an `exportedAtNote`
 * (timestamp passed IN — this module never calls Date.now so it stays pure and
 * testable).
 *
 * Like the FHIR export, this runs purely on in-memory plaintext and nothing is
 * sent anywhere; the UI hands the result to `downloadJson`.
 */

/** A labelled, coded value in a DIVI group (raw value preserved verbatim). */
export interface DiviField {
  label: string;
  value: unknown;
}

/** One medication row in the Maßnahmen group. */
export interface DiviMedication {
  mittel?: string;
  dosis?: string;
  einheit?: string;
  weg?: string;
  uhrzeit?: string;
  person?: string;
}

export interface DiviDataset {
  meta: {
    schemaId?: string;
    schemaVersion?: number;
    recordId: string;
    recordHash?: string;
    exportedAtNote: string;
    pseudonymized: true;
    standard: 'DIVI/MIND';
    note: string;
    /** ÜBUNGS-/DEMO-MODUS: present + true only for training/exercise exports. */
    training?: true;
  };
  einsatzdaten: Record<string, DiviField>;
  patient: Record<string, DiviField>;
  erstbefund: Record<string, DiviField>;
  anamnese: Record<string, DiviField>;
  massnahmen: {
    text: Record<string, DiviField>;
    medikamente: DiviMedication[];
  };
  verdachtsdiagnose: Record<string, DiviField>;
  scores: Record<string, DiviField>;
  uebergabe: Record<string, DiviField>;
  zeiten: Record<string, DiviField>;
}

/** Input to the DIVI mapper — already-decrypted, in-memory values + metadata. */
export interface DiviExportInput {
  /** flat decrypted form values (ABCDE field map). */
  values: Record<string, unknown>;
  /** record id for provenance. */
  recordId: string;
  /** record integrity hash (non-secret). */
  recordHash?: string;
  schemaId?: string;
  schemaVersion?: number;
  /** ISO timestamp injected by the caller (pure module: no Date.now here). */
  exportedAt: string;
  /**
   * ÜBUNGS-/DEMO-MODUS: when true the source record is TRAINING/exercise data;
   * the `meta.training` flag + a note mark exported practice data unmistakably.
   */
  training?: boolean;
}

const PSEUDO_NOTE =
  'Pseudonymisierter Export gemäß Dokumentationsvorgaben der Organisation – keine Klarnamen, nur kodierte klinische Daten.';
const TRAINING_NOTE = 'ÜBUNG/DEMO – Übungsdatensatz, keine echte Patientendokumentation.';

/**
 * Build a pseudonymized DIVI/MIND-style dataset from a decrypted ABCDE payload.
 * Only fields that are actually present (non-empty) are included in each group.
 */
export function toDiviDataset(input: DiviExportInput): DiviDataset {
  const { values, recordId, recordHash, schemaId, schemaVersion, exportedAt } = input;
  const g = (label: string, key: string) => labelled(label, values[key]);
  // ÜBUNG flag: prefer the explicit input, fall back to the payload marker.
  const isTraining = input.training === true || values['__training__'] === true;

  const dataset: DiviDataset = {
    meta: {
      schemaId,
      schemaVersion,
      recordId,
      recordHash,
      exportedAtNote: exportedAt,
      pseudonymized: true,
      standard: 'DIVI/MIND',
      note: isTraining ? `${TRAINING_NOTE} ${PSEUDO_NOTE}` : PSEUDO_NOTE,
      ...(isTraining ? { training: true as const } : {}),
    },
    einsatzdaten: compact({
      einsatznummer: g('Einsatznummer', 'einsatznummer'),
      einsatzort: g('Einsatzort', 'einsatzort'),
      ersteindruck: g('Ersteindruck', 'ersteindruck'),
      auffindesituation: g('Auffindesituation', 'auffindesituation'),
    }),
    // PSEUDONYMOUS demographics only — no real name is ever read.
    patient: compact({
      kennung: g('Patientenkennung / Initialen', 'patient_kennung'),
      alter: g('Alter (Jahre)', 'alter'),
      altersgruppe: g('Altersgruppe', 'altersgruppe'),
      geschlecht: g('Geschlecht', 'geschlecht'),
    }),
    erstbefund: compact({
      b_spo2: g('SpO₂ (%)', 'b_spo2'),
      b_af: g('Atemfrequenz (/min)', 'b_af'),
      c_puls: g('Puls (/min)', 'c_puls'),
      c_rr_sys: g('RR systolisch (mmHg)', 'c_rr_sys'),
      c_rr_dia: g('RR diastolisch (mmHg)', 'c_rr_dia'),
      e_temperatur: g('Temperatur (°C)', 'e_temperatur'),
      d_bz: g('Blutzucker (mg/dl)', 'd_bz'),
    }),
    anamnese: compact({
      s_symptome: g('Symptome / Beschwerden', 's_symptome'),
      a_allergien: g('Allergien', 'a_allergien'),
      m_medikamente: g('Medikamente (Dauermedikation)', 'm_medikamente'),
      p_vorerkrankungen: g('Vorerkrankungen', 'p_vorerkrankungen'),
      l_letzte_mahlzeit: g('Letzte Mahlzeit / Flüssigkeit', 'l_letzte_mahlzeit'),
      e_ereignis: g('Ereignis / Hergang', 'e_ereignis'),
      r_risikofaktoren: g('Risikofaktoren', 'r_risikofaktoren'),
    }),
    massnahmen: {
      text: compact({
        m_massnahmen: g('Durchgeführte Maßnahmen', 'm_massnahmen'),
        m_verlauf: g('Verlauf / Vitalwert-Trend', 'm_verlauf'),
        m_reanimation: g('Reanimation', 'm_reanimation'),
      }),
      medikamente: medRows(values['medikamente']),
    },
    verdachtsdiagnose: compact({
      verdachtsdiagnose: g('Verdachts-/Arbeitsdiagnose', 'verdachtsdiagnose'),
    }),
    scores: compact({
      naca: g('NACA-Score', 'naca'),
      d_gcs_total: g('GCS gesamt', 'd_gcs_total'),
      d_gcs_augen: g('GCS Augen', 'd_gcs_augen'),
      d_gcs_verbal: g('GCS Verbal', 'd_gcs_verbal'),
      d_gcs_motorik: g('GCS Motorik', 'd_gcs_motorik'),
    }),
    uebergabe: compact({
      u_verbleib: g('Verbleib', 'u_verbleib'),
      u_zielklinik: g('Zielklinik', 'u_zielklinik'),
    }),
    zeiten: compact({
      alarmzeit: g('Alarmierung', 'alarmzeit'),
      zeit_eintreffen: g('Eintreffen Einsatzort', 'zeit_eintreffen'),
      zeit_erstkontakt: g('Erstkontakt Patient', 'zeit_erstkontakt'),
      zeit_massnahmenbeginn: g('Beginn Maßnahmen', 'zeit_massnahmenbeginn'),
      zeit_transportbeginn: g('Transportbeginn', 'zeit_transportbeginn'),
      u_uebergabezeit: g('Übergabezeitpunkt', 'u_uebergabezeit'),
    }),
  };
  return dataset;
}

// --- helpers ---------------------------------------------------------------

function labelled(label: string, value: unknown): DiviField | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return { label, value };
}

/** Drop undefined entries so empty source fields are skipped in each group. */
function compact(obj: Record<string, DiviField | undefined>): Record<string, DiviField> {
  const out: Record<string, DiviField> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function medRows(raw: unknown): DiviMedication[] {
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
