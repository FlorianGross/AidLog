/**
 * lib/archive/merkle.ts — CLIENT-SIDE Merkle recomputation for anchor verification.
 *
 * This is the EXACT mirror of the server's apps/api/src/anchor.ts rule. It must
 * stay byte-for-byte compatible so a client can recompute an org's Merkle root
 * from the PUBLIC recordHashes (recordHash/seq/deploymentId — NO decryption) and
 * confirm it matches a stored {@link NotarizationAnchor}. Hashing goes through
 * @aidlog/crypto-core's `hash` (BLAKE2b-256), the only crypto holder.
 *
 * REPRODUCIBLE RULE (keep in lockstep with anchor.ts):
 *   1. LEAVES ordered by (deploymentId ASC, seq ASC); leaf = H(0x00 || raw(recordHash)).
 *   2. NODE  = H(0x01 || left || right).
 *   3. Odd level: duplicate the last node.
 *   4. Root  = base64 of the final 32-byte hash.
 */
import { crypto } from '@aidlog/crypto-core';

/** One Merkle leaf input: a record's public hash + its chain position. */
export interface ArchiveLeaf {
  recordHash: string;
  deploymentId: string;
  seq: number;
}

const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

/** Total order over leaves: (deploymentId, seq) — unique, hence deterministic. */
export function compareLeaves(a: ArchiveLeaf, b: ArchiveLeaf): number {
  if (a.deploymentId < b.deploymentId) return -1;
  if (a.deploymentId > b.deploymentId) return 1;
  return a.seq - b.seq;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function hashLeaf(recordHash: string): Uint8Array {
  return crypto.hash(concat([Uint8Array.of(LEAF_PREFIX), crypto.fromBase64(recordHash)]));
}

function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return crypto.hash(concat([Uint8Array.of(NODE_PREFIX), left, right]));
}

/**
 * Recompute the deterministic Merkle root over a set of record leaves. Returns
 * the base64 root + leaf count. Sorts a COPY. Throws on an empty set (matches
 * the server: an empty set has no anchor). `crypto.ready()` must be awaited first.
 */
export function computeMerkleRoot(leaves: ArchiveLeaf[]): {
  merkleRoot: string;
  recordCount: number;
} {
  if (leaves.length === 0) throw new Error('cannot recompute an empty record set');
  const ordered = [...leaves].sort(compareLeaves);
  let level: Uint8Array[] = ordered.map((l) => hashLeaf(l.recordHash));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = i + 1 < level.length ? level[i + 1]! : left;
      next.push(hashNode(left, right));
    }
    level = next;
  }
  return { merkleRoot: crypto.toBase64(level[0]!), recordCount: ordered.length };
}
