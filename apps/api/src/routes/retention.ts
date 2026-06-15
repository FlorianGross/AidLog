/**
 * GDPR data protection — Löschkonzept (retention) + erasure via CRYPTO-SHREDDING.
 *
 *   GET  /api/org/retention        orgRetention (get)   (admin) → RetentionPolicy | null
 *   PUT  /api/org/retention        orgRetention (set)   (admin) → RetentionPolicy
 *   POST /api/org/retention/purge  orgRetentionPurge    (admin) → PurgeResponse
 *   GET  /api/org/deletion-log     deletionLog (list)   (admin) → DeletionLogResponse
 *
 * CRYPTO-SHREDDING — THE GUARANTEE:
 *   The server holds ONLY ciphertext + non-secret routing metadata; it has no
 *   decryption keys. To erase a record's personal data we DELETE its rows in
 *   `sealed_keys` (the per-record DEK wrappers). Once every wrapper of a
 *   record's DEK is gone, the DEK can never be reconstructed by anyone — not
 *   even with the org password — so the AEAD ciphertext in `records.payload`
 *   and the encrypted blobs become permanently undecryptable = erased.
 *
 *   The append-only `records` rows (hash-chain + Ed25519 signatures) are NEVER
 *   updated or deleted; only their keys are stripped. A DELETE against
 *   `records` would hit the 0001 trigger / least-privilege role and abort.
 *
 * ZERO-KNOWLEDGE: every response carries non-secret metadata only (counts, ids,
 * timestamps, the cutoff, the policy integer). Nothing decrypted is ever
 * exposed. Everything is constrained to req.session.orgId; cross-org is refused.
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  DeletionLogEntry,
  DeletionLogResponse,
  PurgeResponse,
  RetentionPolicy,
} from '@aidlog/contracts';
import { setRetentionSchema, purgeSchema } from '../validation.js';
import { retentionPolicies, deletionLog, records, sealedKeys } from '../db/schema.js';
import type { RetentionPolicyRow, DeletionLogRow } from '../db/schema.js';
import { badRequest, sendError } from '../errors.js';

const DELETION_LOG_LIMIT = 200;

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  const { db, blobs } = app.ctx;

  // --- GET retention policy (admin) --------------------------------------
  app.get(
    ROUTES.orgRetention,
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db
        .select()
        .from(retentionPolicies)
        .where(eq(retentionPolicies.orgId, session.orgId))
        .limit(1);
      const row = rows[0];
      // null (not 404) so the UI can render an explicit "not configured" state.
      return reply.send(row ? toRetentionPolicy(row) : null);
    },
  );

  // --- PUT retention policy (admin) — upsert -----------------------------
  app.put(
    ROUTES.orgRetention,
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const parsed = setRetentionSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid retention policy', parsed.error.issues));
      }
      const session = req.session!;
      const values = {
        orgId: session.orgId,
        retentionDays: parsed.data.retentionDays,
        updatedByKeyId: session.keyId,
        updatedAt: new Date(),
      };
      const upserted = await db
        .insert(retentionPolicies)
        .values(values)
        .onConflictDoUpdate({
          target: retentionPolicies.orgId,
          set: {
            retentionDays: values.retentionDays,
            updatedByKeyId: values.updatedByKeyId,
            updatedAt: values.updatedAt,
          },
        })
        .returning();
      return reply.send(toRetentionPolicy(upserted[0]!));
    },
  );

  // --- POST purge (admin) — crypto-shredding -----------------------------
  app.post(
    ROUTES.orgRetentionPurge,
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const parsed = purgeSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid purge request', parsed.error.issues));
      }
      const { scope, deploymentId, dryRun = false } = parsed.data;
      const session = req.session!;

      // Build the org-scoped predicate selecting the records to erase. Always
      // constrained to the caller's org; cross-org targets match nothing.
      let cutoffIso: string | undefined;
      let recordWhere;
      if (scope === 'policy') {
        const policy = await db
          .select()
          .from(retentionPolicies)
          .where(eq(retentionPolicies.orgId, session.orgId))
          .limit(1);
        const row = policy[0];
        if (!row) {
          return sendError(reply, badRequest('no retention policy configured for this org'));
        }
        const cutoff = new Date(Date.now() - row.retentionDays * 86_400_000);
        cutoffIso = cutoff.toISOString();
        recordWhere = and(eq(records.orgId, session.orgId), lt(records.receivedAt, cutoff));
      } else {
        // scope 'deployment' — deploymentId is non-secret metadata (validated
        // present by the zod refine). Erase all of that deployment's records.
        recordWhere = and(
          eq(records.orgId, session.orgId),
          eq(records.deploymentId, deploymentId!),
        );
      }

      // Read the affected records' ids/deployment ids/blob descriptors. We never
      // decrypt anything — `blobs` is an opaque descriptor list (ids + sizes).
      const affected = await db
        .select({
          id: records.id,
          deploymentId: records.deploymentId,
          blobs: records.blobs,
        })
        .from(records)
        .where(recordWhere);

      const recordIds = affected.map((r) => r.id);
      const deploymentsAffected = new Set(affected.map((r) => r.deploymentId)).size;

      // --- dry run: COUNT only, change nothing ---
      if (dryRun) {
        let sealedKeysDeleted = 0;
        for (const id of recordIds) {
          const cnt = await db
            .select({ recordId: sealedKeys.recordId })
            .from(sealedKeys)
            .where(eq(sealedKeys.recordId, id));
          sealedKeysDeleted += cnt.length;
        }
        const preview: PurgeResponse = {
          scope,
          dryRun: true,
          recordsAffected: recordIds.length,
          sealedKeysDeleted,
          deploymentsAffected,
          ...(cutoffIso ? { cutoff: cutoffIso } : {}),
        };
        return reply.send(preview);
      }

      // --- execute: crypto-shred in a transaction ---
      // DELETE the sealed_keys (the DEK wrappers) for the affected records, then
      // append ONE deletion_log row. We NEVER touch the `records` rows.
      let sealedKeysDeleted = 0;
      await db.transaction(async (tx) => {
        for (const id of recordIds) {
          const deleted = await tx
            .delete(sealedKeys)
            .where(eq(sealedKeys.recordId, id))
            .returning({ recordId: sealedKeys.recordId });
          sealedKeysDeleted += deleted.length;
        }
        await tx.insert(deletionLog).values({
          orgId: session.orgId,
          scope,
          deploymentId: scope === 'deployment' ? deploymentId! : null,
          recordsAffected: recordIds.length,
          sealedKeysDeleted,
          cutoff: cutoffIso ?? null,
          reason: null,
          executedByKeyId: session.keyId,
        });
      });

      // Best-effort: delete the corresponding S3/MinIO blob objects to reclaim
      // storage. This is OUTSIDE the critical path — the data is already
      // unrecoverable once the keys are gone — so it never fails the purge.
      // We log counts/ids only, never content, and never throw.
      void reclaimBlobs(affected, blobs, req.log);

      const result: PurgeResponse = {
        scope,
        dryRun: false,
        recordsAffected: recordIds.length,
        sealedKeysDeleted,
        deploymentsAffected,
        ...(cutoffIso ? { cutoff: cutoffIso } : {}),
      };
      return reply.send(result);
    },
  );

  // --- GET deletion log (admin) — newest first ---------------------------
  app.get(
    ROUTES.deletionLog,
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db
        .select()
        .from(deletionLog)
        .where(eq(deletionLog.orgId, session.orgId))
        .orderBy(desc(deletionLog.executedAt), desc(deletionLog.id))
        .limit(DELETION_LOG_LIMIT);
      const result: DeletionLogResponse = { entries: rows.map(toDeletionLogEntry) };
      return reply.send(result);
    },
  );
}

/** Opaque blob descriptor as stored in records.blobs (ids only matter here). */
interface StoredBlobRef {
  blobId?: string;
}

/**
 * Best-effort storage reclamation after crypto-shredding. Never throws: the
 * erasure guarantee comes from the deleted sealed_keys, not from removing the
 * ciphertext object. Logs only counts, never content.
 */
async function reclaimBlobs(
  affected: { id: string; blobs: unknown }[],
  blobs: { deleteObject: (blobId: string) => Promise<void> },
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<void> {
  let reclaimed = 0;
  let failed = 0;
  for (const rec of affected) {
    const refs = Array.isArray(rec.blobs) ? (rec.blobs as StoredBlobRef[]) : [];
    for (const ref of refs) {
      if (!ref || typeof ref.blobId !== 'string') continue;
      try {
        await blobs.deleteObject(ref.blobId);
        reclaimed++;
      } catch {
        failed++;
      }
    }
  }
  if (reclaimed > 0 || failed > 0) {
    log.warn({ reclaimed, failed }, 'crypto-shred blob reclamation');
  }
}

function toRetentionPolicy(row: RetentionPolicyRow): RetentionPolicy {
  const p: RetentionPolicy = {
    retentionDays: row.retentionDays,
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.updatedByKeyId) p.updatedByKeyId = row.updatedByKeyId;
  return p;
}

function toDeletionLogEntry(row: DeletionLogRow): DeletionLogEntry {
  const e: DeletionLogEntry = {
    id: row.id,
    scope: row.scope as DeletionLogEntry['scope'],
    recordsAffected: row.recordsAffected,
    sealedKeysDeleted: row.sealedKeysDeleted,
    executedByKeyId: row.executedByKeyId,
    executedAt: row.executedAt.toISOString(),
  };
  if (row.deploymentId) e.deploymentId = row.deploymentId;
  if (row.cutoff) e.cutoff = row.cutoff;
  if (row.reason) e.reason = row.reason;
  return e;
}
