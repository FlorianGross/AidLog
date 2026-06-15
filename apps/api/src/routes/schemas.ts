/**
 * Schema CRUD:  /api/schemas
 *   GET    /api/schemas            list schema definitions for the caller's org
 *   GET    /api/schemas/:schemaId  list versions of one schema
 *   POST   /api/schemas            create a new schema version (org-admin only)
 *
 * SchemaDefinitions are PUBLIC form definitions (JSON Schema). They are not
 * secret, but writes are restricted to org-admin (proof-of-possession of the
 * org signing key). Schemas are versioned and append-only at the (schemaId,
 * version) granularity — re-posting an existing version is a conflict.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq, asc } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type { SchemaDefinition } from '@aidlog/contracts';
import { schemaDefinitionSchema } from '../validation.js';
import { schemas } from '../db/schema.js';
import { badRequest, conflict, sendError } from '../errors.js';

function rowToDefinition(r: typeof schemas.$inferSelect): SchemaDefinition {
  const def: SchemaDefinition = {
    schemaId: r.schemaId,
    version: r.version,
    title: r.title,
    jsonSchema: r.jsonSchema as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
  };
  if (r.description !== null) def.description = r.description;
  if (r.uiSchema !== null) def.uiSchema = r.uiSchema as Record<string, unknown>;
  if (r.signature !== null) def.signature = r.signature;
  if (r.authorKeyId !== null) def.authorKeyId = r.authorKeyId;
  return def;
}

export async function schemaRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  // --- list all schemas for the org --------------------------------------
  app.get(ROUTES.schemas, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const rows = await db
      .select()
      .from(schemas)
      .where(eq(schemas.orgId, session.orgId))
      .orderBy(asc(schemas.schemaId), asc(schemas.version));
    return reply.send(rows.map(rowToDefinition));
  });

  // --- list versions of one schema ---------------------------------------
  app.get<{ Params: { schemaId: string } }>(
    `${ROUTES.schemas}/:schemaId`,
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db
        .select()
        .from(schemas)
        .where(and(eq(schemas.orgId, session.orgId), eq(schemas.schemaId, req.params.schemaId)))
        .orderBy(asc(schemas.version));
      return reply.send(rows.map(rowToDefinition));
    },
  );

  // --- create a new schema version (org-admin only) ----------------------
  app.post(
    ROUTES.schemas,
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const parsed = schemaDefinitionSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(reply, badRequest('invalid schema', parsed.error.issues));
      const body = parsed.data;
      const session = req.session!;

      try {
        const inserted = await db
          .insert(schemas)
          .values({
            schemaId: body.schemaId,
            version: body.version,
            orgId: session.orgId,
            title: body.title,
            description: body.description ?? null,
            jsonSchema: body.jsonSchema,
            uiSchema: body.uiSchema ?? null,
            signature: body.signature ?? null,
            authorKeyId: body.authorKeyId ?? session.keyId,
          })
          .returning();
        return reply.code(201).send(rowToDefinition(inserted[0]!));
      } catch (err) {
        if (isUniqueViolation(err)) {
          return sendError(reply, conflict('schema version already exists'));
        }
        throw err;
      }
    },
  );
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
