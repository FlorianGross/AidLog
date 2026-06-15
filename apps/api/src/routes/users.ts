/**
 * Org identity, user management & the admin-only invitation flow.
 *
 *   GET  /api/org                 orgInfo          (auth)        → OrgPublicInfo
 *   GET  /api/users               users (list)     (admin|lead)  → UserListResponse
 *   PATCH /api/users              users (update)   (admin)       → UserAccount
 *   POST /api/invitations         create invite    (admin)       → CreateInvitationResponse
 *   GET  /api/invitations         list invites     (admin)       → { invitations }
 *   POST /api/invitations/redeem  redeem invite    (PUBLIC)      → RedeemInvitationResponse
 *
 * BLIND invariants: invitation codes are stored ONLY as a keyed hash; the code
 * is returned to the admin exactly once. Accounts hold only a public identity +
 * an opaque password-wrapped secret. Roles are enforced via requireRole.
 */
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type {
  CreateInvitationResponse,
  Invitation,
  InvitationStatus,
  OrgKeyset,
  OrgPublicInfo,
  OwnAccountResponse,
  PublicIdentity,
  Qualification,
  RedeemInvitationResponse,
  Role,
  UserAccount,
  UserListResponse,
  WrappedSecretKey,
} from '@aidlog/contracts';
import {
  createInvitationSchema,
  redeemInvitationSchema,
  setQualificationSchema,
  updateOrgKeysetSchema,
  updateUserSchema,
} from '../validation.js';
import { orgs, helpers, invitations } from '../db/schema.js';
import type { HelperRow, OrgRow } from '../db/schema.js';
import { generateInvitationCode, hashInvitationCode } from '../invite.js';
import { writeAudit } from '../audit.js';
import { badRequest, conflict, notFound, sendError } from '../errors.js';

const DEFAULT_INVITE_TTL_HOURS = 72;
const MAX_INVITE_TTL_HOURS = 24 * 30;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;

  // --- orgInfo ------------------------------------------------------------
  app.get(ROUTES.orgInfo, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const rows = await db.select().from(orgs).where(eq(orgs.orgId, session.orgId)).limit(1);
    const org = rows[0];
    if (!org) return sendError(reply, notFound('org not found'));
    return reply.send(toOrgPublicInfo(org));
  });

  // --- org keyset (admin) — needed to configure/perform Shamir recovery ---
  // GET returns the org's password-wrapped secret (ciphertext only; useless
  // without the org password). PUT replaces it after a recovery re-wrap. The
  // server never sees the org secret in clear.
  app.get(
    ROUTES.orgKeyset,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db.select().from(orgs).where(eq(orgs.orgId, session.orgId)).limit(1);
      const org = rows[0];
      if (!org) return sendError(reply, notFound('org not found'));
      return reply.send(toOrgKeyset(org));
    },
  );

  app.put(
    ROUTES.orgKeyset,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const session = req.session!;
      const parsed = updateOrgKeysetSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid keyset', parsed.error.issues));
      }
      const updated = await db
        .update(orgs)
        .set({
          wrappedSecret: parsed.data.wrappedSecret,
          ...(parsed.data.recoveryWrappers !== undefined
            ? { recoveryWrappers: parsed.data.recoveryWrappers }
            : {}),
        })
        .where(eq(orgs.orgId, session.orgId))
        .returning();
      const org = updated[0];
      if (!org) return sendError(reply, notFound('org not found'));
      await writeAudit(
        db,
        {
          orgId: session.orgId,
          actorKeyId: session.keyId,
          action: 'recovery.configured',
          detail: 'org key re-wrapped (recovery)',
        },
        req.log,
      );
      return reply.send(toOrgKeyset(org));
    },
  );

  // --- own account (any authenticated user) ------------------------------
  // Lets a helper learn their OWN role + qualification (for client-side section
  // gating) without the admin-only user list. Non-secret routing metadata only.
  app.get(ROUTES.account, { preHandler: app.requireAuth }, async (req, reply) => {
    const session = req.session!;
    const rows = await db
      .select()
      .from(helpers)
      .where(and(eq(helpers.keyId, session.keyId), eq(helpers.orgId, session.orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) return sendError(reply, notFound('account not found'));
    const result: OwnAccountResponse = {
      helperId: row.helperId,
      orgId: row.orgId,
      displayName: row.displayName,
      role: row.role as Role,
      qualification: (row.qualification as Qualification | null) ?? null,
    };
    return reply.send(result);
  });

  // --- list users (admin | lead) -----------------------------------------
  app.get(
    ROUTES.users,
    { preHandler: [app.requireAuth, app.requireRole('admin', 'lead')] },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db.select().from(helpers).where(eq(helpers.orgId, session.orgId));
      const result: UserListResponse = { users: rows.map(toUserAccount) };
      return reply.send(result);
    },
  );

  // --- set a user's qualification (admin only) ---------------------------
  // The target is addressed by its KEY ID in the path (operational id; matches
  // the contract ROUTES.userQualification template). The qualification is
  // OPERATIONAL personnel metadata (an Ausbildungsstand), not patient/health
  // data — stored in clear. Constrained to the caller's org.
  app.patch(
    ROUTES.userQualification,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const parsed = setQualificationSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(reply, badRequest('invalid qualification', parsed.error.issues));
      const session = req.session!;
      const keyId = (req.params as { keyId: string }).keyId;

      const updated = await db
        .update(helpers)
        .set({ qualification: parsed.data.qualification })
        .where(and(eq(helpers.keyId, keyId), eq(helpers.orgId, session.orgId)))
        .returning();
      const after = updated[0];
      if (!after) return sendError(reply, notFound('user not found'));
      return reply.send(toUserAccount(after));
    },
  );

  // --- update a user's role/status (admin only) --------------------------
  app.patch(
    ROUTES.users,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const parsed = updateUserSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(reply, badRequest('invalid user update', parsed.error.issues));
      const { helperId, role, status } = parsed.data;
      const session = req.session!;

      const rows = await db
        .select()
        .from(helpers)
        .where(and(eq(helpers.helperId, helperId), eq(helpers.orgId, session.orgId)))
        .limit(1);
      const target = rows[0];
      if (!target) return sendError(reply, notFound('user not found'));

      // Last-admin guard: refuse any change that would remove the final active
      // admin (demotion OR disabling). Counted within the caller's org.
      const demotesAdmin = target.role === 'admin' && role !== undefined && role !== 'admin';
      const disablesAdmin = target.role === 'admin' && status === 'disabled';
      if (demotesAdmin || disablesAdmin) {
        const activeAdmins = await countActiveAdmins(app, session.orgId);
        // target is currently an active admin iff it is counted in activeAdmins.
        const targetIsActiveAdmin = target.status === 'active';
        if (targetIsActiveAdmin && activeAdmins <= 1) {
          return sendError(reply, conflict('cannot demote or disable the last remaining admin'));
        }
      }

      const patch: Partial<Pick<HelperRow, 'role' | 'status'>> = {};
      if (role !== undefined) patch.role = role;
      if (status !== undefined) patch.status = status;
      if (Object.keys(patch).length === 0) return reply.send(toUserAccount(target));

      const updated = await db
        .update(helpers)
        .set(patch)
        .where(and(eq(helpers.helperId, helperId), eq(helpers.orgId, session.orgId)))
        .returning();
      const after = updated[0]!;

      // Audit the offboarding/role events. A status flip and a role change can
      // both happen in one PATCH; emit one entry per distinct change.
      if (patch.status !== undefined && patch.status !== target.status) {
        await writeAudit(
          db,
          {
            orgId: session.orgId,
            actorKeyId: session.keyId,
            action: patch.status === 'disabled' ? 'user.disabled' : 'user.enabled',
            targetKeyId: target.keyId,
          },
          req.log,
        );
      }
      if (patch.role !== undefined && patch.role !== target.role) {
        await writeAudit(
          db,
          {
            orgId: session.orgId,
            actorKeyId: session.keyId,
            action: 'user.role-changed',
            targetKeyId: target.keyId,
            detail: `${target.role} -> ${patch.role}`,
          },
          req.log,
        );
      }
      return reply.send(toUserAccount(after));
    },
  );

  // --- create invitation (admin only) ------------------------------------
  app.post(
    ROUTES.invitations,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const parsed = createInvitationSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(reply, badRequest('invalid invitation', parsed.error.issues));
      const body = parsed.data;
      const session = req.session!;

      const ttlHours = Math.min(
        body.expiresInHours ?? DEFAULT_INVITE_TTL_HOURS,
        MAX_INVITE_TTL_HOURS,
      );
      const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);

      // The code is generated ONCE here, hashed, and only the hash is stored.
      const code = generateInvitationCode();
      const codeHash = hashInvitationCode(config.SESSION_SECRET, code);

      const inserted = await db
        .insert(invitations)
        .values({
          orgId: session.orgId,
          role: body.role,
          displayName: body.displayName ?? null,
          codeHash,
          status: 'pending',
          createdByKeyId: session.keyId,
          expiresAt,
        })
        .returning();
      const row = inserted[0]!;

      await writeAudit(
        db,
        {
          orgId: session.orgId,
          actorKeyId: session.keyId,
          action: 'user.invited',
          detail: `role=${body.role}`,
        },
        req.log,
      );

      const result: CreateInvitationResponse = {
        invitation: toInvitation(row),
        code, // returned exactly once; never stored in clear, never logged
      };
      return reply.code(201).send(result);
    },
  );

  // --- list invitations (admin only) -------------------------------------
  app.get(
    ROUTES.invitations,
    { preHandler: [app.requireAuth, app.requireRole('admin')] },
    async (req, reply) => {
      const session = req.session!;
      const rows = await db.select().from(invitations).where(eq(invitations.orgId, session.orgId));
      // toInvitation never includes the code/codeHash.
      return reply.send({ invitations: rows.map(toInvitation) });
    },
  );

  // --- redeem invitation (UNAUTHENTICATED) -------------------------------
  // Rate-limited tighter than the global default: code-guessing protection.
  app.post(
    ROUTES.redeemInvitation,
    {
      config: {
        rateLimit: {
          max: config.AUTH_RATE_LIMIT_MAX,
          timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
        },
      },
    },
    async (req, reply) => {
      const parsed = redeemInvitationSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(reply, badRequest('invalid redemption', parsed.error.issues));
      const body = parsed.data;

      const codeHash = hashInvitationCode(config.SESSION_SECRET, body.code);
      const rows = await db
        .select()
        .from(invitations)
        .where(eq(invitations.codeHash, codeHash))
        .limit(1);
      const invite = rows[0];
      // Uniform error for unknown vs. used vs. expired: don't leak which case.
      if (!invite) return sendError(reply, badRequest('invalid or expired invitation code'));
      if (invite.status !== 'pending') {
        return sendError(reply, badRequest('invalid or expired invitation code'));
      }
      if (invite.expiresAt.getTime() <= Date.now()) {
        await db
          .update(invitations)
          .set({ status: 'expired' })
          .where(eq(invitations.id, invite.id));
        return sendError(reply, badRequest('invalid or expired invitation code'));
      }

      const identity = body.identity;
      if (identity.keyId.trim() !== identity.keyId || identity.keyId.length === 0) {
        return sendError(reply, badRequest('invalid keyId'));
      }

      try {
        const account = await db.transaction(async (tx) => {
          const insertedUser = await tx
            .insert(helpers)
            .values({
              orgId: invite.orgId,
              displayName: body.displayName,
              keyId: identity.keyId,
              identity,
              wrappedSecret: body.wrappedSecret,
              role: invite.role,
              status: 'active',
              invitedByKeyId: invite.createdByKeyId,
            })
            .returning();
          const userRow = insertedUser[0]!;

          // Single-use: flip to redeemed, guarded on still-pending to avoid a
          // race double-redeem (a second concurrent tx updates 0 rows → throws).
          const marked = await tx
            .update(invitations)
            .set({
              status: 'redeemed',
              redeemedByKeyId: identity.keyId,
              redeemedAt: new Date(),
            })
            .where(and(eq(invitations.id, invite.id), eq(invitations.status, 'pending')))
            .returning({ id: invitations.id });
          if (marked.length === 0) {
            throw new HttpRollback('invitation already redeemed');
          }
          return userRow;
        });

        const orgRows = await db.select().from(orgs).where(eq(orgs.orgId, invite.orgId)).limit(1);
        const org = orgRows[0];
        if (!org) return sendError(reply, notFound('org not found'));

        // Redemption is unauthenticated: the actor IS the new account's keyId.
        await writeAudit(
          db,
          {
            orgId: invite.orgId,
            actorKeyId: identity.keyId,
            action: 'user.redeemed',
            targetKeyId: identity.keyId,
            detail: `role=${invite.role}`,
          },
          req.log,
        );

        const result: RedeemInvitationResponse = {
          account: toUserAccount(account),
          org: toOrgPublicInfo(org),
        };
        return reply.code(201).send(result);
      } catch (err) {
        if (err instanceof HttpRollback) {
          return sendError(reply, conflict(err.message));
        }
        if (isUniqueViolation(err)) {
          return sendError(reply, conflict('keyId already registered'));
        }
        throw err;
      }
    },
  );
}

/** Internal sentinel to roll back a redemption transaction with a 409. */
class HttpRollback extends Error {}

async function countActiveAdmins(app: FastifyInstance, orgId: string): Promise<number> {
  const { db } = app.ctx;
  const rows = await db
    .select({ helperId: helpers.helperId })
    .from(helpers)
    .where(and(eq(helpers.orgId, orgId), eq(helpers.role, 'admin'), eq(helpers.status, 'active')));
  return rows.length;
}

function toOrgPublicInfo(org: OrgRow): OrgPublicInfo {
  return {
    orgId: org.orgId,
    orgName: org.orgName,
    identity: org.identity as PublicIdentity,
  };
}

function toOrgKeyset(org: OrgRow): OrgKeyset {
  const keyset: OrgKeyset = {
    orgId: org.orgId,
    identity: org.identity as PublicIdentity,
    wrappedSecret: org.wrappedSecret as WrappedSecretKey,
    createdAt: org.createdAt.toISOString(),
  };
  if (org.recoveryWrappers) {
    keyset.recoveryWrappers = org.recoveryWrappers as WrappedSecretKey[];
  }
  return keyset;
}

function toUserAccount(row: HelperRow): UserAccount {
  const account: UserAccount = {
    helperId: row.helperId,
    orgId: row.orgId,
    displayName: row.displayName,
    role: row.role as Role,
    identity: row.identity as PublicIdentity,
    status: row.status as 'active' | 'disabled',
    qualification: (row.qualification as Qualification | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.invitedByKeyId) account.invitedByKeyId = row.invitedByKeyId;
  if (row.lastSeenAt) account.lastSeenAt = row.lastSeenAt.toISOString();
  return account;
}

/** Never includes codeHash/code. */
function toInvitation(row: typeof invitations.$inferSelect): Invitation {
  const inv: Invitation = {
    id: row.id,
    orgId: row.orgId,
    role: row.role as Role,
    status: row.status as InvitationStatus,
    createdByKeyId: row.createdByKeyId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
  if (row.displayName) inv.displayName = row.displayName;
  if (row.redeemedByKeyId) inv.redeemedByKeyId = row.redeemedByKeyId;
  if (row.redeemedAt) inv.redeemedAt = row.redeemedAt.toISOString();
  return inv;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
