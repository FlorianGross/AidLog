/**
 * The org's CONFIGURABLE PROTOCOL SCHEMA (in-app schema editor).
 *
 *   GET  /api/org/schema   orgSchema (get)   (auth)  → OrgSchemaDocument | null
 *   PUT  /api/org/schema   orgSchema (set)   (admin)  → OrgSchemaDocument
 *
 * `schema` is the DocSchema (sections/fields) the web client renders the
 * documentation form from. It is FIELD DEFINITIONS / org configuration — the
 * SHAPE of the form, NOT patient data — so it is stored in clear (no ciphertext,
 * no DEK, no secret). Patient values stay encrypted in the append-only `records`
 * table and are never touched here.
 *
 * Writes are admin-only (server-enforced via requireAdmin, in addition to the
 * client guard). Each save upserts the single per-org row and bumps `version`
 * to (previous + 1). The server validates SHAPE only (non-empty `sections`
 * array + a `schemaId` string) and stays tolerant of new field props.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type { OrgSchemaDocument } from '@aidlog/contracts';
import { setOrgSchemaSchema } from '../validation.js';
import { orgSchema } from '../db/schema.js';
import type { OrgSchemaRow } from '../db/schema.js';
import { badRequest, sendError } from '../errors.js';

function rowToDocument(row: OrgSchemaRow): OrgSchemaDocument {
  return {
    orgId: row.orgId,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedByKeyId: row.updatedByKeyId,
    schema: row.schema,
  };
}

export async function orgSchemaRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  // --- GET the org's active schema (any authenticated member) -------------
  app.get(ROUTES.orgSchema, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const rows = await db
      .select()
      .from(orgSchema)
      .where(eq(orgSchema.orgId, session.orgId))
      .limit(1);
    const row = rows[0];
    // null (not 404) when the org has never customised its schema (the client
    // then falls back to the built-in ABCDE default).
    return reply.send(row ? rowToDocument(row) : null);
  });

  // --- PUT a new active schema (admin only) -------------------------------
  app.put(
    ROUTES.orgSchema,
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const parsed = setOrgSchemaSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid schema', parsed.error.issues));
      }
      const session = req.session!;
      const now = new Date();

      // Determine the next version from the current row (version + 1), starting at 1.
      const existing = await db
        .select({ version: orgSchema.version })
        .from(orgSchema)
        .where(eq(orgSchema.orgId, session.orgId))
        .limit(1);
      const nextVersion = (existing[0]?.version ?? 0) + 1;

      const upserted = await db
        .insert(orgSchema)
        .values({
          orgId: session.orgId,
          version: nextVersion,
          updatedAt: now,
          updatedByKeyId: session.keyId,
          schema: parsed.data.schema,
        })
        .onConflictDoUpdate({
          target: orgSchema.orgId,
          set: {
            version: nextVersion,
            updatedAt: now,
            updatedByKeyId: session.keyId,
            schema: parsed.data.schema,
          },
        })
        .returning();

      return reply.send(rowToDocument(upserted[0]!));
    },
  );
}
