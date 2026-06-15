/**
 * Append a protocol record:  POST /api/records  (append; never mutate).
 *
 * Pipeline (all checks server-side, none requiring plaintext):
 *  1. zod-validate the request shape.
 *  2. AuthN: caller holds a valid session; record.authorKeyId must match it.
 *  3. Hash-chain continuity: prevHash must equal the stored last record's
 *     recordHash for the deployment (or both null at seq 0); seq must be
 *     lastSeq+1 (or 0).
 *  4. Signature + recordHash integrity via crypto-core.verifyRecord — the
 *     server verifies WITHOUT decrypting anything.
 *  5. Insert the immutable record and its sealedKeys (separate table) in one
 *     transaction. The DB trigger + role guarantee no later mutation.
 *  6. Return server receivedAt (authoritative receipt time).
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, desc } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type { AppendRecordResponse, ProtocolRecord } from '@aidlog/contracts';
import { crypto as cryptoCore } from '@aidlog/crypto-core';
import { appendRecordSchema } from '../validation.js';
import { records, sealedKeys, helpers, orgs } from '../db/schema.js';
import { badRequest, conflict, forbidden, sendError } from '../errors.js';

export async function recordRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;
  await cryptoCore.ready();

  app.post(ROUTES.records, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = appendRecordSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, badRequest('invalid record', parsed.error.issues));
    const record = parsed.data.record as ProtocolRecord;
    const session = req.session!;

    // The author of a record must be the authenticated caller.
    if (record.authorKeyId !== session.keyId) {
      return sendError(reply, forbidden('authorKeyId does not match session'));
    }

    // Resolve the author's signing public key (must belong to caller's org).
    const signPublicKey = await resolveSignPublicKey(app, record.authorKeyId, session.orgId);
    if (!signPublicKey) return sendError(reply, forbidden('unknown author key for this org'));

    // --- hash-chain continuity ---
    const lastRows = await db
      .select({ seq: records.seq, recordHash: records.recordHash })
      .from(records)
      .where(eq(records.deploymentId, record.deploymentId))
      .orderBy(desc(records.seq))
      .limit(1);
    const last = lastRows[0];

    if (!last) {
      // First record in the chain.
      if (record.seq !== 0 || record.prevHash !== null) {
        return sendError(reply, conflict('first record must have seq 0 and prevHash null'));
      }
    } else {
      if (record.seq !== last.seq + 1) {
        return sendError(
          reply,
          conflict('non-contiguous seq', { expected: last.seq + 1, got: record.seq }),
        );
      }
      if (record.prevHash !== last.recordHash) {
        return sendError(reply, conflict('prevHash does not match chain head'));
      }
    }

    // --- signature + recordHash integrity (no decryption involved) ---
    let valid = false;
    try {
      valid =
        cryptoCore.verifyRecord(record, record.prevHash) &&
        cryptoCore.verify(
          cryptoCore.fromBase64(record.signature),
          cryptoCore.fromBase64(record.recordHash),
          signPublicKey,
        );
    } catch {
      valid = false;
    }
    if (!valid) return sendError(reply, badRequest('record signature or hash is invalid'));

    const receivedAt = new Date();
    try {
      await db.transaction(async (tx) => {
        await tx.insert(records).values({
          id: record.id,
          orgId: session.orgId,
          deploymentId: record.deploymentId,
          seq: record.seq,
          envelopeVersion: record.envelopeVersion,
          authorKeyId: record.authorKeyId,
          payload: record.payload,
          blobs: record.blobs,
          prevHash: record.prevHash,
          recordHash: record.recordHash,
          signature: record.signature,
          alg: record.alg,
          supersedes: record.supersedes ?? null,
          createdAt: record.createdAt,
          receivedAt,
        });
        if (record.sealedKeys.length > 0) {
          await tx.insert(sealedKeys).values(
            record.sealedKeys.map((sk) => ({
              recordId: record.id,
              deploymentId: record.deploymentId,
              recipientType: sk.recipientType,
              recipientKeyId: sk.recipientKeyId,
              alg: sk.alg,
              ciphertext: sk.ciphertext,
            })),
          );
        }
      });
    } catch (err) {
      // Unique violation on (deploymentId, seq) or duplicate id ⇒ already exists.
      if (isUniqueViolation(err)) {
        return sendError(reply, conflict('record already exists for this deployment/seq'));
      }
      throw err;
    }

    const response: AppendRecordResponse = {
      id: record.id,
      receivedAt: receivedAt.toISOString(),
      seq: record.seq,
    };
    return reply.code(201).send(response);
  });
}

/** A signing key is valid for append only if it is a helper or org in the org. */
async function resolveSignPublicKey(
  app: FastifyInstance,
  keyId: string,
  orgId: string,
): Promise<Uint8Array | null> {
  const { db } = app.ctx;
  const helperRows = await db
    .select({ identity: helpers.identity })
    .from(helpers)
    .where(and(eq(helpers.keyId, keyId), eq(helpers.orgId, orgId)))
    .limit(1);
  const helper = helperRows[0];
  if (helper) return signKeyOf(helper.identity);

  const orgRows = await db
    .select({ identity: orgs.identity })
    .from(orgs)
    .where(and(eq(orgs.keyId, keyId), eq(orgs.orgId, orgId)))
    .limit(1);
  const org = orgRows[0];
  if (org) return signKeyOf(org.identity);
  return null;
}

function signKeyOf(identity: unknown): Uint8Array | null {
  if (
    typeof identity === 'object' &&
    identity !== null &&
    'signPublicKey' in identity &&
    typeof (identity as { signPublicKey: unknown }).signPublicKey === 'string'
  ) {
    return cryptoCore.fromBase64((identity as { signPublicKey: string }).signPublicKey);
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
