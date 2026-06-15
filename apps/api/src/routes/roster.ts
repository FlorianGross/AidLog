/**
 * Anwesenheit / Dienst — per-deployment ROSTER routes.
 *
 *   GET  /api/deployments/:id/roster   list roster      (auth, org-scoped)
 *   POST /api/deployments/:id/roster   upsert entry     (auth) — self check-in/out;
 *   PUT  /api/deployments/:id/roster   upsert entry     admin/lead may target others
 *
 * PRIVACY: a roster row is OPERATIONAL personnel/duty metadata — who is on duty,
 * check-in/out times, a free-text role-at-event, plus a snapshot of the helper's
 * qualification (an Ausbildungsstand). It is NOT patient/health data and is
 * stored in clear. NEVER write a patient/health value here. Everything is scoped
 * to the caller's `req.session.orgId`.
 *
 * AuthZ: any authenticated user may READ their org's roster and upsert their OWN
 * entry (self check-in/out). Targeting ANOTHER helper (a non-self `helperKeyId`)
 * requires role admin or lead.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type { Qualification, RosterEntry, RosterListResponse } from '@aidlog/contracts';
import { rosterUpsertSchema } from '../validation.js';
import { deploymentRoster, helpers } from '../db/schema.js';
import type { DeploymentRosterRow } from '../db/schema.js';
import { badRequest, forbidden, notFound, sendError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function rosterRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  // --- list roster (any auth user in the org) ----------------------------
  app.get(ROUTES.deploymentRoster, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const deploymentId = (req.params as { id: string }).id;
    if (!UUID_RE.test(deploymentId)) return sendError(reply, badRequest('invalid deployment id'));

    const rows = await db
      .select()
      .from(deploymentRoster)
      .where(
        and(
          eq(deploymentRoster.deploymentId, deploymentId),
          eq(deploymentRoster.orgId, session.orgId),
        ),
      );
    const result: RosterListResponse = { entries: rows.map(toRosterEntry) };
    return reply.send(result);
  });

  // --- upsert a roster entry (self, or admin/lead for others) -------------
  const upsert = async (req: FastifyRequest, reply: FastifyReply) => {
    const session = req.session!;
    const deploymentId = (req.params as { id: string }).id;
    if (!UUID_RE.test(deploymentId)) return sendError(reply, badRequest('invalid deployment id'));

    const parsed = rosterUpsertSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid roster upsert', parsed.error.issues));
    const body = parsed.data;

    // Default to acting on oneself; targeting another helper needs admin/lead.
    const targetKeyId = body.helperKeyId ?? session.keyId;
    const isSelf = targetKeyId === session.keyId;
    if (!isSelf && session.role !== 'admin' && session.role !== 'lead') {
      return sendError(reply, forbidden('only admin or lead may manage other helpers'));
    }

    // The target helper must belong to the caller's org. We snapshot the
    // display name + qualification from the account (operational metadata).
    const helperRows = await db
      .select()
      .from(helpers)
      .where(and(eq(helpers.keyId, targetKeyId), eq(helpers.orgId, session.orgId)))
      .limit(1);
    const helper = helperRows[0];
    if (!helper) return sendError(reply, notFound('helper not found in org'));

    const now = new Date();
    const existingRows = await db
      .select()
      .from(deploymentRoster)
      .where(
        and(
          eq(deploymentRoster.deploymentId, deploymentId),
          eq(deploymentRoster.helperKeyId, targetKeyId),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    // Resolve check-in/out stamps from the optional `action`.
    const checkedInAt = body.action === 'in' ? now : (existing?.checkedInAt ?? null);
    const checkedOutAt = body.action === 'out' ? now : (existing?.checkedOutAt ?? null);
    const roleAtEvent =
      body.roleAtEvent !== undefined ? body.roleAtEvent : (existing?.roleAtEvent ?? null);

    const values = {
      deploymentId,
      orgId: session.orgId,
      helperKeyId: targetKeyId,
      displayName: helper.displayName,
      qualification: (helper.qualification as string | null) ?? null,
      roleAtEvent,
      checkedInAt,
      checkedOutAt,
    };

    const upserted = await db
      .insert(deploymentRoster)
      .values(values)
      .onConflictDoUpdate({
        target: [deploymentRoster.deploymentId, deploymentRoster.helperKeyId],
        set: {
          displayName: values.displayName,
          qualification: values.qualification,
          roleAtEvent: values.roleAtEvent,
          checkedInAt: values.checkedInAt,
          checkedOutAt: values.checkedOutAt,
        },
      })
      .returning();
    return reply.send(toRosterEntry(upserted[0]!));
  };

  app.post(ROUTES.deploymentRoster, { preHandler: app.requireAuth }, upsert);
  app.put(ROUTES.deploymentRoster, { preHandler: app.requireAuth }, upsert);
}

function toRosterEntry(row: DeploymentRosterRow): RosterEntry {
  return {
    deploymentId: row.deploymentId,
    helperKeyId: row.helperKeyId,
    displayName: row.displayName,
    qualification: (row.qualification as Qualification | null) ?? null,
    roleAtEvent: row.roleAtEvent ?? null,
    checkedInAt: row.checkedInAt ? row.checkedInAt.toISOString() : null,
    checkedOutAt: row.checkedOutAt ? row.checkedOutAt.toISOString() : null,
  };
}
