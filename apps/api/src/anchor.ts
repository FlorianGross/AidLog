/**
 * anchor.ts — LEGALLY-ROBUST ARCHIVAL ANCHORING over the record hash-chain.
 *
 * The server is BLIND, but `records.recordHash` (with prevHash + seq) is NON-secret
 * integrity metadata it already stores. This module builds a deterministic Merkle
 * tree over ALL of an org's recordHashes, yielding a single `merkleRoot` that
 * proves the set of records existed and is internally consistent — WITHOUT
 * decrypting anything. Anchoring = sign that root (server-side, baseline) and
 * OPTIONALLY obtain an RFC 3161 trusted timestamp.
 *
 * REPRODUCIBLE MERKLE RULE (this file is the spec; the web verifier MUST match —
 * see apps/web/src/lib/archive/merkle.ts):
 *   1. LEAVES: every record's `recordHash`, ordered by (deploymentId ASC, seq ASC)
 *      — a TOTAL order because (deploymentId, seq) is UNIQUE. Each leaf hash is
 *        BLAKE2b-256( 0x00 || base64decode(recordHash) ).
 *      The 0x00 leaf-domain prefix gives second-preimage resistance (RFC 6962 style).
 *   2. NODES: parent = BLAKE2b-256( 0x01 || left || right ).
 *   3. ODD level: the last node is DUPLICATED (paired with itself) — Bitcoin-style.
 *   4. ROOT: base64 of the final 32-byte hash. recordCount = leaf count. An empty
 *      set has NO root (callers reject recordCount 0).
 *
 * Hashing goes through @aidlog/crypto-core's `hash` (BLAKE2b-256) — the SAME
 * primitive used to compute the recordHashes themselves. No content crypto, no
 * decryption, no node:crypto for the tree. The root SIGNATURE is a non-content
 * HMAC (node:crypto, allow-pragma'd) keyed by a dedicated server secret.
 */
import { createHmac, createHash } from 'node:crypto'; // crypto-lint-allow: server-side anchor root signature (HMAC) + SHA-256 RFC 3161 imprint, both over PUBLIC Merkle root metadata; not content/DEK/password crypto
import { crypto as cryptoCore } from '@aidlog/crypto-core';
import type { AnchorAlg } from '@aidlog/contracts';

/** Pinned scheme id stored on every anchor; bump on any Merkle/sig rule change. */
export const ANCHOR_ALGORITHM: AnchorAlg = 'merkle-blake2b-256/v1';

/** Domain-separation tags for the two BLAKE2b inputs (second-preimage safety). */
const LEAF_PREFIX = 0x00;
const NODE_PREFIX = 0x01;

/** One Merkle leaf input: a record's public hash + its chain position. */
export interface AnchorLeaf {
  recordHash: string; // base64 BLAKE2b-256 of the canonical record (non-secret)
  deploymentId: string;
  seq: number;
}

/** Total order over leaves: (deploymentId, seq). Unique, hence deterministic. */
export function compareLeaves(a: AnchorLeaf, b: AnchorLeaf): number {
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

/** Leaf hash = BLAKE2b-256( 0x00 || rawBytes(recordHash) ). */
function hashLeaf(recordHash: string): Uint8Array {
  const raw = cryptoCore.fromBase64(recordHash);
  return cryptoCore.hash(concat([Uint8Array.of(LEAF_PREFIX), raw]));
}

/** Parent hash = BLAKE2b-256( 0x01 || left || right ). */
function hashNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return cryptoCore.hash(concat([Uint8Array.of(NODE_PREFIX), left, right]));
}

/**
 * Build the deterministic Merkle root over a set of record leaves. Returns the
 * base64 root and the leaf count. Sorts a COPY (caller order is irrelevant).
 * Requires at least one leaf; throws otherwise (an empty set has no anchor).
 *
 * `cryptoCore.ready()` must have been awaited before calling (the routes do so).
 */
export function buildMerkleRoot(leaves: AnchorLeaf[]): { merkleRoot: string; recordCount: number } {
  if (leaves.length === 0) {
    throw new Error('cannot anchor an empty record set');
  }
  const ordered = [...leaves].sort(compareLeaves);
  let level: Uint8Array[] = ordered.map((l) => hashLeaf(l.recordHash));

  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      // Odd count: duplicate the last node (pair it with itself).
      const right = i + 1 < level.length ? level[i + 1]! : left;
      next.push(hashNode(left, right));
    }
    level = next;
  }

  return { merkleRoot: cryptoCore.toBase64(level[0]!), recordCount: ordered.length };
}

/**
 * The canonical string a server signature covers. Stable across servers so a
 * verifier with the same ANCHOR key can re-derive it. Carries only public values.
 */
export function canonicalAnchorString(
  algorithm: AnchorAlg,
  merkleRoot: string,
  recordCount: number,
): string {
  return `${algorithm}:${merkleRoot}:${recordCount}`;
}

/**
 * Derive the dedicated anchor-signing key. Prefer an explicit ANCHOR_SECRET; if
 * absent, derive a domain-separated key from SESSION_SECRET so anchoring works
 * out of the box WITHOUT reusing the session-token key verbatim.
 */
export function deriveAnchorKey(cfg: {
  ANCHOR_SECRET?: string | undefined;
  SESSION_SECRET: string;
}): string {
  if (cfg.ANCHOR_SECRET) return cfg.ANCHOR_SECRET;
  // Domain-separated derivation: HMAC(SESSION_SECRET, "aidlog:anchor-signing:v1").
  return createHmac('sha256', cfg.SESSION_SECRET)
    .update('aidlog:anchor-signing:v1')
    .digest('base64url');
}

/** base64 HMAC-SHA256 over the canonical anchor string. Non-content signature. */
export function signAnchorRoot(
  key: string,
  algorithm: AnchorAlg,
  merkleRoot: string,
  recordCount: number,
): string {
  return createHmac('sha256', key)
    .update(canonicalAnchorString(algorithm, merkleRoot, recordCount))
    .digest('base64');
}

// ---------------------------------------------------------------------------
// OPTIONAL RFC 3161 trusted timestamp.
//
// TRADE-OFF (documented): rather than add an ASN.1/TSP dependency, we build a
// minimal TimeStampReq (TSQ) by hand and POST it to the TSA. We store the raw
// TimeStampResp (TSR) token bytes verbatim and parse ONLY a coarse generalTime
// for display. Full token VERIFICATION (TSA cert chain, hashed-message match) is
// intentionally left to an offline tool / external verifier — storing the raw
// RFC 3161 token preserves the legally-relevant artifact without pulling a
// heavy, security-sensitive ASN.1 stack into the blind server. A TSA failure or
// timeout NEVER blocks anchoring: the baseline server-signed anchor still stands.
// ---------------------------------------------------------------------------

export interface TsaResult {
  /** Raw DER bytes of the RFC 3161 TimeStampResp/token, to store verbatim. */
  token: Buffer;
  /** Best-effort parsed TSA time, if a generalTime could be read from the token. */
  tsaTime: Date | null;
}

/**
 * Build a DER-encoded RFC 3161 TimeStampReq over a SHA-256 message imprint.
 *
 * TimeStampReq ::= SEQUENCE {
 *   version    INTEGER { v1(1) },
 *   messageImprint MessageImprint,        -- SEQUENCE { AlgorithmIdentifier, OCTET STRING }
 *   certReq    BOOLEAN DEFAULT FALSE }
 *
 * We hash the (public) Merkle-root bytes with SHA-256 for the imprint — this is a
 * non-secret integrity digest, not content crypto. We request certReq=TRUE so the
 * TSA embeds its signing cert in the token (better for offline verification).
 */
export function buildTimeStampReq(merkleRootBytes: Uint8Array): Buffer {
  // SHA-256 message imprint of the PUBLIC root bytes (unkeyed digest, per RFC 3161).
  const imprint = createHash('sha256').update(merkleRootBytes).digest();
  // AlgorithmIdentifier for SHA-256: OID 2.16.840.1.101.3.4.2.1, params NULL.
  const sha256Oid = der(0x06, Buffer.from([0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]));
  const algId = der(0x30, Buffer.concat([sha256Oid, der(0x05, Buffer.alloc(0))]));
  const messageImprint = der(0x30, Buffer.concat([algId, der(0x04, imprint)]));
  const version = der(0x02, Buffer.from([0x01]));
  const certReq = der(0x01, Buffer.from([0xff])); // BOOLEAN TRUE
  return der(0x30, Buffer.concat([version, messageImprint, certReq]));
}

/** Submit a TSQ to the TSA and return the raw token + a best-effort parsed time. */
export async function requestTsaToken(
  tsaUrl: string,
  merkleRootBytes: Uint8Array,
  timeoutMs: number,
): Promise<TsaResult | null> {
  const req = buildTimeStampReq(merkleRootBytes);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(tsaUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/timestamp-query' },
      body: req,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const token = Buffer.from(await res.arrayBuffer());
    if (token.length === 0) return null;
    return { token, tsaTime: parseGeneralTime(token) };
  } catch {
    // Never block anchoring on a TSA error/timeout.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- tiny DER + ASN.1 helpers (local; no dependency) -----------------------

/** Wrap `content` in a DER TLV with the given tag and a definite length. */
function der(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * Best-effort: scan the DER token for the FIRST ASN.1 GeneralizedTime (tag 0x18)
 * and parse it as the TSA time. Robust enough for display; full structural
 * parsing is deferred to an external verifier (see TRADE-OFF note above).
 */
export function parseGeneralTime(token: Buffer): Date | null {
  for (let i = 0; i + 1 < token.length; i++) {
    if (token[i] !== 0x18) continue;
    const len = token[i + 1]!;
    if (len < 0x0e || len > 0x20 || i + 2 + len > token.length) continue;
    const s = token.subarray(i + 2, i + 2 + len).toString('ascii');
    // GeneralizedTime: YYYYMMDDHHMMSS[.fff]Z
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z$/.exec(s);
    if (!m) continue;
    const [, y, mo, d, h, mi, se] = m;
    const ms = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +se!);
    if (!Number.isNaN(ms)) return new Date(ms);
  }
  return null;
}
