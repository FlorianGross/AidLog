/**
 * export/printRecord.ts — trigger a browser "Save as PDF" via window.print().
 *
 * Zero-dependency, print-based PDF export: we render a print-optimised,
 * self-contained record view (PrintRecord.svelte) and call window.print(). The
 * user saves it as a PDF from the OS/browser print dialog. Because everything is
 * rendered from already-decrypted, in-memory data, NO plaintext leaves the
 * device and no server round-trip is needed — fully consistent with the
 * zero-knowledge model.
 *
 * This module holds the trigger + the data shape the print view consumes, kept
 * free of Svelte so it is easy to test/extend.
 */
import type { ProtocolRecord } from '@aidlog/contracts';
import type { VitalReading } from '$lib/vitals/types';
import type { BodyMarker, DraftPhoto } from '$lib/bodymap/types';
import type { DraftSignature } from '$lib/doc/draftStore';

/** A co-signature row to show in the integrity block. Name is best-effort. */
export interface PrintCosignature {
  /** signer display name or a short keyId if the name is unknown. */
  signer: string;
  signedAt: string;
}

/** Everything the print view needs — all already decrypted, in memory. */
export interface PrintRecordData {
  /** org display name for the header, if known. */
  orgName?: string;
  /** deployment title for the header. */
  deploymentTitle: string;
  /** the signed, immutable record (for integrity/signature block). */
  record: ProtocolRecord;
  /** decrypted form values (flat field map). */
  values: Record<string, unknown>;
  /** vital-sign series (payload `vitalverlauf`). */
  vitals: VitalReading[];
  /** body-map markers (payload `bodymap`). */
  markers: BodyMarker[];
  /** decrypted record photos (in-memory bytes). */
  photos: DraftPhoto[];
  /** captured signature images keyed by field key (in-memory bytes). */
  signatures: Record<string, DraftSignature>;
  /** author display name, if known (falls back to keyId). */
  authorName?: string;
  /** optional server receipt timestamp, if the record has been acknowledged. */
  serverReceiptAt?: string;
  /** co-signatures already collected (name + signedAt). */
  cosignatures: PrintCosignature[];
}

/**
 * Open the print dialog after the print view has rendered/painted. The caller
 * mounts <PrintRecord> (which is screen-hidden, print-visible), then invokes
 * this so the browser has a paint frame before printing.
 */
export function triggerPrint(): void {
  if (typeof window === 'undefined') return;
  // Two RAFs ensure the print DOM (incl. object-URL <img>s) has painted.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.print();
    });
  });
}
