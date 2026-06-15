/**
 * selfintake/types.ts — patient self-intake ("Selbstauskunft") data model.
 *
 * A responder hands the device to the patient in a guided, large-touch kiosk
 * flow. The patient picks a language and answers a small set of history
 * questions. On finish we do two things:
 *
 *   1. Prefill the matching SAMPLER/Anamnese protocol fields in the editor's
 *      `values` map (see SELFINTAKE_PREFILL_KEYS) so the responder can review
 *      and edit before the record is finalized.
 *   2. Store the RAW answers + the chosen language verbatim under the stable
 *      payload key `selbstauskunft` (SELFINTAKE_KEY) so the original
 *      patient-entered statement is preserved alongside the responder's
 *      (possibly edited) protocol fields.
 *
 * Like every other panel, this rides along inside the editor's `values` map and
 * is therefore part of the END-TO-END-ENCRYPTED draft + finalized record. No
 * special-casing in the crypto/finalize layer is needed.
 */

/** Stable payload key under which the raw self-intake answers are stored. */
export const SELFINTAKE_KEY = 'selbstauskunft';

/** Locales offered to the patient in the intake / communication aid. */
export type IntakeLang = 'de' | 'en' | 'tr' | 'ar' | 'ru' | 'uk' | 'fr';

/** Locales whose script is right-to-left (drives `dir="rtl"`). */
export const RTL_LANGS: ReadonlySet<IntakeLang> = new Set<IntakeLang>(['ar']);

export function isRtl(lang: IntakeLang): boolean {
  return RTL_LANGS.has(lang);
}

/**
 * The raw, patient-entered answers. Kept deliberately close to the SAMPLER
 * scheme so the prefill mapping is a 1:1 copy. All fields optional — the
 * patient may skip any question.
 */
export interface SelfIntakeAnswers {
  /** Hauptbeschwerde / chief complaint (free text in the patient's language). */
  hauptbeschwerde?: string;
  /** Pain present at all (drives whether the NRS scale is meaningful). */
  schmerzVorhanden?: 'ja' | 'nein';
  /** Numeric Rating Scale 0–10. */
  schmerzNrs?: number;
  /** Pain localisation (free text). */
  schmerzLokalisation?: string;
  /** Known allergies (free text); empty string when the patient answered "no". */
  allergien?: string;
  /** Regular medication (free text). */
  medikamente?: string;
  /** Pre-existing conditions (free text). */
  vorerkrankungen?: string;
  /** Last meal / fluid intake (free text). */
  letzteMahlzeit?: string;
  /** Pregnancy — only meaningful when offered; 'na' = question not applicable. */
  schwangerschaft?: 'ja' | 'nein' | 'unbekannt' | 'na';
}

/**
 * The complete `selbstauskunft` payload value. Versioned so a later reader can
 * tell how the answers were captured. `lang` is the language the patient chose,
 * preserved because the free-text answers are in THAT language.
 */
export interface SelfIntakeRecord {
  version: 1;
  /** Language the patient used to answer (free text is in this language). */
  lang: IntakeLang;
  answers: SelfIntakeAnswers;
  /** ISO timestamp the patient completed the flow. */
  completedAt: string;
}

/** Narrowing helper: read an existing `selbstauskunft` value from `values`. */
export function asSelfIntakeRecord(v: unknown): SelfIntakeRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<SelfIntakeRecord>;
  if (r.version !== 1 || typeof r.lang !== 'string' || typeof r.answers !== 'object') return null;
  return r as SelfIntakeRecord;
}

/**
 * The Anamnese / SAMPLER protocol field keys the self-intake prefills. These
 * MUST match the ABCDE schema's `anamnese` section keys (src/lib/schemas/abcde.ts).
 * Exposed so the editor and tests can assert the mapping.
 */
export const SELFINTAKE_PREFILL_KEYS = {
  hauptbeschwerde: 's_symptome',
  allergien: 'a_allergien',
  medikamente: 'm_medikamente',
  vorerkrankungen: 'p_vorerkrankungen',
  letzteMahlzeit: 'l_letzte_mahlzeit',
  schmerzNrs: 'schmerz_nrs',
  schmerzLokalisation: 'schmerz_lokalisation',
  schwangerschaft: 'schwangerschaft',
} as const;

/**
 * Build the partial `values` patch that prefills the protocol fields from raw
 * patient answers. Only sets keys the patient actually answered, so a blank
 * answer never clobbers an existing responder entry. The caller merges this
 * into `values` (responder can then review/edit every field).
 */
export function prefillFromAnswers(answers: SelfIntakeAnswers): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown): void => {
    if (value !== undefined && value !== '' && value !== null) patch[key] = value;
  };

  set(SELFINTAKE_PREFILL_KEYS.hauptbeschwerde, answers.hauptbeschwerde?.trim());
  set(SELFINTAKE_PREFILL_KEYS.allergien, answers.allergien?.trim());
  set(SELFINTAKE_PREFILL_KEYS.medikamente, answers.medikamente?.trim());
  set(SELFINTAKE_PREFILL_KEYS.vorerkrankungen, answers.vorerkrankungen?.trim());
  set(SELFINTAKE_PREFILL_KEYS.letzteMahlzeit, answers.letzteMahlzeit?.trim());
  set(SELFINTAKE_PREFILL_KEYS.schmerzLokalisation, answers.schmerzLokalisation?.trim());

  // Pain: only carry the NRS if the patient reported pain.
  if (answers.schmerzVorhanden === 'ja' && typeof answers.schmerzNrs === 'number') {
    set(SELFINTAKE_PREFILL_KEYS.schmerzNrs, answers.schmerzNrs);
  } else if (answers.schmerzVorhanden === 'nein') {
    set(SELFINTAKE_PREFILL_KEYS.schmerzNrs, 0);
  }

  // Pregnancy maps onto the schema's YES_NO_UNK select; 'na' is not carried.
  if (answers.schwangerschaft && answers.schwangerschaft !== 'na') {
    set(SELFINTAKE_PREFILL_KEYS.schwangerschaft, answers.schwangerschaft);
  }

  return patch;
}
