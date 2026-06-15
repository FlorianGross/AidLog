/**
 * Archival anchoring (legally-robust, tamper-evident):
 *
 *   POST /api/notarize   create anchor   (admin|lead) → CreateAnchorResponse
 *   GET  /api/notarize   list anchors    (admin|lead) → AnchorListResponse
 *
 * Builds a deterministic Merkle tree over ALL of the org's PUBLIC recordHashes
 * (ordered by deploymentId, seq — see anchor.ts), signs the root server-side
 * (HMAC), and OPTIONALLY obtains an RFC 3161 trusted timestamp. The result is
 * stored as an immutable anchor.
 *
 * ZERO-KNOWLEDGE: the server reads ONLY record_hash/deployment_id/seq (non-secret
 * integrity metadata it already stores) and NEVER decrypts anything. The anchor
 * carries no patient data, ciphertext, DEK, or secret key.
 */
import type { FastifyInstance } from 'fastify';
import { asc, desc, eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  AnchorListResponse,
  CreateAnchorResponse,
  NotarizationAnchor,
} from '@aidlog/contracts';
import { crypto as cryptoCore } from '@aidlog/crypto-core';
import { records, notarizationAnchors } from '../db/schema.js';
import type { NotarizationAnchorRow } from '../db/schema.js';
import {
  ANCHOR_ALGORITHM,
  buildMerkleRoot,
  deriveAnchorKey,
  requestTsaToken,
  signAnchorRoot,
  type AnchorLeaf,
} from '../anchor.js';
import { writeAudit } from '../audit.js';
import { badRequest, sendError } from '../errors.js';

export async function notarizeRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;
  await cryptoCore.ready();
  const anchorKey = deriveAnchorKey(config);

  // --- POST create an anchor (admin | lead) ------------------------------
  app.post(
    ROUTES.notarize,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const session = req.session!;

      // Read ONLY the public integrity columns for the org, ordered for a
      // deterministic, reproducible Merkle leaf layout.
      const rows = await db
        .select({
          recordHash: records.recordHash,
          deploymentId: records.deploymentId,
          seq: records.seq,
        })
        .from(records)
        .where(eq(records.orgId, session.orgId))
        .orderBy(asc(records.deploymentId), asc(records.seq));

      if (rows.length === 0) {
        return sendError(reply, badRequest('no records to anchor'));
      }

      const leaves: AnchorLeaf[] = rows.map((r) => ({
        recordHash: r.recordHash,
        deploymentId: r.deploymentId,
        seq: r.seq,
      }));
      const { merkleRoot, recordCount } = buildMerkleRoot(leaves);
      const serverSignature = signAnchorRoot(anchorKey, ANCHOR_ALGORITHM, merkleRoot, recordCount);

      // OPTIONAL RFC 3161 trusted timestamp over the root. Never blocks anchoring.
      let tsaTime: Date | null = null;
      let tsaToken: Buffer | null = null;
      if (config.TSA_URL) {
        const rootBytes = cryptoCore.fromBase64(merkleRoot);
        const tsa = await requestTsaToken(config.TSA_URL, rootBytes, config.TSA_TIMEOUT_MS).catch(
          () => null,
        );
        if (tsa) {
          tsaToken = tsa.token;
          tsaTime = tsa.tsaTime;
          if (!tsaTime) {
            req.log.warn('TSA token stored without a parseable time');
          }
        } else {
          req.log.warn('TSA timestamp unavailable; stored baseline server-signed anchor');
        }
      }

      const inserted = await db
        .insert(notarizationAnchors)
        .values({
          orgId: session.orgId,
          merkleRoot,
          recordCount,
          algorithm: ANCHOR_ALGORITHM,
          serverSignature,
          tsaTime,
          tsaToken,
        })
        .returning();
      const row = inserted[0]!;

      await writeAudit(
        db,
        {
          orgId: session.orgId,
          actorKeyId: session.keyId,
          action: 'archive.anchored',
          detail: `${recordCount} records${tsaTime ? ' +TSA' : ''}`,
        },
        req.log,
      );

      const response: CreateAnchorResponse = { anchor: toAnchor(row) };
      return reply.code(201).send(response);
    },
  );

  // --- GET list anchors (admin | lead) -----------------------------------
  app.get(
    ROUTES.notarize,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db
        .select()
        .from(notarizationAnchors)
        .where(eq(notarizationAnchors.orgId, session.orgId))
        .orderBy(desc(notarizationAnchors.createdAt));
      const response: AnchorListResponse = { anchors: rows.map(toAnchor) };
      return reply.send(response);
    },
  );
}

function toAnchor(row: NotarizationAnchorRow): NotarizationAnchor {
  const a: NotarizationAnchor = {
    id: row.id,
    orgId: row.orgId,
    merkleRoot: row.merkleRoot,
    recordCount: row.recordCount,
    algorithm: row.algorithm as NotarizationAnchor['algorithm'],
    createdAt: row.createdAt.toISOString(),
    serverSignature: row.serverSignature,
  };
  if (row.tsaTime) a.tsaTime = row.tsaTime.toISOString();
  if (row.tsaToken && row.tsaToken.length > 0) a.tsaTokenPresent = true;
  return a;
}
