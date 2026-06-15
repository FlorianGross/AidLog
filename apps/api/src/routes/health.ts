/**
 * Readiness (dependency health) route.
 *
 *   GET /api/health/ready
 *
 * Liveness (`/api/health`) lives in app.ts and answers "is the process up?".
 * Readiness answers "can the process actually serve requests?" by probing its
 * hard dependencies: Postgres and the S3/MinIO object store.
 *
 * ZERO-KNOWLEDGE / SECURITY: this endpoint is intentionally UNAUTHENTICATED so
 * Docker/monitoring can poll it. It therefore exposes NOTHING sensitive — only
 * per-dependency up/down booleans and a timestamp. It never throws: each probe
 * is caught independently so one dead dependency can't mask the others or leak
 * an error/stack. No patient data, secrets, DEKs, or config values are returned.
 */
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { HeadBucketCommand } from '@aws-sdk/client-s3';

// Hardcoded (NOT in @aidlog/contracts ROUTES): the web client never calls this;
// only infra/monitoring does.
const READINESS_PATH = '/api/health/ready';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const { db, blobs } = app.ctx;

  app.get(READINESS_PATH, async (_req, reply) => {
    // --- Postgres: trivial round-trip. -----------------------------------
    let dbUp = false;
    try {
      await db.execute(sql`select 1`);
      dbUp = true;
    } catch {
      dbUp = false;
    }

    // --- S3 / MinIO: lightweight bucket reachability check. ---------------
    // HeadBucket on the already-configured client/bucket; no new config, no
    // object reads. A failure (network/bucket missing/credentials) -> false.
    let storageUp = false;
    try {
      await blobs.client.send(new HeadBucketCommand({ Bucket: blobs.bucket }));
      storageUp = true;
    } catch {
      storageUp = false;
    }

    const time = new Date().toISOString();
    if (dbUp && storageUp) {
      return reply.code(200).send({ status: 'ready', db: true, storage: true, time });
    }
    return reply.code(503).send({ status: 'degraded', db: dbUp, storage: storageUp, time });
  });
}
