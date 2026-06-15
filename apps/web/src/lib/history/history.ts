/**
 * history/history.ts — derive the change history + integrity from a record chain.
 *
 * Pure, UI-agnostic functions:
 *   - decryptEntries(): decrypt each record's payload locally (in memory) using
 *     the viewer's own identity; records this identity can't open are flagged.
 *   - buildDiff(): field-level old→new diff between a correction and the record
 *     it supersedes, with labels resolved via the active schema.
 *   - checkIntegrity(): run crypto.verifyRecord across the chain (signatures +
 *     hash links) and validate seq contiguity → per-record + overall verdict.
 *
 * Decryption goes through the existing client crypto wrapper (decryptRecord);
 * integrity goes through crypto.verifyRecord from @aidlog/crypto-core. We never
 * touch sealing or primitives directly.
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import type { ProtocolRecord } from '@aidlog/contracts';
import { decryptRecord } from '$lib/crypto';
import type { DocSchema } from '$lib/schemas/types';
import type {
  CorrectionDiff,
  DecryptedEntry,
  FieldDiff,
  IntegrityReport,
  RecordIntegrity,
} from './types';

/** Records sorted into chain order (by seq ascending). */
export function inChainOrder(records: ProtocolRecord[]): ProtocolRecord[] {
  return [...records].sort((a, b) => a.seq - b.seq);
}

/**
 * Decrypt every record's payload with the viewer identity. Records whose DEK
 * isn't sealed to this identity (e.g. shift closed for a helper) are returned
 * with `undecryptable: true` and `values: null` — the UI still lists them.
 */
export async function decryptEntries(
  records: ProtocolRecord[],
  identity: IdentityKeyPair,
): Promise<DecryptedEntry[]> {
  const ordered = inChainOrder(records);
  const out: DecryptedEntry[] = [];
  for (const record of ordered) {
    try {
      const { payload } = await decryptRecord(record, identity);
      out.push({
        record,
        values: (payload && typeof payload === 'object'
          ? (payload as Record<string, unknown>)
          : {}) as Record<string, unknown>,
        undecryptable: false,
      });
    } catch {
      out.push({ record, values: null, undecryptable: true });
    }
  }
  return out;
}

/** Build a key → human label map from the active schema (incl. select options). */
export function labelMap(schema: DocSchema): Record<string, string> {
  const map: Record<string, string> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) map[field.key] = field.label;
  }
  return map;
}

/**
 * Build a key → (optionValue → optionLabel) map so diffs render readable option
 * labels instead of raw values (e.g. 'frei' → 'Frei').
 */
function optionLabelMap(schema: DocSchema): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = {};
  for (const section of schema.sections) {
    for (const field of section.fields) {
      if (field.options) {
        map[field.key] = Object.fromEntries(field.options.map((o) => [o.value, o.label]));
      }
    }
  }
  return map;
}

/** Render a stored field value as a human-readable string for the diff view. */
function displayValue(
  key: string,
  value: unknown,
  options: Record<string, Record<string, string>>,
): string {
  if (value === undefined || value === null || value === '') return '';
  const opts = options[key];
  if (Array.isArray(value)) {
    return value.map((v) => opts?.[String(v)] ?? String(v)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return opts?.[String(value)] ?? String(value);
}

/** Stable equality for two field values (order-insensitive for arrays). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const sa = [...a].map(String).sort();
    const sb = [...b].map(String).sort();
    return sa.every((v, i) => v === sb[i]);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/**
 * Field-level diff between an OLD values map and a NEW one. Reports added,
 * removed and changed fields, with labels + readable option values from the
 * schema. Internal payload keys for the dedicated panels (vitals, bodymap, …)
 * and the self-intake raw blob are not flat schema fields; they are skipped if
 * not present in the schema label map unless their value actually changed.
 */
export function buildDiff(
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>,
  schema: DocSchema,
): FieldDiff[] {
  const labels = labelMap(schema);
  const options = optionLabelMap(schema);
  const keys = new Set([...Object.keys(oldValues), ...Object.keys(newValues)]);
  const diffs: FieldDiff[] = [];

  for (const key of keys) {
    const before = oldValues[key];
    const after = newValues[key];
    if (sameValue(before, after)) continue;
    if (isEmpty(before) && isEmpty(after)) continue;

    const label = labels[key] ?? key;
    let kind: FieldDiff['kind'];
    if (isEmpty(before)) kind = 'added';
    else if (isEmpty(after)) kind = 'removed';
    else kind = 'changed';

    diffs.push({
      key,
      label,
      kind,
      before: displayValue(key, before, options),
      after: displayValue(key, after, options),
    });
  }

  // Stable, label-ordered output.
  diffs.sort((a, b) => a.label.localeCompare(b.label, 'de'));
  return diffs;
}

/**
 * For each correction (record with `supersedes`), compute the diff against the
 * record it replaces. Records that can't be decrypted produce no diff.
 */
export function buildCorrectionDiffs(
  entries: DecryptedEntry[],
  schema: DocSchema,
): Map<string, CorrectionDiff> {
  const byId = new Map(entries.map((e) => [e.record.id, e]));
  const result = new Map<string, CorrectionDiff>();

  for (const entry of entries) {
    const supersededId = entry.record.supersedes;
    if (!supersededId) continue;
    const old = byId.get(supersededId);
    if (!old || old.values === null || entry.values === null) continue;
    result.set(entry.record.id, {
      supersededId,
      diffs: buildDiff(old.values, entry.values, schema),
    });
  }
  return result;
}

/**
 * Set of record ids that have been superseded by a later correction (so the UI
 * can mark them as historical rather than current).
 */
export function supersededIds(records: ProtocolRecord[]): Set<string> {
  const set = new Set<string>();
  for (const r of records) if (r.supersedes) set.add(r.supersedes);
  return set;
}

/**
 * Run the cryptographic integrity check across the deployment chain.
 *
 * For each record we call `crypto.verifyRecord(record, expectedPrevHash)`, which
 * verifies BOTH the Ed25519 signature (by the embedded authorKeyId) AND that the
 * stored recordHash matches the canonical content AND that prevHash equals the
 * expected previous hash. We additionally assert seq contiguity (0,1,2,…) so a
 * dropped or duplicated record is caught even if hashes happen to line up.
 */
export async function checkIntegrity(records: ProtocolRecord[]): Promise<IntegrityReport> {
  await crypto.ready();
  const ordered = inChainOrder(records);
  const results: RecordIntegrity[] = [];

  let expectedPrevHash: string | null = null;
  let expectedSeq = 0;

  for (const record of ordered) {
    const seqContiguous = record.seq === expectedSeq;

    // verifyRecord checks signature + recordHash + prevHash linkage together.
    let signatureValid = false;
    let chainLinked = false;
    try {
      // Signature + hash integrity, independent of chain position.
      signatureValid = crypto.verifyRecord(record, record.prevHash);
      // Chain link: this record's prevHash must equal the previous record hash.
      chainLinked = record.prevHash === expectedPrevHash;
    } catch {
      signatureValid = false;
      chainLinked = false;
    }

    const ok = signatureValid && chainLinked && seqContiguous;
    results.push({
      recordId: record.id,
      seq: record.seq,
      signatureValid,
      chainLinked,
      seqContiguous,
      ok,
    });

    expectedPrevHash = record.recordHash;
    expectedSeq = record.seq + 1;
  }

  return { records: results, ok: results.every((r) => r.ok) };
}

/** Shorten a base64 keyId for display when no display name is resolvable. */
export function shortKeyId(keyId: string): string {
  if (keyId.length <= 14) return keyId;
  return `${keyId.slice(0, 8)}…${keyId.slice(-4)}`;
}
