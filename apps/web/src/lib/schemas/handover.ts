/**
 * schemas/handover.ts — STRUKTURIERTE ÜBERGABE (handover to RTW / Notarzt).
 *
 * A structured handover protocol modelled along ISOBAR (Identification,
 * Situation, Observation, Background, Assessment, Recommendation) combined with
 * the SAMPLER history. Like the ABCDE template this is a vendor-neutral
 * DocSchema; an admin can select it as the active protocol via the schema store.
 *
 * The decrypted form payload is a flat Record keyed by DocField.key, encrypted
 * as the EncryptedPayload of a ProtocolRecord — identical to every other schema.
 */
import type { DocSchema, FieldOption } from './types';
import { NACA_OPTIONS } from '$lib/scores';

const sex: FieldOption[] = [
  { value: 'w', label: 'weiblich' },
  { value: 'm', label: 'männlich' },
  { value: 'd', label: 'divers' },
  { value: 'unbekannt', label: 'unbekannt' },
];

const avpu: FieldOption[] = [
  { value: 'A', label: 'A – wach (Alert)' },
  { value: 'V', label: 'V – auf Ansprache (Verbal)' },
  { value: 'P', label: 'P – auf Schmerz (Pain)' },
  { value: 'U', label: 'U – keine Reaktion (Unresponsive)' },
];

const verbleib: FieldOption[] = [
  { value: 'rtw', label: 'Übergabe an RTW' },
  { value: 'notarzt', label: 'Übergabe an Notarzt' },
  { value: 'klinik', label: 'Transport in Klinik' },
  { value: 'hausarzt', label: 'Verweis Hausarzt' },
  { value: 'vor_ort', label: 'Belassung vor Ort' },
  { value: 'verweigerung', label: 'Transportverweigerung' },
];

/**
 * ISOBAR/SAMPLER handover schema. The section keys mirror the ISOBAR letters so
 * the print sheet (HandoverPrint.svelte) can lay them out in the canonical
 * structure to physically hand to the RTW crew.
 */
export const handoverSchema: DocSchema = {
  schemaId: 'handover',
  version: 1,
  title: 'Übergabe (ISOBAR/SAMPLER)',
  sections: [
    {
      key: 'identifikation',
      title: 'Identifikation',
      badge: 'I',
      description: 'Identification: Patientenkennung, Alter, Geschlecht.',
      fields: [
        {
          key: 'h_patient_kennung',
          label: 'Patientenkennung / Initialen',
          type: 'text',
          help: 'Pseudonym oder Initialen – möglichst keine Klarnamen.',
          span: 1,
        },
        { key: 'h_alter', label: 'Alter', type: 'number', unit: 'Jahre', span: 1 },
        { key: 'h_geschlecht', label: 'Geschlecht', type: 'select', options: sex, span: 1 },
      ],
    },
    {
      key: 'situation',
      title: 'Situation',
      badge: 'S',
      description: 'Situation: Leitsymptom / Hauptbeschwerde und Zeitpunkt.',
      fields: [
        { key: 'h_leitsymptom', label: 'Leitsymptom / Hauptbeschwerde', type: 'textarea', span: 2 },
        { key: 'h_beginn', label: 'Beginn / Zeitpunkt', type: 'datetime', span: 1 },
      ],
    },
    {
      key: 'beobachtung',
      title: 'Beobachtung / Vitalwerte',
      badge: 'O',
      description: 'Observation: aktueller Status — Bewusstsein, Atmung, Kreislauf.',
      fields: [
        {
          key: 'h_bewusstsein',
          label: 'Bewusstsein (AVPU)',
          type: 'select',
          options: avpu,
          span: 1,
        },
        { key: 'h_gcs', label: 'GCS', type: 'number', min: 3, max: 15, span: 1 },
        { key: 'h_naca', label: 'NACA-Score', type: 'select', options: NACA_OPTIONS, span: 1 },
        { key: 'h_af', label: 'Atemfrequenz', type: 'number', unit: '/min', span: 1 },
        { key: 'h_spo2', label: 'SpO₂', type: 'number', unit: '%', min: 0, max: 100, span: 1 },
        { key: 'h_puls', label: 'Puls', type: 'number', unit: '/min', span: 1 },
        { key: 'h_rr_sys', label: 'RR systolisch', type: 'number', unit: 'mmHg', span: 1 },
        { key: 'h_rr_dia', label: 'RR diastolisch', type: 'number', unit: 'mmHg', span: 1 },
        { key: 'h_bz', label: 'Blutzucker', type: 'number', unit: 'mg/dl', span: 1 },
        { key: 'h_temp', label: 'Temperatur', type: 'number', unit: '°C', span: 1 },
      ],
    },
    {
      key: 'anamnese',
      title: 'Anamnese (SAMPLER)',
      badge: 'B',
      description:
        'Background: Symptome, Allergien, Medikamente, Vorerkrankungen, letzte Mahlzeit, Ereignis, Risikofaktoren.',
      fields: [
        { key: 'h_s_symptome', label: 'Symptome / Beschwerden', type: 'textarea', span: 2 },
        { key: 'h_a_allergien', label: 'Allergien', type: 'text', span: 1 },
        { key: 'h_m_medikamente', label: 'Medikamente', type: 'textarea', span: 1 },
        { key: 'h_p_vorerkrankungen', label: 'Vorerkrankungen', type: 'textarea', span: 2 },
        {
          key: 'h_l_letzte_mahlzeit',
          label: 'Letzte Mahlzeit / Flüssigkeit',
          type: 'text',
          span: 1,
        },
        { key: 'h_e_ereignis', label: 'Ereignis / Hergang', type: 'textarea', span: 2 },
        { key: 'h_r_risikofaktoren', label: 'Risikofaktoren', type: 'text', span: 1 },
      ],
    },
    {
      key: 'beurteilung',
      title: 'Beurteilung',
      badge: 'A',
      description: 'Assessment: Verdachtsdiagnose und bisherige Maßnahmen.',
      fields: [
        { key: 'h_verdachtsdiagnose', label: 'Verdachtsdiagnose', type: 'textarea', span: 2 },
        { key: 'h_massnahmen', label: 'Durchgeführte Maßnahmen', type: 'textarea', span: 2 },
        {
          key: 'h_medikamentengabe',
          label: 'Medikamentengabe (Mittel/Dosis/Zeit)',
          type: 'textarea',
          span: 2,
        },
      ],
    },
    {
      key: 'empfehlung',
      title: 'Empfehlung / Übergabe an',
      badge: 'R',
      description: 'Recommendation: Verbleib, Zielklinik, übernehmende Stelle.',
      fields: [
        { key: 'h_verbleib', label: 'Verbleib', type: 'select', options: verbleib, span: 1 },
        { key: 'h_uebergabe_an', label: 'Übergabe an (Name/Funktion)', type: 'text', span: 1 },
        { key: 'h_zielklinik', label: 'Zielklinik', type: 'text', span: 1 },
        { key: 'h_uebergabezeit', label: 'Übergabezeitpunkt', type: 'datetime', span: 1 },
        { key: 'h_empfehlung', label: 'Empfehlung / offene Punkte', type: 'textarea', span: 2 },
      ],
    },
    {
      key: 'unterschriften',
      title: 'Unterschriften',
      badge: '✓',
      description: 'Unterschrift der übergebenden und der übernehmenden Person.',
      fields: [
        { key: 'h_sig_uebergebend', label: 'Übergebende Person', type: 'signature', span: 2 },
        { key: 'h_sig_uebernehmend', label: 'Übernehmende Person', type: 'signature', span: 2 },
      ],
    },
  ],
};
