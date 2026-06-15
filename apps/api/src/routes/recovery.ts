/**
 * Organisation-key RECOVERY metadata (Shamir) and the administrative AUDIT log.
 *
 *   GET  /api/org/recovery   orgRecovery (get)   (admin|lead) → RecoveryConfig | null
 *   POST /api/org/recovery   orgRecovery (set)   (admin)      → RecoveryConfig
 *   GET  /api/audit          audit (list)        (admin)      → AuditListResponse
 *
 * SECURITY-CRITICAL — METADATA ONLY:
 *   The org secret key is split into N Shamir shares with threshold T entirely
 *   on the CLIENT (see @aidlog/crypto-core splitSecret/encodeShare). The shares
 *   are exported to human trustees and are NEVER sent to the server. This route
 *   stores ONLY non-secret policy metadata: threshold, share count, trustee
 *   LABELS (server-assigned ids), an optional public-key check value, and who
 *   configured it. No share, secret key, or password is ever read from the
 *   request body (the zod schema is `.strict()`, rejecting extra fields) or
 *   written to the database.
 */
import { randomUUID } from 'node:crypto'; // crypto-lint-allow: random non-secret trustee ids (routing metadata; not key material, never a share)
import type { FastifyInstance } from 'fastify';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  AuditEntry,
  AuditListResponse,
  RecoveryConfig,
  RecoveryTrustee,
} from '@aidlog/contracts';
import { setRecoveryConfigSchema } from '../validation.js';
import { recoveryConfig, auditLog } from '../db/schema.js';
import type { RecoveryConfigRow, AuditLogRow } from '../db/schema.js';
import { writeAudit } from '../audit.js';
import { badRequest, sendError } from '../errors.js';

const AUDIT_PAGE_DEFAULT = 100;
const AUDIT_PAGE_MAX = 500;

export async function recoveryRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  // --- GET recovery config (admin | lead) --------------------------------
  app.get(
    ROUTES.orgRecovery,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db
        .select()
        .from(recoveryConfig)
        .where(eq(recoveryConfig.orgId, session.orgId))
        .limit(1);
      const row = rows[0];
      // null (not 404) when recovery has not been configured for this org.
      return reply.send(row ? toRecoveryConfig(row) : null);
    },
  );

  // --- POST recovery config (admin only) ---------------------------------
  app.post(
    ROUTES.orgRecovery,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const parsed = setRecoveryConfigSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid recovery config', parsed.error.issues));
      }
      const body = parsed.data;
      const session = req.session!;

      // Server assigns a stable id to each trustee (one per issued share). We
      // store LABELS ONLY — never any share material.
      const trustees: RecoveryTrustee[] = body.trustees.map((t) => ({
        id: randomUUID(),
        label: t.label,
      }));

      const values = {
        orgId: session.orgId,
        threshold: body.threshold,
        shareCount: body.shareCount,
        trustees,
        createdByKeyId: session.keyId,
        orgKeyCheck: body.orgKeyCheck ?? null,
        createdAt: new Date(),
      };

      // Upsert: re-configuring recovery replaces the prior policy in place.
      const upserted = await db
        .insert(recoveryConfig)
        .values(values)
        .onConflictDoUpdate({
          target: recoveryConfig.orgId,
          set: {
            threshold: values.threshold,
            shareCount: values.shareCount,
            trustees: values.trustees,
            createdByKeyId: values.createdByKeyId,
            orgKeyCheck: values.orgKeyCheck,
            createdAt: values.createdAt,
          },
        })
        .returning();
      const row = upserted[0]!;

      await writeAudit(
        db,
        {
          orgId: session.orgId,
          actorKeyId: session.keyId,
          action: 'recovery.configured',
          detail: `${body.threshold}-of-${body.shareCount}`,
        },
        req.log,
      );

      return reply.code(201).send(toRecoveryConfig(row));
    },
  );

  // --- GET audit log (admin only) ----------------------------------------
  app.get(
    ROUTES.audit,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const session = req.session!;
      const q = req.query as { limit?: string; before?: string };

      let limit = AUDIT_PAGE_DEFAULT;
      if (q.limit !== undefined) {
        const n = Number(q.limit);
        if (Number.isInteger(n) && n > 0) limit = Math.min(n, AUDIT_PAGE_MAX);
      }

      // Cursor: opaque "<at-iso>|<id>" of the last seen entry, for stable
      // keyset pagination over the (at DESC, id DESC) ordering.
      let where = eq(auditLog.orgId, session.orgId);
      if (typeof q.before === 'string' && q.before.includes('|')) {
        const bar = q.before.lastIndexOf('|');
        const atStr = q.before.slice(0, bar);
        const idStr = q.before.slice(bar + 1);
        const at = new Date(atStr);
        if (!Number.isNaN(at.getTime()) && idStr) {
          where = and(
            where,
            or(lt(auditLog.at, at), and(eq(auditLog.at, at), lt(auditLog.id, idStr))),
          )!;
        }
      }

      const rows = await db
        .select()
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.at), desc(auditLog.id))
        .limit(limit);

      const result: AuditListResponse = { entries: rows.map(toAuditEntry) };
      return reply.send(result);
    },
  );
}

function toRecoveryConfig(row: RecoveryConfigRow): RecoveryConfig {
  const cfg: RecoveryConfig = {
    orgId: row.orgId,
    threshold: row.threshold,
    shareCount: row.shareCount,
    trustees: row.trustees as RecoveryTrustee[],
    createdAt: row.createdAt.toISOString(),
    createdByKeyId: row.createdByKeyId,
  };
  if (row.orgKeyCheck) cfg.orgKeyCheck = row.orgKeyCheck;
  return cfg;
}

function toAuditEntry(row: AuditLogRow): AuditEntry {
  const e: AuditEntry = {
    id: row.id,
    orgId: row.orgId,
    actorKeyId: row.actorKeyId,
    action: row.action as AuditEntry['action'],
    at: row.at.toISOString(),
  };
  if (row.targetKeyId) e.targetKeyId = row.targetKeyId;
  if (row.detail) e.detail = row.detail;
  return e;
}
