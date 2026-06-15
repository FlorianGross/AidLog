/**
 * Material-/Verbrauchsmaterial-Verwaltung (inventory) routes.
 *
 *   GET    /api/org/material                       list catalog        (auth)
 *   POST   /api/org/material                       create item         (admin/lead)
 *   PUT    /api/org/material/:id                   update item         (admin/lead)
 *   DELETE /api/org/material/:id                   deactivate item     (admin/lead)
 *   GET    /api/deployments/:id/consumption        list consumption    (auth)
 *   POST   /api/deployments/:id/consumption        log consumption     (auth)
 *   DELETE /api/deployments/:id/consumption?entryId=<uuid>  delete + restore stock (admin/lead)
 *
 * PRIVACY: every row here is OPERATIONAL, NON-health LOGISTICS metadata — stock
 * levels, units, expiry, low-stock thresholds, and PER-DEPLOYMENT-AGGREGATE
 * consumption ("3× Mullbinde used in event X"). It is stored in clear and is
 * NEVER patient/health data, and consumption is NEVER linked to an individual
 * patient or a `records` row. NEVER write a patient/health value here. This is a
 * NORMAL inventory — NOT a Betäubungsmittel (BtM) / controlled-substance ledger.
 * Everything is scoped to the caller's `req.session.orgId`.
 *
 * AuthZ: any authenticated org member may READ the catalog and a deployment's
 * consumption, and may LOG consumption. Managing the catalog (create/update/
 * deactivate) and DELETING a consumption entry require role admin or lead.
 */
import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  ConsumptionEntry,
  ConsumptionListResponse,
  MaterialItem,
  MaterialListResponse,
} from '@aidlog/contracts';
import { upsertMaterialItemSchema, logConsumptionSchema } from '../validation.js';
import { materialItems, materialConsumption } from '../db/schema.js';
import type { MaterialItemRow, MaterialConsumptionRow } from '../db/schema.js';
import { badRequest, notFound, sendError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowToItem(row: MaterialItemRow): MaterialItem {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    category: row.category ?? null,
    unit: row.unit,
    stockQuantity: row.stockQuantity,
    minQuantity: row.minQuantity ?? null,
    expiresAt: row.expiresAt ?? null,
    location: row.location ?? null,
    active: row.active,
    updatedAt: row.updatedAt.toISOString(),
    updatedByKeyId: row.updatedByKeyId,
  };
}

function rowToConsumption(row: MaterialConsumptionRow): ConsumptionEntry {
  return {
    id: row.id,
    orgId: row.orgId,
    deploymentId: row.deploymentId,
    itemId: row.itemId,
    itemName: row.itemName,
    quantity: row.quantity,
    note: row.note ?? null,
    recordedByKeyId: row.recordedByKeyId,
    recordedAt: row.recordedAt.toISOString(),
  };
}

export async function materialRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app.ctx;

  // --- GET the catalog (any authenticated member of the org) ---------------
  app.get(ROUTES.orgMaterial, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const rows = await db
      .select()
      .from(materialItems)
      .where(eq(materialItems.orgId, session.orgId))
      .orderBy(asc(materialItems.name));
    const result: MaterialListResponse = { items: rows.map(rowToItem) };
    return reply.send(result);
  });

  // --- POST create a catalog item (admin/lead) -----------------------------
  app.post(
    ROUTES.orgMaterial,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const parsed = upsertMaterialItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid material item', parsed.error.issues));
      }
      const body = parsed.data;
      const session = req.session!;

      const inserted = await db
        .insert(materialItems)
        .values({
          orgId: session.orgId,
          name: body.name,
          category: body.category ?? null,
          unit: body.unit,
          stockQuantity: body.stockQuantity,
          minQuantity: body.minQuantity ?? null,
          expiresAt: body.expiresAt ?? null,
          location: body.location ?? null,
          active: body.active ?? true,
          updatedAt: new Date(),
          updatedByKeyId: session.keyId,
        })
        .returning();
      return reply.send(rowToItem(inserted[0]!));
    },
  );

  // --- PUT update a catalog item (admin/lead) ------------------------------
  app.put(
    ROUTES.orgMaterialItem,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      if (!UUID_RE.test(id)) return sendError(reply, badRequest('invalid item id'));

      const parsed = upsertMaterialItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid material item', parsed.error.issues));
      }
      const body = parsed.data;
      const session = req.session!;

      // Scope by org so one org can never touch another's item.
      const existing = await db
        .select()
        .from(materialItems)
        .where(and(eq(materialItems.id, id), eq(materialItems.orgId, session.orgId)))
        .limit(1);
      const current = existing[0];
      if (!current) return sendError(reply, notFound('material item not found'));

      const updated = await db
        .update(materialItems)
        .set({
          name: body.name,
          category: body.category ?? null,
          unit: body.unit,
          stockQuantity: body.stockQuantity,
          minQuantity: body.minQuantity ?? null,
          expiresAt: body.expiresAt ?? null,
          location: body.location ?? null,
          active: body.active ?? current.active,
          updatedAt: new Date(),
          updatedByKeyId: session.keyId,
        })
        .where(and(eq(materialItems.id, id), eq(materialItems.orgId, session.orgId)))
        .returning();
      return reply.send(rowToItem(updated[0]!));
    },
  );

  // --- DELETE a catalog item (admin/lead) ----------------------------------
  // Hard-delete when the item has NO consumption history; otherwise SOFT-delete
  // (active = false) so the aggregate consumption log stays referentially intact
  // (the FK is ON DELETE RESTRICT).
  app.delete(
    ROUTES.orgMaterialItem,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      if (!UUID_RE.test(id)) return sendError(reply, badRequest('invalid item id'));
      const session = req.session!;

      const existing = await db
        .select()
        .from(materialItems)
        .where(and(eq(materialItems.id, id), eq(materialItems.orgId, session.orgId)))
        .limit(1);
      const current = existing[0];
      if (!current) return sendError(reply, notFound('material item not found'));

      const refs = await db
        .select({ id: materialConsumption.id })
        .from(materialConsumption)
        .where(eq(materialConsumption.itemId, id))
        .limit(1);

      if (refs.length === 0) {
        await db
          .delete(materialItems)
          .where(and(eq(materialItems.id, id), eq(materialItems.orgId, session.orgId)));
        return reply.send({ ok: true, deleted: true });
      }

      // Has history → soft-delete only.
      const updated = await db
        .update(materialItems)
        .set({ active: false, updatedAt: new Date(), updatedByKeyId: session.keyId })
        .where(and(eq(materialItems.id, id), eq(materialItems.orgId, session.orgId)))
        .returning();
      return reply.send({ ok: true, deleted: false, item: rowToItem(updated[0]!) });
    },
  );

  // --- GET consumption for a deployment (any authenticated member) ---------
  app.get(ROUTES.deploymentConsumption, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const deploymentId = (req.params as { id: string }).id;
    if (!UUID_RE.test(deploymentId)) return sendError(reply, badRequest('invalid deployment id'));

    const rows = await db
      .select()
      .from(materialConsumption)
      .where(
        and(
          eq(materialConsumption.deploymentId, deploymentId),
          eq(materialConsumption.orgId, session.orgId),
        ),
      )
      .orderBy(desc(materialConsumption.recordedAt));
    const result: ConsumptionListResponse = { entries: rows.map(rowToConsumption) };
    return reply.send(result);
  });

  // --- POST log consumption (any authenticated member) ---------------------
  // Decrements the item's stock TRANSACTIONALLY, clamped at 0 (never negative).
  app.post(ROUTES.deploymentConsumption, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const deploymentId = (req.params as { id: string }).id;
    if (!UUID_RE.test(deploymentId)) return sendError(reply, badRequest('invalid deployment id'));

    const parsed = logConsumptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, badRequest('invalid consumption', parsed.error.issues));
    }
    const body = parsed.data;

    const entry = await db.transaction(async (tx) => {
      // Validate the item belongs to the caller's org (prevents cross-org logging).
      const itemRows = await tx
        .select()
        .from(materialItems)
        .where(and(eq(materialItems.id, body.itemId), eq(materialItems.orgId, session.orgId)))
        .limit(1);
      const item = itemRows[0];
      if (!item) return null;

      // Clamp the decrement at 0 — stock never goes negative.
      await tx
        .update(materialItems)
        .set({
          stockQuantity: sql`GREATEST(${materialItems.stockQuantity} - ${body.quantity}, 0)`,
          updatedAt: new Date(),
          updatedByKeyId: session.keyId,
        })
        .where(eq(materialItems.id, item.id));

      const inserted = await tx
        .insert(materialConsumption)
        .values({
          orgId: session.orgId,
          deploymentId,
          itemId: item.id,
          itemName: item.name,
          quantity: body.quantity,
          note: body.note ?? null,
          recordedByKeyId: session.keyId,
          recordedAt: new Date(),
        })
        .returning();
      return inserted[0]!;
    });

    if (!entry) return sendError(reply, notFound('material item not found in org'));
    return reply.send(rowToConsumption(entry));
  });

  // --- DELETE a consumption entry (admin/lead) -----------------------------
  // Restores the previously-decremented stock to the item (if it still exists).
  app.delete(
    ROUTES.deploymentConsumption,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const session = req.session!;
      const deploymentId = (req.params as { id: string }).id;
      if (!UUID_RE.test(deploymentId)) return sendError(reply, badRequest('invalid deployment id'));
      const q = req.query as { entryId?: string };
      const entryId = typeof q.entryId === 'string' ? q.entryId : undefined;
      if (!entryId || !UUID_RE.test(entryId)) {
        return sendError(reply, badRequest('entryId query parameter (uuid) is required'));
      }

      const result = await db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(materialConsumption)
          .where(
            and(
              eq(materialConsumption.id, entryId),
              eq(materialConsumption.deploymentId, deploymentId),
              eq(materialConsumption.orgId, session.orgId),
            ),
          )
          .limit(1);
        const entry = rows[0];
        if (!entry) return 'not_found' as const;

        // Restore stock to the item if it still exists in the org.
        await tx
          .update(materialItems)
          .set({
            stockQuantity: sql`${materialItems.stockQuantity} + ${entry.quantity}`,
            updatedAt: new Date(),
            updatedByKeyId: session.keyId,
          })
          .where(and(eq(materialItems.id, entry.itemId), eq(materialItems.orgId, session.orgId)));

        await tx.delete(materialConsumption).where(eq(materialConsumption.id, entryId));
        return 'ok' as const;
      });

      if (result === 'not_found') return sendError(reply, notFound('consumption entry not found'));
      return reply.send({ ok: true });
    },
  );
}
