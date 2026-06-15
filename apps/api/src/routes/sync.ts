/**
 * Cursor-based, role-scoped sync:  GET /api/sync
 *
 * Reassembles ProtocolRecords (joining the split-out sealed_keys) for records
 * the caller is permitted to read. Two scopes:
 *
 *  - scope=self (default): the existing per-author view —
 *      · admin/lead: every record in their org (org + own wrappers, incl. their
 *                    own persistent 'author' wrapper).
 *      · helper:     records they authored, AND only the sealedKeys still sealed
 *                    to THEM (the transient 'helper' wrapper while the shift is
 *                    open, PLUS the PERSISTENT 'author' wrapper that survives
 *                    shift close — "Meine Einsätze") or to the org. Helper
 *                    wrappers removed at shift close are simply gone (soft
 *                    revocation, §5); the 'author' wrapper is not removed.
 *
 *  - scope=org (admin/lead ONLY): EVERY record in the org, each carrying its
 *      ORG-type sealedKeys PLUS any wrapper sealed to the CALLER themselves
 *      (their own 'supervisor'/'cosigner' wrapper). This powers the client-side
 *      ORG ANALYTICS dashboard: an admin/lead either unlocks the org key locally
 *      OR — for records sealed to them as an active supervisor — decrypts with
 *      their OWN key (no org password). The server still only ever serves
 *      ciphertext; OTHER users' helper/cosigner/supervisor wrappers are never
 *      leaked. A helper requesting scope=org is rejected with 403.
 *
 * The cursor is the opaque `ingest_seq` (server-assigned monotonic id), base64.
 * Records are returned strictly after the cursor, ordered by ingest_seq.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, gt, inArray, asc } from 'drizzle-orm';
import { ROUTES, ENVELOPE_VERSION } from '@aidlog/contracts';
import type {
  SyncResponse,
  ProtocolRecord,
  SealedKey,
  EncryptedPayload,
  EncryptedBlobRef,
} from '@aidlog/contracts';
import { syncQuerySchema } from '../validation.js';
import { records, sealedKeys } from '../db/schema.js';
import { badRequest, forbidden, sendError } from '../errors.js';

const DEFAULT_LIMIT = 100;

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const n = Number.parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
const encodeCursor = (ingestSeq: number): string =>
  Buffer.from(String(ingestSeq), 'utf8').toString('base64url');

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.get(ROUTES.sync, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = syncQuerySchema.safeParse(req.query);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid sync query', parsed.error.issues));
    const { cursor, deploymentId, limit, scope } = parsed.data;
    const session = req.session!;
    const after = decodeCursor(cursor);
    const take = limit ?? DEFAULT_LIMIT;

    // Org-wide analytics read: every record in the org, ORG wrappers only.
    // Restricted to admin/lead — a helper may never read another's records.
    const orgScope = scope === 'org';
    if (orgScope && session.role !== 'admin' && session.role !== 'lead') {
      return sendError(reply, forbidden('scope=org requires admin or lead role'));
    }

    const conditions = [eq(records.orgId, session.orgId), gt(records.ingestSeq, after)];
    if (deploymentId) conditions.push(eq(records.deploymentId, deploymentId));
    // Helpers may only read records they authored (self scope; org scope blocked above).
    if (!orgScope && session.role === 'helper') {
      conditions.push(eq(records.authorKeyId, session.keyId));
    }

    const rows = await db
      .select()
      .from(records)
      .where(and(...conditions))
      .orderBy(asc(records.ingestSeq))
      .limit(take + 1);

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    // Fetch sealed keys for this page in one query.
    const ids = page.map((r) => r.id);
    const sealed =
      ids.length > 0
        ? await db.select().from(sealedKeys).where(inArray(sealedKeys.recordId, ids))
        : [];

    const byRecord = new Map<string, SealedKey[]>();
    for (const sk of sealed) {
      if (orgScope) {
        // Org analytics: serve the org wrapper (opens with the org key) PLUS any
        // wrapper addressed to the CALLER themselves — i.e. their own
        // 'supervisor' (or 'cosigner') wrapper, which lets a lead/admin decrypt
        // org records with their OWN key for the statistics view, no org
        // password needed. We must NOT leak OTHER users' helper/cosigner/
        // supervisor wrappers, so any non-org wrapper sealed to someone else is
        // skipped.
        const isOrg = sk.recipientType === 'org';
        const isMine = sk.recipientKeyId === session.keyId;
        if (!isOrg && !isMine) continue;
      } else if (session.role === 'helper') {
        // Self scope, helper: only org wrappers + wrappers sealed to itself. This
        // includes BOTH the transient 'helper' wrapper (present until shift close)
        // AND the PERSISTENT 'author' wrapper (survives shift close), so the
        // helper keeps cross-device read access to records they authored — the
        // "Meine Einsätze" feature. Wrappers addressed to anyone else are skipped.
        const isMine =
          (sk.recipientType === 'helper' || sk.recipientType === 'author') &&
          sk.recipientKeyId === session.keyId;
        const isOrg = sk.recipientType === 'org';
        if (!isMine && !isOrg) continue;
      }
      const arr = byRecord.get(sk.recordId) ?? [];
      arr.push({
        recipientType: sk.recipientType as SealedKey['recipientType'],
        recipientKeyId: sk.recipientKeyId,
        alg: sk.alg as SealedKey['alg'],
        ciphertext: sk.ciphertext,
      });
      byRecord.set(sk.recordId, arr);
    }

    const out: ProtocolRecord[] = page.map((r) => {
      const rec: ProtocolRecord = {
        envelopeVersion: ENVELOPE_VERSION,
        id: r.id,
        deploymentId: r.deploymentId,
        seq: r.seq,
        createdAt: r.createdAt,
        authorKeyId: r.authorKeyId,
        payload: r.payload as EncryptedPayload,
        blobs: r.blobs as EncryptedBlobRef[],
        sealedKeys: byRecord.get(r.id) ?? [],
        prevHash: r.prevHash,
        recordHash: r.recordHash,
        signature: r.signature,
        alg: r.alg as ProtocolRecord['alg'],
        supersedes: r.supersedes,
      };
      return rec;
    });

    const lastIngest = page.length > 0 ? page[page.length - 1]!.ingestSeq : after;
    const response: SyncResponse = {
      records: out,
      cursor: encodeCursor(lastIngest),
      hasMore,
    };
    return reply.send(response);
  });
}
