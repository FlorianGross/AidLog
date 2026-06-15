/**
 * scores/naca.ts — the static NACA score option list (0–7).
 *
 * NACA is a CLINICIAN JUDGEMENT, never auto-computed. This module only provides
 * the selectable options (neutral German descriptions) so the content phase can
 * drop them into a normal `select` field. No computation, no advice.
 */
import type { FieldOption } from '$lib/schemas/types';

/** NACA 0–7 as `select` options (value = numeric grade, label = neutral text). */
export const NACA_OPTIONS: FieldOption[] = [
  { value: '0', label: '0 – keine Verletzung/Erkrankung' },
  { value: '1', label: '1 – geringfügige Störung' },
  { value: '2', label: '2 – ambulante Abklärung' },
  { value: '3', label: '3 – stationäre Behandlung' },
  { value: '4', label: '4 – akute Lebensgefahr nicht auszuschließen' },
  { value: '5', label: '5 – akute Lebensgefahr' },
  { value: '6', label: '6 – Reanimation' },
  { value: '7', label: '7 – Tod' },
];
