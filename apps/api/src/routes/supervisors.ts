/**
 * SUPERVISORS (Einsatzleiter / Admin) — public keys for sealing records to them.
 *
 *   GET /api/org/supervisors   orgSupervisors   (auth)  → SupervisorListResponse
 *
 * So that an Einsatzleiter/Admin can later read a deployment's statistics, NEW
 * records are additionally sealed (client-side) to every ACTIVE supervisor
 * (role 'admin' or 'lead'). ANY authenticated member may call this — a regular
 * helper must fetch the supervisors' public keys to seal the per-record DEK to
 * them (recipientType 'supervisor').
 *
 * BLIND invariant: we return each supervisor's PUBLIC identity only
 * ({ keyId, boxPublicKey, signPublicKey }) + role. We NEVER serve the
 * password-wrapped secret or any secret material. Disabled users are excluded
 * (they are no longer active supervisors).
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, inArray } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  PublicIdentity,
  Role,
  SupervisorListResponse,
  SupervisorRecipient,
} from '@aidlog/contracts';
import { helpers } from '../db/schema.js';

export async function supervisorRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  // Any authenticated member: a helper needs supervisor public keys to seal new
  // records to them. Public identities only — never the wrapped secret.
  app.get(ROUTES.orgSupervisors, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const rows = await db
      .select({ identity: helpers.identity, role: helpers.role })
      .from(helpers)
      .where(
        and(
          eq(helpers.orgId, session.orgId),
          eq(helpers.status, 'active'),
          inArray(helpers.role, ['admin', 'lead']),
        ),
      );

    const supervisors: SupervisorRecipient[] = rows.map((r) => ({
      identity: r.identity as PublicIdentity,
      role: r.role as Role,
    }));
    const result: SupervisorListResponse = { supervisors };
    return reply.send(result);
  });
}
