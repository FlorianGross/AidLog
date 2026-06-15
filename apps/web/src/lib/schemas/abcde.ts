/**
 * Default protocol schema for an emergency-medical / first-aid patient contact,
 * structured along the **ABCDE** primary-survey scheme plus common rescue-service
 * schemes (SAMPLER(S) history, OPQRST pain, GCS, FAST). Each section becomes a
 * tab in the drawer-navigated editor.
 *
 * This is a vendor-neutral STARTER template. Organisations adapt it by editing
 * this file (or shipping their own DocSchema) — no component changes needed.
 */
import type { DocSchema, FieldOption } from './types';
import { NACA_OPTIONS } from '$lib/scores';

// Applikationswege für die strukturierte Medikamentengabe.
const medRoute: FieldOption[] = [
  { value: 'i.v.', label: 'i.v.' },
  { value: 'i.o.', label: 'i.o.' },
  { value: 'i.m.', label: 'i.m.' },
  { value: 's.c.', label: 's.c.' },
  { value: 'p.o.', label: 'p.o.' },
  { value: 'nasal', label: 'nasal' },
  { value: 'inhalativ', label: 'inhalativ' },
  { value: 'rektal', label: 'rektal' },
  { value: 'buccal', label: 'buccal' },
  { value: 'transdermal', label: 'transdermal' },
];

// Dosis-Einheiten für die strukturierte Medikamentengabe.
const medUnit: FieldOption[] = [
  { value: 'mg', label: 'mg' },
  { value: 'g', label: 'g' },
  { value: 'µg', label: 'µg' },
  { value: 'ml', label: 'ml' },
  { value: 'IE', label: 'IE' },
  { value: 'Hub', label: 'Hub' },
  { value: 'Stk', label: 'Stk' },
  { value: 'Tropfen', label: 'Tropfen' },
];

const YES_NO_UNK: FieldOption[] = [
  { value: 'ja', label: 'Ja' },
  { value: 'nein', label: 'Nein' },
  { value: 'unbekannt', label: 'Unbekannt' },
];

const sex: FieldOption[] = [
  { value: 'w', label: 'weiblich' },
  { value: 'm', label: 'männlich' },
  { value: 'd', label: 'divers' },
  { value: 'unbekannt', label: 'unbekannt' },
];

const ageBand: FieldOption[] = [
  { value: 'saeugling', label: 'Säugling (0–1)' },
  { value: 'kleinkind', label: 'Kleinkind (1–5)' },
  { value: 'kind', label: 'Kind (6–13)' },
  { value: 'jugendlich', label: 'Jugendlich (14–17)' },
  { value: 'erwachsen', label: 'Erwachsen (18–64)' },
  { value: 'senior', label: 'Senior (65+)' },
];

const avpu: FieldOption[] = [
  { value: 'A', label: 'A – wach (Alert)' },
  { value: 'V', label: 'V – auf Ansprache (Verbal)' },
  { value: 'P', label: 'P – auf Schmerz (Pain)' },
  { value: 'U', label: 'U – keine Reaktion (Unresponsive)' },
];

export const abcdeSchema: DocSchema = {
  schemaId: 'abcde-rd',
  version: 1,
  title: 'Patientenprotokoll (ABCDE)',
  sections: [
    {
      key: 'einsatz',
      title: 'Einsatz & Patient',
      badge: 'i',
      description: 'Stammdaten des Einsatzes und des Patienten (pseudonymisiert).',
      fields: [
        { key: 'einsatznummer', label: 'Einsatznummer', type: 'text', span: 1 },
        { key: 'alarmzeit', label: 'Alarmierung', type: 'datetime', span: 1 },
        { key: 'einsatzort', label: 'Einsatzort', type: 'text', span: 2 },
        {
          key: 'patient_kennung',
          label: 'Patientenkennung / Initialen',
          type: 'text',
          help: 'Pseudonym oder Initialen – möglichst keine Klarnamen.',
          span: 1,
        },
        { key: 'alter', label: 'Alter', type: 'number', unit: 'Jahre', span: 1 },
        { key: 'altersgruppe', label: 'Altersgruppe', type: 'select', options: ageBand, span: 1 },
        { key: 'geschlecht', label: 'Geschlecht', type: 'select', options: sex, span: 1 },
        { key: 'auffindesituation', label: 'Auffindesituation', type: 'textarea', span: 2 },
        {
          key: 'ersteindruck',
          label: 'Ersteindruck (kritisch?)',
          type: 'select',
          options: [
            { value: 'unauffaellig', label: 'Unauffällig' },
            { value: 'kritisch', label: 'Kritisch' },
            { value: 'lebensbedrohlich', label: 'Lebensbedrohlich' },
          ],
          required: true,
          span: 1,
        },
        {
          key: 'naca',
          label: 'NACA-Score',
          type: 'select',
          options: NACA_OPTIONS,
          help: 'Ärztliche/klinische Einschätzung – nicht automatisch berechnet.',
          span: 1,
        },
      ],
    },
    {
      key: 'anamnese',
      title: 'Anamnese (SAMPLER)',
      badge: 'S',
      description:
        'Symptome, Allergien, Medikamente, Vorerkrankungen, letzte Mahlzeit, Ereignis, Risikofaktoren.',
      fields: [
        { key: 's_symptome', label: 'Symptome / Beschwerden', type: 'textarea', span: 2 },
        { key: 'a_allergien', label: 'Allergien', type: 'text', span: 1 },
        { key: 'm_medikamente', label: 'Medikamente', type: 'textarea', span: 1 },
        { key: 'p_vorerkrankungen', label: 'Vorerkrankungen', type: 'textarea', span: 2 },
        { key: 'l_letzte_mahlzeit', label: 'Letzte Mahlzeit / Flüssigkeit', type: 'text', span: 1 },
        { key: 'e_ereignis', label: 'Ereignis / Hergang', type: 'textarea', span: 2 },
        { key: 'r_risikofaktoren', label: 'Risikofaktoren', type: 'text', span: 1 },
        {
          key: 'schwangerschaft',
          label: 'Schwangerschaft',
          type: 'select',
          options: YES_NO_UNK,
          span: 1,
        },
        // OPQRST bei Schmerz
        {
          key: 'schmerz_nrs',
          label: 'Schmerz (NRS 0–10)',
          type: 'number',
          min: 0,
          max: 10,
          span: 1,
        },
        { key: 'schmerz_lokalisation', label: 'Schmerz-Lokalisation', type: 'text', span: 1 },
      ],
    },
    {
      key: 'a_atemweg',
      title: 'A – Atemweg',
      badge: 'A',
      description: 'Airway: Atemweg frei/verlegt, HWS.',
      fields: [
        {
          key: 'a_status',
          label: 'Atemweg',
          type: 'select',
          options: [
            { value: 'frei', label: 'Frei' },
            { value: 'gefaehrdet', label: 'Gefährdet' },
            { value: 'verlegt', label: 'Verlegt' },
          ],
          span: 1,
        },
        {
          key: 'a_massnahmen',
          label: 'Maßnahmen',
          type: 'multiselect',
          options: [
            { value: 'esmarch', label: 'Esmarch-Handgriff' },
            { value: 'guedel', label: 'Guedel-Tubus' },
            { value: 'wendl', label: 'Wendl-Tubus' },
            { value: 'absaugen', label: 'Absaugen' },
            { value: 'hws', label: 'HWS-Immobilisation' },
          ],
          span: 2,
        },
        { key: 'a_bemerkung', label: 'Bemerkung', type: 'textarea', span: 2 },
      ],
    },
    {
      key: 'b_atmung',
      title: 'B – Atmung',
      badge: 'B',
      description: 'Breathing: Atemfrequenz, SpO₂, Auskultation.',
      fields: [
        // Plausibilitätsbänder sind NEUTRALE, EDITIERBARE Referenz-Ruhebereiche
        // (keine medizinische Empfehlung/Diagnose) und dienen nur als passiver
        // Hinweis. Bandschlüssel = inklusive untere Altersgrenze (Jahre).
        {
          key: 'b_af',
          label: 'Atemfrequenz',
          type: 'number',
          unit: '/min',
          plausibility: {
            ageField: 'alter',
            bands: {
              '0': { min: 30, max: 50 },
              '1': { min: 20, max: 40 },
              '6': { min: 16, max: 30 },
              '12': { min: 12, max: 20 },
              '18': { min: 10, max: 20 },
            },
          },
          span: 1,
        },
        {
          key: 'b_spo2',
          label: 'SpO₂',
          type: 'number',
          unit: '%',
          min: 0,
          max: 100,
          // Altersunabhängiger Referenz-Ruhebereich.
          plausibility: { min: 94, max: 100 },
          span: 1,
        },
        {
          key: 'b_atemmuster',
          label: 'Atemmuster',
          type: 'select',
          options: [
            { value: 'normal', label: 'Normal' },
            { value: 'dyspnoe', label: 'Dyspnoe' },
            { value: 'tachypnoe', label: 'Tachypnoe' },
            { value: 'bradypnoe', label: 'Bradypnoe' },
            { value: 'schnappatmung', label: 'Schnappatmung' },
            { value: 'apnoe', label: 'Apnoe' },
          ],
          span: 1,
        },
        {
          key: 'b_auskultation',
          label: 'Auskultation',
          type: 'select',
          options: [
            { value: 'seitengleich', label: 'Seitengleich, frei' },
            { value: 'rasselgeraeusche', label: 'Rasselgeräusche' },
            { value: 'giemen', label: 'Giemen / Pfeifen' },
            { value: 'abgeschwaecht', label: 'Abgeschwächt' },
          ],
          span: 1,
        },
        {
          key: 'b_massnahmen',
          label: 'Maßnahmen',
          type: 'multiselect',
          options: [
            { value: 'o2', label: 'O₂-Gabe' },
            { value: 'oberkoerper_hoch', label: 'Oberkörper hoch' },
            { value: 'assistierte_beatmung', label: 'Assistierte Beatmung' },
            { value: 'beatmung', label: 'Beatmung (Beutel-Maske)' },
          ],
          span: 2,
        },
        { key: 'b_o2_fluss', label: 'O₂-Fluss', type: 'number', unit: 'l/min', span: 1 },
      ],
    },
    {
      key: 'c_kreislauf',
      title: 'C – Kreislauf',
      badge: 'C',
      description: 'Circulation: Puls, Blutdruck, Rekap, Blutung.',
      fields: [
        // Referenz-Ruhebereiche (editierbar, kein medizinischer Rat).
        {
          key: 'c_puls',
          label: 'Puls',
          type: 'number',
          unit: '/min',
          plausibility: {
            ageField: 'alter',
            bands: {
              '0': { min: 100, max: 160 },
              '1': { min: 90, max: 150 },
              '6': { min: 70, max: 120 },
              '12': { min: 60, max: 100 },
              '18': { min: 60, max: 100 },
            },
          },
          span: 1,
        },
        {
          key: 'c_puls_qualitaet',
          label: 'Pulsqualität',
          type: 'select',
          options: [
            { value: 'kraeftig', label: 'Kräftig, regelmäßig' },
            { value: 'schwach', label: 'Schwach' },
            { value: 'unregelmaessig', label: 'Unregelmäßig' },
            { value: 'nicht_tastbar', label: 'Nicht tastbar' },
          ],
          span: 1,
        },
        {
          key: 'c_rr_sys',
          label: 'RR systolisch',
          type: 'number',
          unit: 'mmHg',
          // Nur Erwachsene (kein pädiatrisches Band → bei Kindern kein Hinweis).
          plausibility: { ageField: 'alter', bands: { '18': { min: 100, max: 140 } } },
          span: 1,
        },
        { key: 'c_rr_dia', label: 'RR diastolisch', type: 'number', unit: 'mmHg', span: 1 },
        { key: 'c_rekap', label: 'Rekapillarisierungszeit', type: 'number', unit: 's', span: 1 },
        {
          key: 'c_haut',
          label: 'Haut',
          type: 'select',
          options: [
            { value: 'normal', label: 'Warm, rosig, trocken' },
            { value: 'blass', label: 'Blass' },
            { value: 'kaltschweissig', label: 'Kaltschweißig' },
            { value: 'zyanotisch', label: 'Zyanotisch' },
            { value: 'marmoriert', label: 'Marmoriert' },
          ],
          span: 1,
        },
        {
          key: 'c_blutung',
          label: 'Sichtbare Blutung',
          type: 'select',
          options: YES_NO_UNK,
          span: 1,
        },
        {
          key: 'c_massnahmen',
          label: 'Maßnahmen',
          type: 'multiselect',
          options: [
            { value: 'blutstillung', label: 'Blutstillung / Druckverband' },
            { value: 'tourniquet', label: 'Tourniquet' },
            { value: 'schocklage', label: 'Schocklage' },
            { value: 'zugang', label: 'Venöser Zugang' },
            { value: 'waermeerhalt', label: 'Wärmeerhalt' },
          ],
          span: 2,
        },
      ],
    },
    {
      key: 'd_neuro',
      title: 'D – Neurologie',
      badge: 'D',
      description: 'Disability: Bewusstsein, GCS, Pupillen, BZ, FAST.',
      fields: [
        { key: 'd_avpu', label: 'Bewusstsein (AVPU)', type: 'select', options: avpu, span: 1 },
        { key: 'd_gcs_augen', label: 'GCS Augen', type: 'number', min: 1, max: 4, span: 1 },
        { key: 'd_gcs_verbal', label: 'GCS Verbal', type: 'number', min: 1, max: 5, span: 1 },
        { key: 'd_gcs_motorik', label: 'GCS Motorik', type: 'number', min: 1, max: 6, span: 1 },
        {
          key: 'd_gcs_total',
          label: 'GCS gesamt',
          type: 'computed',
          compute: {
            kind: 'sum',
            from: ['d_gcs_augen', 'd_gcs_verbal', 'd_gcs_motorik'],
            min: 3,
            max: 15,
          },
          span: 1,
        },
        {
          key: 'd_pupillen',
          label: 'Pupillen',
          type: 'select',
          options: [
            { value: 'isokor_lichtreagibel', label: 'Isokor, lichtreagibel' },
            { value: 'eng', label: 'Eng (Miosis)' },
            { value: 'weit', label: 'Weit (Mydriasis)' },
            { value: 'anisokor', label: 'Anisokor' },
            { value: 'entrundet', label: 'Entrundet' },
          ],
          span: 1,
        },
        {
          key: 'd_bz',
          label: 'Blutzucker',
          type: 'number',
          unit: 'mg/dl',
          // Editierbarer Referenz-Ruhebereich (kein medizinischer Rat).
          plausibility: { min: 70, max: 180 },
          span: 1,
        },
        {
          key: 'd_fast',
          label: 'FAST (Schlaganfall)',
          type: 'multiselect',
          options: [
            { value: 'face', label: 'Face – Gesichtslähmung' },
            { value: 'arms', label: 'Arms – Armschwäche' },
            { value: 'speech', label: 'Speech – Sprachstörung' },
            { value: 'unauffaellig', label: 'Unauffällig' },
          ],
          span: 2,
        },
        { key: 'd_bemerkung', label: 'Neurologische Auffälligkeiten', type: 'textarea', span: 2 },
      ],
    },
    {
      key: 'e_exposition',
      title: 'E – Exposition',
      badge: 'E',
      description: 'Exposure/Environment: Bodycheck, Verletzungen, Temperatur, Wärmeerhalt.',
      fields: [
        { key: 'e_bodycheck', label: 'Bodycheck / Untersuchung', type: 'textarea', span: 2 },
        { key: 'e_verletzungen', label: 'Verletzungen / Wunden', type: 'textarea', span: 2 },
        {
          key: 'e_temperatur',
          label: 'Temperatur',
          type: 'number',
          unit: '°C',
          // Editierbarer Referenz-Ruhebereich (kein medizinischer Rat).
          plausibility: { min: 36.0, max: 37.9 },
          span: 1,
        },
        {
          key: 'e_waermemanagement',
          label: 'Wärmemanagement',
          type: 'select',
          options: [
            { value: 'keine', label: 'Keine' },
            { value: 'decke', label: 'Decke / Rettungsdecke' },
            { value: 'aktiv', label: 'Aktive Erwärmung' },
          ],
          span: 1,
        },
      ],
    },
    {
      key: 'massnahmen',
      title: 'Maßnahmen & Verlauf',
      badge: 'M',
      description: 'Durchgeführte Maßnahmen, Medikamente, Verlauf.',
      fields: [
        { key: 'm_massnahmen', label: 'Durchgeführte Maßnahmen', type: 'textarea', span: 2 },
        {
          key: 'medikamente',
          label: 'Medikamentengabe',
          type: 'group',
          addLabel: 'Medikament hinzufügen',
          itemFields: [
            { key: 'mittel', label: 'Mittel', type: 'text', span: 2 },
            { key: 'dosis', label: 'Dosis', type: 'text', span: 1 },
            { key: 'einheit', label: 'Einheit', type: 'select', options: medUnit, span: 1 },
            { key: 'weg', label: 'Applikationsweg', type: 'select', options: medRoute, span: 1 },
            { key: 'uhrzeit', label: 'Uhrzeit', type: 'time', span: 1 },
            { key: 'person', label: 'Durchführende Person', type: 'text', span: 2 },
          ],
          span: 2,
        },
        { key: 'm_verlauf', label: 'Verlauf / Vitalwert-Trend', type: 'textarea', span: 2 },
        {
          key: 'm_reanimation',
          label: 'Reanimation',
          type: 'select',
          options: YES_NO_UNK,
          span: 1,
        },
      ],
    },
    {
      key: 'uebergabe',
      title: 'Übergabe',
      badge: 'Ü',
      description: 'Übergabe / Verbleib des Patienten.',
      fields: [
        {
          key: 'u_verbleib',
          label: 'Verbleib',
          type: 'select',
          options: [
            { value: 'rtw', label: 'Übergabe an RTW' },
            { value: 'notarzt', label: 'Übergabe an Notarzt' },
            { value: 'klinik', label: 'Transport in Klinik' },
            { value: 'hausarzt', label: 'Verweis Hausarzt' },
            { value: 'vor_ort', label: 'Belassung vor Ort' },
            { value: 'verweigerung', label: 'Transportverweigerung' },
          ],
          required: true,
          span: 1,
        },
        {
          key: 'verdachtsdiagnose',
          label: 'Verdachts-/Arbeitsdiagnose',
          type: 'textarea',
          span: 2,
        },
        { key: 'u_uebergabe_an', label: 'Übergabe an (Name/Funktion)', type: 'text', span: 1 },
        { key: 'u_uebergabezeit', label: 'Übergabezeitpunkt', type: 'datetime', span: 1 },
        { key: 'u_zielklinik', label: 'Zielklinik', type: 'text', span: 1 },
        { key: 'u_bemerkung', label: 'Bemerkung', type: 'textarea', span: 2 },
      ],
    },
    {
      key: 'zeiten',
      title: 'Zeiten',
      badge: '⏱',
      description: 'Einsatz-Zeitschiene (Alarmierung bis Übergabe).',
      fields: [
        {
          key: 'zeit_eintreffen',
          label: 'Eintreffen Einsatzort',
          type: 'datetime',
          help: 'Zeiten lassen sich per „Jetzt“-Schaltfläche auf die aktuelle Uhrzeit setzen.',
          span: 1,
        },
        { key: 'zeit_erstkontakt', label: 'Erstkontakt Patient', type: 'datetime', span: 1 },
        { key: 'zeit_massnahmenbeginn', label: 'Beginn Maßnahmen', type: 'datetime', span: 1 },
        { key: 'zeit_transportbeginn', label: 'Transportbeginn', type: 'datetime', span: 1 },
      ],
    },
    {
      key: 'verweigerung',
      title: 'Verweigerung',
      badge: 'V',
      description: 'Nur bei Behandlungs-/Transportverweigerung ausfüllen.',
      fields: [
        {
          key: 'verw_einwilligungsfaehig',
          label: 'Einwilligungsfähig',
          type: 'select',
          options: [
            { value: 'ja', label: 'ja' },
            { value: 'nein', label: 'nein' },
            { value: 'unklar', label: 'unklar' },
          ],
          help: 'Nur bei Behandlungs-/Transportverweigerung ausfüllen.',
          span: 1,
        },
        {
          key: 'verw_aufklaerung',
          label: 'Über Risiken/Folgen aufgeklärt',
          type: 'boolean',
          span: 1,
        },
        {
          key: 'verw_risiken',
          label: 'Aufklärung über folgende Risiken/Folgen',
          type: 'textarea',
          span: 2,
        },
        { key: 'verw_zeuge', label: 'Zeuge (Name/Funktion)', type: 'text', span: 1 },
        { key: 'verw_zeit', label: 'Zeitpunkt der Verweigerung', type: 'datetime', span: 1 },
      ],
    },
    {
      key: 'unterschriften',
      title: 'Unterschriften',
      badge: '✓',
      description: 'Unterschriften von Patient und Helfer; Gegenzeichnung erfolgt separat.',
      fields: [
        {
          key: 'sig_patient_verweigerung',
          label: 'Behandlungs-/Transportverweigerung durch Patient',
          type: 'boolean',
          span: 2,
        },
        { key: 'sig_patient', label: 'Unterschrift Patient', type: 'signature', span: 2 },
        {
          key: 'sig_helfer',
          label: 'Unterschrift Helfer',
          type: 'signature',
          required: true,
          span: 2,
        },
      ],
    },
  ],
};
