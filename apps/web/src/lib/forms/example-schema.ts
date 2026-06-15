/**
 * example-schema.ts — a REALISTIC starter SchemaDefinition for a sanitary /
 * first-aid patient contact.
 *
 * ⚠️ This is SAMPLE DATA, a starting template — NOT a fixed form. The whole
 * point of Aidlog's "configurable protocol fields" feature (ARCHITECTURE §6) is
 * that adding/removing/renaming a field requires ONLY editing a schema like
 * this. A self-hoster ships their own schema; the dynamic renderer
 * (SchemaForm.svelte) and AJV validation adapt automatically.
 *
 * Fields are intentionally NEUTRAL and pseudonymised (no real names): a patient
 * pseudonym + age band + sex, complaint, vitals, measures, handover target, and
 * free text. uiSchema drives field order, widgets, and grouping.
 */
import type { SchemaDefinition } from '@aidlog/contracts';

export const exampleSchema: SchemaDefinition = {
  schemaId: 'sanitary-patient-contact',
  version: 1,
  title: 'Patient contact (sanitary service)',
  description:
    'Neutral example protocol for a first-aid patient contact. Replace with your own schema; this is only a starting template.',
  createdAt: '2026-01-01T00:00:00.000Z',
  jsonSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: ['timestamp', 'location', 'patientPseudonym', 'ageBand', 'complaint'],
    properties: {
      timestamp: {
        type: 'string',
        format: 'date-time',
        title: 'Time of contact',
      },
      location: {
        type: 'string',
        title: 'Location / post',
        minLength: 1,
        maxLength: 200,
      },
      patientPseudonym: {
        type: 'string',
        title: 'Patient pseudonym',
        description: 'A non-identifying label (e.g. "Patient 3"). Do NOT enter real names.',
        minLength: 1,
        maxLength: 60,
      },
      ageBand: {
        type: 'string',
        title: 'Age band',
        enum: ['0-1', '2-5', '6-13', '14-17', '18-39', '40-64', '65-79', '80+', 'unknown'],
      },
      sex: {
        type: 'string',
        title: 'Sex',
        enum: ['female', 'male', 'diverse', 'unknown'],
      },
      complaint: {
        type: 'string',
        title: 'Chief complaint',
        minLength: 1,
        maxLength: 500,
      },
      vitals: {
        type: 'object',
        title: 'Vital signs',
        additionalProperties: false,
        properties: {
          rrSys: { type: 'integer', title: 'RR systolic (mmHg)', minimum: 0, maximum: 300 },
          rrDia: { type: 'integer', title: 'RR diastolic (mmHg)', minimum: 0, maximum: 200 },
          hf: { type: 'integer', title: 'Heart rate (HF, /min)', minimum: 0, maximum: 300 },
          spo2: { type: 'integer', title: 'SpO2 (%)', minimum: 0, maximum: 100 },
          bz: { type: 'number', title: 'Blood glucose (BZ, mg/dl)', minimum: 0, maximum: 1000 },
          gcs: { type: 'integer', title: 'GCS', minimum: 3, maximum: 15 },
          avpu: {
            type: 'string',
            title: 'AVPU',
            enum: ['A', 'V', 'P', 'U'],
          },
        },
      },
      measures: {
        type: 'string',
        title: 'Measures taken',
        maxLength: 2000,
      },
      handoverTarget: {
        type: 'string',
        title: 'Handover to',
        enum: ['none', 'self-care', 'gp', 'ambulance', 'emergency-physician', 'hospital', 'other'],
      },
      transported: {
        type: 'boolean',
        title: 'Patient transported',
      },
      photo: {
        type: 'string',
        title: 'Photo / scan (optional)',
        description: 'Encrypted on-device before upload.',
        contentEncoding: 'base64',
        contentMediaType: 'image/*',
      },
      freeText: {
        type: 'string',
        title: 'Free text / remarks',
        maxLength: 4000,
      },
    },
  },
  uiSchema: {
    'ui:order': [
      'timestamp',
      'location',
      'patientPseudonym',
      'ageBand',
      'sex',
      'complaint',
      'vitals',
      'measures',
      'handoverTarget',
      'transported',
      'photo',
      'freeText',
    ],
    measures: { 'ui:widget': 'textarea' },
    freeText: { 'ui:widget': 'textarea' },
    photo: { 'ui:widget': 'image-capture' },
  },
};
