/**
 * "Meine Einsätze":  GET /api/my/deployments
 *
 * Lists the deployments the CALLER authored — across devices — as NON-secret
 * routing metadata only. We GROUP the caller's own records (author_key_id ==
 * session.keyId, scoped to their org) by deploymentId and return, per group, the
 * deployment id, how many records the caller authored, and the first/last client
 * `created_at`.
 *
 * ZERO-KNOWLEDGE: the server returns NO ciphertext, NO titles, NO categories — it
 * cannot know those (they live inside the encrypted payload, and the human-
 * readable title lives only in the client-local DeploymentMeta, never synced).
 * The web client recovers a display label by DECRYPTING the synced records with
 * the viewer's OWN identity (now possible because every record is sealed to its
 * author via the persistent 'author' wrapper — see migration 0013).
 *
 * Org-scoped: only the caller's own records in their own org are considered.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type { MyDeploymentsResponse, MyDeploymentSummary } from '@aidlog/contracts';
import { records } from '../db/schema.js';

export async function myRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  app.get(ROUTES.myDeployments, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;

    // GROUP BY deploymentId over the caller's OWN authored records in their org.
    // created_at is a non-secret client timestamp (text); min/max bound the span.
    const rows = await db
      .select({
        deploymentId: records.deploymentId,
        recordCount: sql<number>`count(*)::int`,
        firstCreatedAt: sql<string>`min(${records.createdAt})`,
        lastCreatedAt: sql<string>`max(${records.createdAt})`,
      })
      .from(records)
      .where(and(eq(records.orgId, session.orgId), eq(records.authorKeyId, session.keyId)))
      .groupBy(records.deploymentId);

    const deployments: MyDeploymentSummary[] = rows
      .map((r) => ({
        deploymentId: r.deploymentId,
        recordCount: r.recordCount,
        firstCreatedAt: r.firstCreatedAt,
        lastCreatedAt: r.lastCreatedAt,
      }))
      // Newest activity first. createdAt is ISO 8601, so lexical = chronological.
      .sort((a, b) => b.lastCreatedAt.localeCompare(a.lastCreatedAt));

    const response: MyDeploymentsResponse = { deployments };
    return reply.send(response);
  });
}
