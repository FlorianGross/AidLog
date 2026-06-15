/**
 * Co-signature (Gegenzeichnung) + cosigner sealed-key grants.
 *
 *   POST /api/records/sealed-keys  addSealedKeys   (auth) → { recordId, added }
 *   POST /api/cosign               create request  (auth) → CosignatureRequest
 *   GET  /api/cosign               my pending      (auth) → { requests }
 *   POST /api/cosign/sign          submit decision (auth) → Cosignature
 *
 * Invariants:
 *  - Appending cosigner-sealed DEKs lands ONLY in the separate `sealed_keys`
 *    table; the immutable `records` row is never touched (append-only preserved).
 *  - A co-signature is an Ed25519 signature over the record's stored recordHash,
 *    verified server-side via @aidlog/crypto-core BEFORE it is accepted — a
 *    tampered signature is rejected. The server still never decrypts content.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  Cosignature,
  CosignatureRequest as CosignatureRequestDto,
  CosignStatus,
  KeyId,
  SealedKey,
} from '@aidlog/contracts';
import { crypto as cryptoCore } from '@aidlog/crypto-core';
import {
  addSealedKeysSchema,
  createCosignatureSchema,
  submitCosignatureSchema,
} from '../validation.js';
import { records, sealedKeys, helpers, cosignatureRequests, cosignatures } from '../db/schema.js';
import type { Db } from '../db/client.js';
import type { SessionContext } from '../auth.js';
import { badRequest, conflict, forbidden, notFound, sendError, HttpError } from '../errors.js';
import { sendPushToKeyIds } from '../push.js';

export async function cosignRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;
  await cryptoCore.ready();

  // --- append cosigner sealed keys to an existing record -----------------
  app.post(ROUTES.sealedKeys, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = addSealedKeysSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid sealed keys', parsed.error.issues));
    const { recordId, sealedKeys: keys } = parsed.data;
    const session = req.session!;

    const authz = await authorizeSealedKeyGrant(db, recordId, session);
    if (authz.error) return sendError(reply, authz.error);

    const added = await appendSealedKeys(db, recordId, authz.deploymentId, keys);
    return reply.code(201).send({ recordId, added });
  });

  // --- create a co-signature request -------------------------------------
  app.post(ROUTES.cosignRequests, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = createCosignatureSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid cosign request', parsed.error.issues));
    const body = parsed.data;
    const session = req.session!;

    const authz = await authorizeSealedKeyGrant(db, body.recordId, session);
    if (authz.error) return sendError(reply, authz.error);
    if (authz.deploymentId !== body.deploymentId) {
      return sendError(reply, badRequest('deploymentId does not match record'));
    }

    const inserted = await db.transaction(async (tx) => {
      // Store the cosigner read-grants (reuses the same append path).
      await appendSealedKeys(
        tx as unknown as Db,
        body.recordId,
        authz.deploymentId,
        body.sealedKeys,
      );
      const rows = await tx
        .insert(cosignatureRequests)
        .values({
          recordId: body.recordId,
          deploymentId: body.deploymentId,
          orgId: session.orgId,
          requestedByKeyId: session.keyId,
          requestedSigners: body.requestedSigners,
          status: 'pending',
          note: body.note ?? null,
        })
        .returning();
      return rows[0]!;
    });

    // Notify each requested signer with a GENERIC, content-free push. The body
    // reveals NO record/patient detail — only that a co-signature was asked for.
    // Best-effort: never blocks or fails the request creation.
    void sendPushToKeyIds(db, config, body.requestedSigners, {
      title: 'Aidlog',
      body: 'Neue Gegenzeichnung angefragt',
      url: '/cosign/',
    });

    return reply.code(201).send(toRequestDto(inserted));
  });

  // --- list MY pending requests (where I am a requested signer) ----------
  app.get(ROUTES.cosignRequests, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const rows = await db
      .select()
      .from(cosignatureRequests)
      .where(eq(cosignatureRequests.orgId, session.orgId));

    const awaitingMe: CosignatureRequestDto[] = [];
    const createdByMe: CosignatureRequestDto[] = [];
    for (const row of rows) {
      const signers = (row.requestedSigners as KeyId[]) ?? [];
      const dto = toRequestDto(row);
      if (
        signers.includes(session.keyId) &&
        (row.status === 'pending' || row.status === 'partially-signed')
      ) {
        awaitingMe.push(dto);
      }
      if (row.requestedByKeyId === session.keyId) createdByMe.push(dto);
    }
    return reply.send({ requests: awaitingMe, created: createdByMe });
  });

  // --- submit a co-signature (or rejection) ------------------------------
  app.post(ROUTES.cosignSubmit, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = submitCosignatureSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid cosignature', parsed.error.issues));
    const body = parsed.data;
    const session = req.session!;

    const reqRows = await db
      .select()
      .from(cosignatureRequests)
      .where(
        and(
          eq(cosignatureRequests.id, body.requestId),
          eq(cosignatureRequests.orgId, session.orgId),
        ),
      )
      .limit(1);
    const request = reqRows[0];
    if (!request) return sendError(reply, notFound('cosignature request not found'));

    const signers = (request.requestedSigners as KeyId[]) ?? [];
    if (!signers.includes(session.keyId)) {
      return sendError(reply, forbidden('you are not a requested signer'));
    }
    if (request.status === 'complete' || request.status === 'rejected') {
      return sendError(reply, conflict('request is already finalised'));
    }

    // Resolve the signer's public signing key (must be in this org).
    const signPublicKey = await resolveSignKey(db, session.keyId, session.orgId);
    if (!signPublicKey) return sendError(reply, forbidden('unknown signer key for this org'));

    // Fetch the record's stored recordHash — what the co-signature must cover.
    const recRows = await db
      .select({ recordHash: records.recordHash })
      .from(records)
      .where(and(eq(records.id, request.recordId), eq(records.orgId, session.orgId)))
      .limit(1);
    const rec = recRows[0];
    if (!rec) return sendError(reply, notFound('record not found'));

    if (body.decision === 'signed') {
      // Verify Ed25519 over the record's recordHash via crypto-core ONLY.
      let ok = false;
      try {
        ok = cryptoCore.verify(
          cryptoCore.fromBase64(body.signature),
          cryptoCore.fromBase64(rec.recordHash),
          signPublicKey,
        );
      } catch {
        ok = false;
      }
      if (!ok) return sendError(reply, badRequest('cosignature does not verify against record'));
    }

    let cosignature: Cosignature;
    try {
      cosignature = await db.transaction(async (tx) => {
        const insertedRows = await tx
          .insert(cosignatures)
          .values({
            requestId: request.id,
            recordId: request.recordId,
            signerKeyId: session.keyId,
            decision: body.decision,
            signature: body.signature,
            signatureImage: body.signatureImage ?? null,
          })
          .returning();
        const cosignRow = insertedRows[0]!;

        // Recompute request status from all decisions so far.
        const all = await tx
          .select({ signerKeyId: cosignatures.signerKeyId, decision: cosignatures.decision })
          .from(cosignatures)
          .where(eq(cosignatures.requestId, request.id));
        const nextStatus = computeStatus(signers, all);
        if (nextStatus !== request.status) {
          await tx
            .update(cosignatureRequests)
            .set({ status: nextStatus })
            .where(eq(cosignatureRequests.id, request.id));
        }
        return toCosignatureDto(cosignRow);
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        return sendError(reply, conflict('you have already responded to this request'));
      }
      throw err;
    }

    return reply.code(201).send(cosignature);
  });
}

interface SealedKeyAuthz {
  deploymentId: string;
  error?: HttpError;
}

/**
 * A cosigner read-grant may be added only by the record's author or by a
 * lead/admin of the same org. Returns the record's deploymentId on success.
 */
async function authorizeSealedKeyGrant(
  db: Db,
  recordId: string,
  session: SessionContext,
): Promise<SealedKeyAuthz> {
  const recRows = await db
    .select({
      deploymentId: records.deploymentId,
      authorKeyId: records.authorKeyId,
      orgId: records.orgId,
    })
    .from(records)
    .where(eq(records.id, recordId))
    .limit(1);
  const rec = recRows[0];
  if (!rec || rec.orgId !== session.orgId) {
    return { deploymentId: '', error: notFound('record not found') };
  }
  const isAuthor = rec.authorKeyId === session.keyId;
  const isPrivileged = session.role === 'lead' || session.role === 'admin';
  if (!isAuthor && !isPrivileged) {
    return {
      deploymentId: rec.deploymentId,
      error: forbidden('only the record author or a lead/admin may add cosigner grants'),
    };
  }
  return { deploymentId: rec.deploymentId };
}

/**
 * Append sealed keys to the SEPARATE sealed_keys table (never the record).
 * Idempotent: re-adding an existing (recordId, recipientKeyId) is ignored.
 * Returns the number of rows actually inserted.
 */
async function appendSealedKeys(
  db: Db,
  recordId: string,
  deploymentId: string,
  keys: SealedKey[],
): Promise<number> {
  if (keys.length === 0) return 0;
  const inserted = await db
    .insert(sealedKeys)
    .values(
      keys.map((sk) => ({
        recordId,
        deploymentId,
        recipientType: sk.recipientType,
        recipientKeyId: sk.recipientKeyId,
        alg: sk.alg,
        ciphertext: sk.ciphertext,
      })),
    )
    .onConflictDoNothing()
    .returning({ recipientKeyId: sealedKeys.recipientKeyId });
  return inserted.length;
}

/** Compute request status from the requested signers + collected decisions. */
function computeStatus(
  signers: KeyId[],
  decisions: { signerKeyId: string; decision: string }[],
): CosignStatus {
  if (decisions.some((d) => d.decision === 'rejected')) return 'rejected';
  const signedSet = new Set(
    decisions.filter((d) => d.decision === 'signed').map((d) => d.signerKeyId),
  );
  const allSigned = signers.length > 0 && signers.every((s) => signedSet.has(s));
  if (allSigned) return 'complete';
  if (signedSet.size > 0) return 'partially-signed';
  return 'pending';
}

async function resolveSignKey(db: Db, keyId: string, orgId: string): Promise<Uint8Array | null> {
  const rows = await db
    .select({ identity: helpers.identity, status: helpers.status })
    .from(helpers)
    .where(and(eq(helpers.keyId, keyId), eq(helpers.orgId, orgId)))
    .limit(1);
  const row = rows[0];
  if (!row || row.status === 'disabled') return null;
  const identity = row.identity as { signPublicKey?: string };
  if (typeof identity.signPublicKey !== 'string') return null;
  return cryptoCore.fromBase64(identity.signPublicKey);
}

function toRequestDto(row: typeof cosignatureRequests.$inferSelect): CosignatureRequestDto {
  const dto: CosignatureRequestDto = {
    id: row.id,
    recordId: row.recordId,
    deploymentId: row.deploymentId,
    orgId: row.orgId,
    requestedByKeyId: row.requestedByKeyId,
    requestedSigners: (row.requestedSigners as KeyId[]) ?? [],
    status: row.status as CosignStatus,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.note) dto.note = row.note;
  return dto;
}

function toCosignatureDto(row: typeof cosignatures.$inferSelect): Cosignature {
  const dto: Cosignature = {
    id: row.id,
    requestId: row.requestId,
    recordId: row.recordId,
    signerKeyId: row.signerKeyId,
    decision: row.decision as 'signed' | 'rejected',
    signature: row.signature,
    signedAt: row.signedAt.toISOString(),
  };
  if (row.signatureImage) {
    dto.signatureImage = row.signatureImage as NonNullable<Cosignature['signatureImage']>;
  }
  return dto;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
