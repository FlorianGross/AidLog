/**
 * export/handover.ts — data shape + helpers for the ÜBERGABE (handover) print
 * sheet.
 *
 * The handover sheet lays out a FINALIZED, decrypted record's values in
 * ISOBAR/SAMPLER structure (HandoverPrint.svelte) and carries a verification QR.
 *
 * INTEGRITY-ONLY QR: the QR encodes ONLY the record id + recordHash (base64) as
 * `aidlog:verify?id=<recordId>&h=<recordHash>`. It contains NO patient/health
 * data, so a receiver can verify the sheet's origin/integrity (the hash binds to
 * the signed record) without any plaintext leaking through the code. This keeps
 * the handover sheet consistent with the zero-knowledge model.
 */
import type { ProtocolRecord } from '@aidlog/contracts';
import type { DraftSignature } from '$lib/doc/draftStore';

/** Everything the handover print view needs — all already decrypted, in memory. */
export interface HandoverPrintData {
  /** org display name for the header, if known. */
  orgName?: string;
  /** deployment title for the header. */
  deploymentTitle: string;
  /** the signed, immutable record (for id + recordHash + integrity block). */
  record: ProtocolRecord;
  /** decrypted form values (flat field map). */
  values: Record<string, unknown>;
  /** captured signature images keyed by field key (in-memory bytes). */
  signatures: Record<string, DraftSignature>;
  /** author display name, if known (falls back to keyId). */
  authorName?: string;
}

/**
 * Build the INTEGRITY-ONLY verification string for the QR. Contains exactly the
 * record id + recordHash — NO patient data. A receiver compares this against the
 * signed record to confirm the sheet is authentic and untampered.
 */
export function handoverVerifyString(record: ProtocolRecord): string {
  const id = encodeURIComponent(record.id);
  const h = encodeURIComponent(record.recordHash);
  return `aidlog:verify?id=${id}&h=${h}`;
}

/**
 * DIVI/MIND mapping: project an ABCDE protocol payload onto the ISOBAR/SAMPLER
 * handover field keys (`h_*`) so the structured handover sheet shows the data
 * even when the record was authored with the ABCDE template.
 *
 * The mapping is a PASSIVE projection of already-documented values — no advice,
 * no derivation beyond reading the GCS total the renderer already persisted.
 * Native handover payloads (which already carry `h_*` keys) pass through
 * unchanged: each target key prefers an existing `h_*` value before falling
 * back to its ABCDE source.
 */
const ABCDE_TO_HANDOVER: Record<string, string> = {
  h_patient_kennung: 'patient_kennung',
  h_alter: 'alter',
  h_geschlecht: 'geschlecht',
  h_leitsymptom: 's_symptome',
  h_bewusstsein: 'd_avpu',
  h_gcs: 'd_gcs_total',
  h_naca: 'naca',
  h_af: 'b_af',
  h_spo2: 'b_spo2',
  h_puls: 'c_puls',
  h_rr_sys: 'c_rr_sys',
  h_rr_dia: 'c_rr_dia',
  h_bz: 'd_bz',
  h_temp: 'e_temperatur',
  h_s_symptome: 's_symptome',
  h_a_allergien: 'a_allergien',
  h_m_medikamente: 'm_medikamente',
  h_p_vorerkrankungen: 'p_vorerkrankungen',
  h_l_letzte_mahlzeit: 'l_letzte_mahlzeit',
  h_e_ereignis: 'e_ereignis',
  h_r_risikofaktoren: 'r_risikofaktoren',
  h_verdachtsdiagnose: 'verdachtsdiagnose',
  h_massnahmen: 'm_massnahmen',
  h_verbleib: 'u_verbleib',
  h_uebergabe_an: 'u_uebergabe_an',
  h_zielklinik: 'u_zielklinik',
  h_uebergabezeit: 'u_uebergabezeit',
};

/**
 * Return a values map keyed by the handover schema's `h_*` keys, filled from an
 * ABCDE (or native handover) payload. Existing `h_*` values win over the mapped
 * ABCDE source so a native handover record is unaffected.
 */
export function mapToHandoverValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const [target, source] of Object.entries(ABCDE_TO_HANDOVER)) {
    const existing = out[target];
    if (existing !== undefined && existing !== null && existing !== '') continue;
    const mapped = values[source];
    if (mapped !== undefined && mapped !== null && mapped !== '') out[target] = mapped;
  }
  return out;
}

/** One structured medication row (from the ABCDE `medikamente` group). */
export interface HandoverMedication {
  mittel?: string;
  dosis?: string;
  einheit?: string;
  weg?: string;
  uhrzeit?: string;
  person?: string;
}

/**
 * Extract the structured medication list (ABCDE `medikamente` group) for the
 * handover sheet. Empty rows are dropped. Falls back to the legacy free-text
 * `m_medikamentengabe` key as a single synthetic row when no group is present,
 * so older records still surface their medication note.
 */
export function handoverMedications(values: Record<string, unknown>): HandoverMedication[] {
  const raw = values['medikamente'];
  if (Array.isArray(raw)) {
    return (raw as Record<string, unknown>[])
      .map((r) => ({
        mittel: str(r.mittel),
        dosis: str(r.dosis),
        einheit: str(r.einheit),
        weg: str(r.weg),
        uhrzeit: str(r.uhrzeit),
        person: str(r.person),
      }))
      .filter((m) => m.mittel || m.dosis || m.weg || m.uhrzeit || m.person);
  }
  const legacy = str(values['m_medikamentengabe']);
  return legacy ? [{ mittel: legacy }] : [];
}

/** A single labelled timeline entry for the handover sheet. */
export interface HandoverTime {
  label: string;
  value: string;
}

/**
 * The DIVI/MIND-relevant timeline steps, as label/value pairs, dropping empties.
 * Values are ISO datetime strings; the print view formats them for display.
 */
export function handoverTimeline(values: Record<string, unknown>): HandoverTime[] {
  const steps: Array<[string, string]> = [
    ['Alarmierung', 'alarmzeit'],
    ['Eintreffen Einsatzort', 'zeit_eintreffen'],
    ['Erstkontakt Patient', 'zeit_erstkontakt'],
    ['Beginn Maßnahmen', 'zeit_massnahmenbeginn'],
    ['Transportbeginn', 'zeit_transportbeginn'],
    ['Übergabe', 'u_uebergabezeit'],
  ];
  const out: HandoverTime[] = [];
  for (const [label, key] of steps) {
    const v = str(values[key]);
    if (v) out.push({ label, value: v });
  }
  return out;
}

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v).trim();
}
