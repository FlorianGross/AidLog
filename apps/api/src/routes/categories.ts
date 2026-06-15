/**
 * PROTOCOL CATEGORIES (Sanitätsdienst / HvO / EGB …).
 *
 *   GET    /api/org/categories            categories (list)   (auth)  → CategoryListResponse
 *   POST   /api/org/categories            categories (upsert) (admin) → ProtocolCategory
 *   DELETE /api/org/categories?id=<uuid>  categories (delete) (admin) → ProtocolCategory
 *
 * An admin defines categories, each with its OWN protocol schema (a DocSchema as
 * opaque JSON, exactly like `org_schema.schema`) and a `createPermission`
 * deciding who may create a deployment under it. These are FIELD DEFINITIONS /
 * org configuration — the SHAPE of the form, NOT patient data — so they are
 * stored in clear (no ciphertext, no DEK, no secret). The append-only `records`
 * table is never touched here.
 *
 * LAZY SEED: the first GET for an org with ZERO categories creates a default
 * "Sanitätsdienst" category (createPermission 'all', deploymentLabel
 * 'Veranstaltung', schema = the org's existing org_schema.schema if present else
 * NULL — the client then falls back to its built-in ABCDE default). This is
 * idempotent, so existing orgs get a default on first read with no data migration.
 *
 * Writes are admin-only (server-enforced). On update we bump `version` and set
 * updated_at/by. DELETE is a SOFT delete (active = false, version bumped) — a
 * category is NEVER hard-deleted because old deployments may reference it — and
 * is refused for the LAST active category (an org must keep >= 1).
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  CategoryCreatePermission,
  CategoryListResponse,
  ProtocolCategory,
} from '@aidlog/contracts';
import { upsertCategorySchema } from '../validation.js';
import { categories, orgSchema } from '../db/schema.js';
import type { CategoryRow } from '../db/schema.js';
import { writeAudit } from '../audit.js';
import { badRequest, conflict, notFound, sendError } from '../errors.js';

function rowToCategory(row: CategoryRow): ProtocolCategory {
  const cat: ProtocolCategory = {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    createPermission: row.createPermission as CategoryCreatePermission,
    schema: row.schema ?? null,
    sortOrder: row.sortOrder,
    active: row.active,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
    updatedByKeyId: row.updatedByKeyId,
  };
  if (row.description !== null) cat.description = row.description;
  if (row.deploymentLabel !== null) cat.deploymentLabel = row.deploymentLabel;
  if (row.color !== null) cat.color = row.color;
  if (row.icon !== null) cat.icon = row.icon;
  return cat;
}

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  // --- GET the caller-org's ACTIVE categories (any authenticated member) ---
  app.get(ROUTES.orgCategories, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;

    // Lazy seed: if the org has ZERO categories (active OR inactive), create a
    // default "Sanitätsdienst" first. Idempotent — we only seed when none exist.
    const any = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.orgId, session.orgId))
      .limit(1);
    if (any.length === 0) {
      // Carry the org's existing single schema forward if it has one, else NULL
      // (the client then renders its built-in ABCDE default).
      const existingSchema = await db
        .select({ schema: orgSchema.schema })
        .from(orgSchema)
        .where(eq(orgSchema.orgId, session.orgId))
        .limit(1);
      await db
        .insert(categories)
        .values({
          orgId: session.orgId,
          name: 'Sanitätsdienst',
          deploymentLabel: 'Veranstaltung',
          createPermission: 'all',
          schema: existingSchema[0]?.schema ?? null,
          sortOrder: 0,
          updatedByKeyId: session.keyId,
        })
        // Tolerate a concurrent seed from a parallel GET: if another request
        // inserted first we simply read the result below.
        .onConflictDoNothing();
    }

    const rows = await db
      .select()
      .from(categories)
      .where(and(eq(categories.orgId, session.orgId), eq(categories.active, true)))
      .orderBy(asc(categories.sortOrder));
    const result: CategoryListResponse = { categories: rows.map(rowToCategory) };
    return reply.send(result);
  });

  // --- POST upsert a category (admin only) --------------------------------
  app.post(
    ROUTES.orgCategories,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const parsed = upsertCategorySchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid category', parsed.error.issues));
      }
      const body = parsed.data;
      const session = req.session!;
      const now = new Date();

      let saved: CategoryRow;
      if (body.id === undefined) {
        // CREATE.
        const inserted = await db
          .insert(categories)
          .values({
            orgId: session.orgId,
            name: body.name,
            description: body.description ?? null,
            deploymentLabel: body.deploymentLabel ?? null,
            createPermission: body.createPermission,
            schema: body.schema ?? null,
            sortOrder: body.sortOrder ?? 0,
            color: body.color ?? null,
            icon: body.icon ?? null,
            active: body.active ?? true,
            updatedAt: now,
            updatedByKeyId: session.keyId,
          })
          .returning();
        saved = inserted[0]!;
      } else {
        // UPDATE: scope by org so one org can never touch another's category.
        // Bump version; set only the provided fields.
        const existing = await db
          .select()
          .from(categories)
          .where(and(eq(categories.id, body.id), eq(categories.orgId, session.orgId)))
          .limit(1);
        const current = existing[0];
        if (!current) return sendError(reply, notFound('category not found'));

        const updated = await db
          .update(categories)
          .set({
            name: body.name,
            description: body.description ?? null,
            deploymentLabel: body.deploymentLabel ?? null,
            createPermission: body.createPermission,
            ...(body.schema !== undefined ? { schema: body.schema } : {}),
            sortOrder: body.sortOrder ?? current.sortOrder,
            color: body.color ?? null,
            icon: body.icon ?? null,
            active: body.active ?? current.active,
            version: current.version + 1,
            updatedAt: now,
            updatedByKeyId: session.keyId,
          })
          .where(and(eq(categories.id, body.id), eq(categories.orgId, session.orgId)))
          .returning();
        saved = updated[0]!;
      }

      await writeAudit(
        db,
        {
          orgId: session.orgId,
          actorKeyId: session.keyId,
          action: 'category.updated',
          detail: `${body.id === undefined ? 'create' : 'update'} ${saved.name}`,
        },
        req.log,
      );

      return reply.send(rowToCategory(saved));
    },
  );

  // --- DELETE (soft) a category (admin only) ------------------------------
  // Never hard-deletes (old deployments may reference it): sets active = false
  // and bumps version. Refuses to deactivate the LAST active category.
  app.delete(
    ROUTES.orgCategories,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const q = req.query as { id?: string };
      const id = typeof q.id === 'string' ? q.id : undefined;
      if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
        return sendError(reply, badRequest('id query parameter (uuid) is required'));
      }
      const session = req.session!;

      const existing = await db
        .select()
        .from(categories)
        .where(and(eq(categories.id, id), eq(categories.orgId, session.orgId)))
        .limit(1);
      const current = existing[0];
      if (!current) return sendError(reply, notFound('category not found'));

      if (current.active) {
        // Last-active-category guard: an org must keep >= 1 active category.
        const actives = await db
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.orgId, session.orgId), eq(categories.active, true)));
        if (actives.length <= 1) {
          return sendError(reply, conflict('cannot deactivate the last remaining category'));
        }
      }

      const updated = await db
        .update(categories)
        .set({
          active: false,
          version: current.version + 1,
          updatedAt: new Date(),
          updatedByKeyId: session.keyId,
        })
        .where(and(eq(categories.id, id), eq(categories.orgId, session.orgId)))
        .returning();

      await writeAudit(
        db,
        {
          orgId: session.orgId,
          actorKeyId: session.keyId,
          action: 'category.updated',
          detail: `deactivate ${current.name}`,
        },
        req.log,
      );

      return reply.send(rowToCategory(updated[0]!));
    },
  );
}
