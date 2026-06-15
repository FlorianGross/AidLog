/**
 * Shift-end soft revocation:  POST /api/shifts/close  (ARCHITECTURE.md §5).
 *
 * Deletes ONLY the helper-typed sealed_keys for (deploymentId, helperKeyId).
 * The immutable `records` rows and the org wrapper are untouched — the helper
 * simply loses the ability to decrypt going forward. This is a DELETE on the
 * separate sealed_keys table, which is exactly why that table exists apart from
 * the append-only records table.
 *
 * Honest limitation (documented in the threat model): this cannot erase what a
 * helper already viewed/copied while the shift was open. It removes future
 * decryption capability, not past knowledge.
 *
 * AuthZ: an org-admin may close any helper's shift; a helper may only close
 * their OWN wrappers (helperKeyId must equal their session keyId).
 */
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import { closeShiftSchema } from '../validation.js';
import { sealedKeys } from '../db/schema.js';
import { writeAudit } from '../audit.js';
import { badRequest, forbidden, sendError } from '../errors.js';

export async function shiftRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.post(ROUTES.closeShift, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = closeShiftSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid close-shift request', parsed.error.issues));
    const { deploymentId, helperKeyId } = parsed.data;
    const session = req.session!;

    if (session.role === 'helper' && helperKeyId !== session.keyId) {
      return sendError(reply, forbidden('a helper may only close their own wrappers'));
    }

    // Delete ONLY helper-typed wrappers for this deployment + helper key.
    // recipientType is constrained to 'helper' so org wrappers can never be hit.
    const deleted = await db
      .delete(sealedKeys)
      .where(
        and(
          eq(sealedKeys.deploymentId, deploymentId),
          eq(sealedKeys.recipientType, 'helper'),
          eq(sealedKeys.recipientKeyId, helperKeyId),
        ),
      )
      .returning({ recordId: sealedKeys.recordId });

    await writeAudit(
      db,
      {
        orgId: session.orgId,
        actorKeyId: session.keyId,
        action: 'shift.closed',
        targetKeyId: helperKeyId,
        detail: `deployment=${deploymentId} revoked=${deleted.length}`,
      },
      req.log,
    );

    return reply.send({ deploymentId, helperKeyId, revokedWrappers: deleted.length });
  });
}
