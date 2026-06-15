/**
 * Session auth (proof-of-possession, ARCHITECTURE.md §7).
 *
 * No password ever reaches the server. A client proves possession of its Ed25519
 * signing secret key by signing a server-issued challenge; the route verifies
 * the signature with `@aidlog/crypto-core` against the registered public key and
 * then calls `issueSession` here.
 *
 * Tokens are opaque random strings stored in the `sessions` table, with an
 * HMAC-SHA256 tag (keyed by SESSION_SECRET) so a stolen/forged token id cannot
 * be used without the secret AND a matching DB row. The token carries no secret
 * content — only a routing claim (keyId, orgId, role).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'; // crypto-lint-allow: session-token HMAC + random token id; no content/DEK/password crypto (ARCHITECTURE.md §7)
import { and, eq, lt } from 'drizzle-orm';
import type { AuthSession, Role } from '@aidlog/contracts';
import { ROLES } from '@aidlog/contracts';
import type { Db } from './db/client.js';
import { sessions } from './db/schema.js';

/** Role is the authoritative contract Role: 'admin' | 'lead' | 'helper'. */
export type { Role };

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export interface SessionContext {
  token: string;
  keyId: string;
  orgId: string;
  role: Role;
  expiresAt: Date;
}

function tag(secret: string, raw: string): string {
  return createHmac('sha256', secret).update(raw).digest('base64url');
}

/** token format: `<random>.<hmac(random)>` — both parts base64url, no secrets. */
function mintToken(secret: string): string {
  const raw = randomBytes(32).toString('base64url');
  return `${raw}.${tag(secret, raw)}`;
}

function tokenTagValid(secret: string, token: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const raw = token.slice(0, dot);
  const got = token.slice(dot + 1);
  const want = tag(secret, raw);
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface IssueSessionArgs {
  db: Db;
  secret: string;
  ttlSeconds: number;
  keyId: string;
  orgId: string;
  role: Role;
}

export async function issueSession(args: IssueSessionArgs): Promise<AuthSession> {
  const token = mintToken(args.secret);
  const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000);
  await args.db.insert(sessions).values({
    token,
    keyId: args.keyId,
    orgId: args.orgId,
    role: args.role,
    expiresAt,
  });
  return {
    token,
    expiresAt: expiresAt.toISOString(),
    keyId: args.keyId,
    orgId: args.orgId,
    role: args.role,
  };
}

/**
 * Verify a bearer token: HMAC tag must match (cheap, no DB hit on garbage) and a
 * non-expired session row must exist. Returns null on any failure.
 */
export async function verifySession(
  db: Db,
  secret: string,
  token: string | undefined,
): Promise<SessionContext | null> {
  if (!token || !tokenTagValid(secret, token)) return null;
  const rows = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  if (!isRole(row.role)) return null;
  return {
    token: row.token,
    keyId: row.keyId,
    orgId: row.orgId,
    role: row.role,
    expiresAt: row.expiresAt,
  };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token));
}

/** Best-effort cleanup of expired sessions and challenges. */
export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (!value || scheme?.toLowerCase() !== 'bearer') return undefined;
  return value.trim();
}

export { sessions, and, eq };
