/**
 * Identity & auth routes:
 *   POST /api/orgs            registerOrg
 *   POST /api/helpers         registerHelper
 *   POST /api/auth/challenge  authChallenge
 *   POST /api/auth/verify     authVerify (proof-of-possession)
 *
 * The server stores ONLY public identities + password-wrapped secrets. The
 * wrapped secret is an opaque ciphertext blob it can never unwrap. Auth proves
 * possession of the Ed25519 signing key by verifying a signature over a
 * server-issued challenge via @aidlog/crypto-core — no password is ever sent.
 */
import { randomBytes } from 'node:crypto'; // crypto-lint-allow: random auth challenge nonce (proof-of-possession); never used as a content key
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type { AuthChallenge, AuthSession, OrgKeyset, PublicIdentity } from '@aidlog/contracts';
import { crypto as cryptoCore } from '@aidlog/crypto-core';
import { registerOrgSchema, authChallengeSchema, authVerifySchema } from '../validation.js';
import { orgs, helpers, authChallenges } from '../db/schema.js';
import { issueSession, type Role } from '../auth.js';
import {
  badRequest,
  conflict,
  notFound,
  unauthorized,
  sendError,
  toApiError,
  HttpError,
} from '../errors.js';

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;
  await cryptoCore.ready();

  // --- registerOrg --------------------------------------------------------
  app.post(ROUTES.registerOrg, async (req, reply) => {
    const parsed = registerOrgSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid org registration', parsed.error.issues));
    const body = parsed.data;
    if (body.identity.keyId !== body.identity.keyId.trim() || body.identity.keyId.length === 0)
      return sendError(reply, badRequest('invalid keyId'));

    // Bootstrap admin must not collide with the org's own keyId.
    if (body.admin && body.admin.identity.keyId === body.identity.keyId) {
      return sendError(reply, badRequest('admin identity must differ from org identity'));
    }

    try {
      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(orgs)
          .values({
            orgName: body.orgName,
            keyId: body.identity.keyId,
            identity: body.identity,
            wrappedSecret: body.wrappedSecret,
          })
          .returning({ orgId: orgs.orgId, createdAt: orgs.createdAt });
        const row = inserted[0]!;

        // Provision the org's FIRST user as an admin, when supplied (the setup
        // flow sends the admin's personal identity + wrappedSecret).
        if (body.admin) {
          await tx.insert(helpers).values({
            orgId: row.orgId,
            displayName: body.admin.displayName,
            keyId: body.admin.identity.keyId,
            identity: body.admin.identity,
            wrappedSecret: body.admin.wrappedSecret,
            role: 'admin',
            status: 'active',
          });
        }

        const keyset: OrgKeyset = {
          orgId: row.orgId,
          identity: body.identity,
          wrappedSecret: body.wrappedSecret,
          createdAt: row.createdAt.toISOString(),
        };
        return keyset;
      });
      return reply.code(201).send(result);
    } catch (err) {
      if (isUniqueViolation(err)) return sendError(reply, conflict('keyId already registered'));
      throw err;
    }
  });

  // --- registerHelper (DISABLED) ------------------------------------------
  // Open self-registration is closed: accounts are created ONLY via an
  // admin-issued invitation (POST ROUTES.invitations → POST
  // ROUTES.redeemInvitation). This route now always rejects with 410 Gone so
  // older clients get a clear, actionable error instead of silently creating
  // unmanaged accounts.
  app.post(ROUTES.registerHelper, async (_req, reply) => {
    return reply
      .code(410)
      .send(
        toApiError(
          new HttpError(
            410,
            'gone',
            'self-registration is disabled; obtain an invitation from an admin and redeem it at ' +
              ROUTES.redeemInvitation,
          ),
        ),
      );
  });

  // Stricter per-route limit (env-tunable) for the brute-forceable auth
  // endpoints, on top of the permissive global limit: throttles
  // proof-of-possession guessing per IP.
  const authRateLimit = {
    config: {
      rateLimit: {
        max: config.AUTH_RATE_LIMIT_MAX,
        timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
      },
    },
  };

  // --- authChallenge ------------------------------------------------------
  app.post(ROUTES.authChallenge, authRateLimit, async (req, reply) => {
    const parsed = authChallengeSchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid challenge request', parsed.error.issues));
    const { keyId } = parsed.data;

    const identity = await lookupSigner(app, keyId);
    if (!identity) return sendError(reply, notFound('unknown keyId'));

    const challenge = randomBytes(32).toString('base64');
    const expiresAt = new Date(Date.now() + config.CHALLENGE_TTL_SECONDS * 1000);
    await db.insert(authChallenges).values({ challenge, keyId, expiresAt });

    const result: AuthChallenge = { challenge, expiresAt: expiresAt.toISOString() };
    return reply.code(201).send(result);
  });

  // --- authVerify ---------------------------------------------------------
  app.post(ROUTES.authVerify, authRateLimit, async (req, reply) => {
    const parsed = authVerifySchema.safeParse(req.body);
    if (!parsed.success)
      return sendError(reply, badRequest('invalid verify request', parsed.error.issues));
    const { keyId, challenge, signature } = parsed.data;

    // Challenge must exist, match the keyId, and be unexpired. Consume it (single-use).
    const rows = await db
      .select()
      .from(authChallenges)
      .where(eq(authChallenges.challenge, challenge))
      .limit(1);
    const row = rows[0];
    if (!row || row.keyId !== keyId || row.expiresAt.getTime() <= Date.now()) {
      if (row) await db.delete(authChallenges).where(eq(authChallenges.challenge, challenge));
      return sendError(reply, unauthorized('invalid or expired challenge'));
    }
    // Single-use: delete before verifying so a replay can't reuse it.
    await db.delete(authChallenges).where(eq(authChallenges.challenge, challenge));

    const signer = await lookupSigner(app, keyId);
    if (!signer) return sendError(reply, unauthorized('unknown keyId'));
    if (signer.disabled) return sendError(reply, unauthorized('account disabled'));

    // Verify Ed25519 signature over the challenge bytes via crypto-core ONLY.
    let ok = false;
    try {
      ok = cryptoCore.verify(
        cryptoCore.fromBase64(signature),
        cryptoCore.fromBase64(challenge),
        cryptoCore.fromBase64(signer.identity.signPublicKey),
      );
    } catch {
      ok = false;
    }
    if (!ok) return sendError(reply, unauthorized('signature verification failed'));

    const session: AuthSession = await issueSession({
      db,
      secret: config.SESSION_SECRET,
      ttlSeconds: config.SESSION_TTL_SECONDS,
      keyId,
      orgId: signer.orgId,
      role: signer.role,
    });
    return reply.code(201).send(session);
  });
}

interface ResolvedSigner {
  identity: PublicIdentity;
  orgId: string;
  role: Role;
  disabled: boolean;
}

/**
 * Resolve a keyId to its public identity + role, checking user accounts
 * (`helpers`) first, then falling back to the org keyset (which acts as an
 * 'admin' identity for legacy bootstrap without a separate admin account).
 */
async function lookupSigner(app: FastifyInstance, keyId: string): Promise<ResolvedSigner | null> {
  const { db } = app.ctx;
  const helperRows = await db.select().from(helpers).where(eq(helpers.keyId, keyId)).limit(1);
  const helper = helperRows[0];
  if (helper) {
    return {
      identity: helper.identity as PublicIdentity,
      orgId: helper.orgId,
      role: (helper.role as Role) ?? 'helper',
      disabled: helper.status === 'disabled',
    };
  }
  const orgRows = await db.select().from(orgs).where(eq(orgs.keyId, keyId)).limit(1);
  const org = orgRows[0];
  if (org) {
    return {
      identity: org.identity as PublicIdentity,
      orgId: org.orgId,
      role: 'admin',
      disabled: false,
    };
  }
  return null;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

export { HttpError };
