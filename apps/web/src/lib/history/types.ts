/**
 * history/types.ts — data model for the Verlauf (change history) + integrity view.
 *
 * Records are append-only: a correction never mutates an existing record, it
 * appends a NEW ProtocolRecord with `supersedes` pointing at the one it
 * replaces. This module derives, from the flat chain of records:
 *   - decrypted, label-mapped payloads (DecryptedEntry),
 *   - supersede chains (which record replaces which),
 *   - field-level diffs (old → new) for corrections,
 *   - per-record + overall integrity results (via crypto.verifyRecord).
 */
import type { ProtocolRecord } from '@aidlog/contracts';

/** A record after local decryption, ready for the history UI. */
export interface DecryptedEntry {
  record: ProtocolRecord;
  /** flat field-key → value map, or null if this identity can't decrypt it. */
  values: Record<string, unknown> | null;
  /** true when decryption failed (no sealed DEK / wrong identity). */
  undecryptable: boolean;
}

/** One field that differs between a record and the record it supersedes. */
export interface FieldDiff {
  key: string;
  /** Human label resolved via the active schema (falls back to the key). */
  label: string;
  kind: 'added' | 'removed' | 'changed';
  /** Display string of the previous value (empty for 'added'). */
  before: string;
  /** Display string of the new value (empty for 'removed'). */
  after: string;
}

/** A correction edge: `record` supersedes `supersededId`, with computed diff. */
export interface CorrectionDiff {
  /** id of the record being corrected. */
  supersededId: string;
  diffs: FieldDiff[];
}

/** Integrity result for a single record. */
export interface RecordIntegrity {
  recordId: string;
  seq: number;
  /** crypto.verifyRecord(): signature valid AND recordHash matches content. */
  signatureValid: boolean;
  /** prevHash links to the previous record's recordHash (or null at seq 0). */
  chainLinked: boolean;
  /** seq is contiguous with the previous record (no gaps/dupes). */
  seqContiguous: boolean;
  /** all of the above. */
  ok: boolean;
}

/** Overall integrity summary for a deployment chain. */
export interface IntegrityReport {
  records: RecordIntegrity[];
  /** every record verified AND the whole chain links + sequences correctly. */
  ok: boolean;
}
