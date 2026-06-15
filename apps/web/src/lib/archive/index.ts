/**
 * lib/archive — client-side ARCHIVE ANCHOR verification orchestration.
 *
 * Recomputes an org's Merkle root from the PUBLIC sync metadata (recordHash /
 * deploymentId / seq — fetched via the existing scope=org sync, NO decryption)
 * and confirms it matches a stored {@link NotarizationAnchor}. This is what makes
 * the anchor independently checkable: the server cannot forge a root for records
 * it does not actually hold, and any later tampering changes the recomputed root.
 *
 * ZERO-KNOWLEDGE: we read ONLY non-secret integrity fields off each record; the
 * org key is never needed and nothing is decrypted here.
 */
import { crypto } from '@aidlog/crypto-core';
import type { NotarizationAnchor } from '@aidlog/contracts';
import { api } from '$lib/api';
import { computeMerkleRoot, type ArchiveLeaf } from './merkle';

export type { ArchiveLeaf } from './merkle';
export { computeMerkleRoot } from './merkle';

/** Hard cap on pages fetched, so a pathological dataset can't spin forever. */
const MAX_PAGES = 10_000;

/**
 * Fetch the PUBLIC integrity metadata (recordHash/deploymentId/seq) for every
 * record in the caller's org via the existing scope=org sync. Admin/lead only
 * (the server enforces the role). Decrypts nothing.
 */
export async function fetchOrgLeaves(): Promise<ArchiveLeaf[]> {
  const leaves: ArchiveLeaf[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await api.syncOrg(cursor);
    for (const r of res.records) {
      leaves.push({ recordHash: r.recordHash, deploymentId: r.deploymentId, seq: r.seq });
    }
    if (!res.hasMore) break;
    cursor = res.cursor;
  }
  return leaves;
}

export interface VerifyResult {
  /** True when the recomputed root AND record count match the stored anchor. */
  ok: boolean;
  /** The root recomputed locally from the org's current recordHashes. */
  recomputedRoot: string;
  /** How many record leaves were used in the recomputation. */
  recomputedCount: number;
  /** True when the recomputed root equals the anchor's stored root. */
  rootMatches: boolean;
  /** True when the recomputed leaf count equals the anchor's stored count. */
  countMatches: boolean;
}

/**
 * Verify a single anchor by recomputing the Merkle root from the org's current
 * record metadata. A mismatch means records were added/removed/altered relative
 * to when the anchor was taken — or the anchor does not belong to this data set.
 *
 * NOTE: the anchor is a snapshot. Appending NEW records after an anchor was taken
 * legitimately changes the live root (more leaves) — the count will differ. The
 * UI surfaces this so a "newer records exist" mismatch is not read as tampering.
 */
export async function verifyAnchor(anchor: NotarizationAnchor): Promise<VerifyResult> {
  await crypto.ready();
  const leaves = await fetchOrgLeaves();
  if (leaves.length === 0) {
    return {
      ok: false,
      recomputedRoot: '',
      recomputedCount: 0,
      rootMatches: false,
      countMatches: anchor.recordCount === 0,
    };
  }
  const { merkleRoot, recordCount } = computeMerkleRoot(leaves);
  const rootMatches = merkleRoot === anchor.merkleRoot;
  const countMatches = recordCount === anchor.recordCount;
  return {
    ok: rootMatches && countMatches,
    recomputedRoot: merkleRoot,
    recomputedCount: recordCount,
    rootMatches,
    countMatches,
  };
}
