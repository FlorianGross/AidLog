/**
 * Signed PDF export feature — public surface.
 *
 * Zero-dependency, print-based: render <PrintRecord> (print-only, forced light)
 * from already-decrypted in-memory data and call triggerPrint() → window.print().
 * Nothing leaves the device; the user saves as PDF from the print dialog.
 */
export { default as PrintRecord } from './PrintRecord.svelte';
export * from './printRecord';
export { default as HandoverPrint } from './HandoverPrint.svelte';
export { handoverVerifyString, type HandoverPrintData } from './handover';

// Wachbericht (per-deployment Abschlussbericht): print component + data builder.
export { default as Wachbericht } from './Wachbericht.svelte';
export {
  aggregateMaterial,
  dienstdauerMin,
  formatDauer,
  type WachberichtData,
  type WachberichtMaterial,
} from './wachbericht';

// Machine-readable, pseudonymized interop exports (FHIR R4 + DIVI/MIND).
export {
  toFhirBundle,
  fhirGender,
  downloadJson,
  type FhirBundle,
  type FhirExportInput,
} from './fhir';
export { toDiviDataset, type DiviDataset, type DiviExportInput } from './divi';
