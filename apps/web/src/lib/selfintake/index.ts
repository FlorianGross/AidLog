/**
 * Public surface of the patient self-intake ("Selbstauskunft") feature.
 *
 * - SelfIntakeKiosk: full-screen, large-touch guided patient flow (multilingual,
 *   Arabic RTL). Prefills the SAMPLER protocol fields + emits the raw answers to
 *   store under the `selbstauskunft` payload key.
 * - Verstaendigungshilfe: standalone communication aid (translated phrases),
 *   usable independently of the intake flow.
 *
 * NOTE: non-German patient translations are MACHINE-DRAFTED and require
 * professional medical-translator review before production use (see phrases.ts).
 */
export { default as SelfIntakeKiosk } from './SelfIntakeKiosk.svelte';
export { default as Verstaendigungshilfe } from './Verstaendigungshilfe.svelte';
export {
  SELFINTAKE_KEY,
  SELFINTAKE_PREFILL_KEYS,
  RTL_LANGS,
  isRtl,
  asSelfIntakeRecord,
  prefillFromAnswers,
  type IntakeLang,
  type SelfIntakeAnswers,
  type SelfIntakeRecord,
} from './types';
export {
  INTAKE_LANGS,
  LANG_LABELS,
  AID_PHRASES,
  MACHINE_DRAFTED,
  isMachineDrafted,
  phrasesFor,
  type IntakePhrases,
  type AidPhrase,
} from './phrases';
