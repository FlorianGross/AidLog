/**
 * crypto/session.ts — in-memory session-key management.
 *
 * SECURITY BOUNDARY (CI-enforced, see docs/ARCHITECTURE.md §8):
 *   - Unwrapped secret keys, the password, and DEKs live ONLY in memory here.
 *   - NOTHING sensitive is written to localStorage. Only ciphertext /
 *     wrappedSecret are persisted (in IndexedDB, by the store layer).
 *   - `lock()` wipes the in-memory identity so a stolen/locked device exposes
 *     no key material.
 *
 * We never import a crypto primitive directly — everything goes through
 * `@aidlog/crypto-core` (the only package allowed to touch libsodium).
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import type { OrgPublicInfo, PublicIdentity, Role, WrappedSecretKey } from '@aidlog/contracts';

/**
 * Session role mirrors the contract `Role` (`@aidlog/contracts`):
 * 'admin' | 'lead' | 'helper'. (Replaces the earlier scaffold's
 * 'helper' | 'org-admin' duo — the first org admin is now role 'admin'.)
 */
export type SessionRole = Role;

export interface UnlockedSession {
  role: SessionRole;
  /** The unwrapped identity — secret keys present, memory only. */
  identity: IdentityKeyPair;
  publicIdentity: PublicIdentity;
  /** keyId === base64(signPublicKey) per crypto-core convention. */
  keyId: string;
  orgId: string;
  /** The account's own helperId (admins included once redeemed/registered). */
  helperId?: string;
}

/**
 * The organisation's PUBLIC identity, cached in memory after login/setup so the
 * documentation editor can seal per-record DEKs to the org (recipientType
 * 'org'). NON-sensitive (public keys only) — but kept beside the session so it
 * is wiped on lock together with the in-memory identity.
 *
 * Consumed by the documentation agent via `getOrgIdentity()` (re-exported from
 * `$lib/crypto`): `const org = getOrgIdentity() ?? s.publicIdentity;`.
 */
let orgInfo: OrgPublicInfo | null = null;

/** Cache the org public info (call after fetching ROUTES.orgInfo, or at setup). */
export function setOrgInfo(info: OrgPublicInfo | null): void {
  orgInfo = info;
  notifyOrg();
}

/** The cached org public identity, or null if not yet known. */
export function getOrgIdentity(): PublicIdentity | null {
  return orgInfo?.identity ?? null;
}

/** The full cached org public info (id, name, identity), or null. */
export function getOrgInfo(): OrgPublicInfo | null {
  return orgInfo;
}

const orgListeners = new Set<(info: OrgPublicInfo | null) => void>();

function notifyOrg(): void {
  for (const l of orgListeners) l(orgInfo);
}

/** Subscribe to org-info changes (for reactive stores). */
export function onOrgInfoChange(fn: (info: OrgPublicInfo | null) => void): () => void {
  orgListeners.add(fn);
  fn(orgInfo);
  return () => orgListeners.delete(fn);
}

/** The currently unlocked identity, or null when locked. Module-private. */
let current: UnlockedSession | null = null;

/** Listeners notified whenever the lock state changes (for reactive stores). */
const listeners = new Set<(s: UnlockedSession | null) => void>();

function notify(): void {
  for (const l of listeners) l(current);
}

export function onSessionChange(fn: (s: UnlockedSession | null) => void): () => void {
  listeners.add(fn);
  fn(current);
  return () => listeners.delete(fn);
}

export function getSession(): UnlockedSession | null {
  return current;
}

export function isUnlocked(): boolean {
  return current !== null;
}

/**
 * Unlock an identity from its password-wrapped secret. The plaintext password
 * is used only transiently to derive the unwrap key inside crypto-core and is
 * never stored.
 */
export async function unlock(args: {
  wrapped: WrappedSecretKey;
  password: string;
  role: SessionRole;
  orgId: string;
  helperId?: string;
}): Promise<UnlockedSession> {
  await crypto.ready();
  // Throws if the password is wrong (AEAD auth failure) — surfaced to the UI.
  const identity = await crypto.unwrapIdentity(args.wrapped, args.password);
  const publicIdentity = crypto.toPublicIdentity(identity);

  // Replace any prior session, wiping it first.
  lock();
  current = {
    role: args.role,
    identity,
    publicIdentity,
    keyId: publicIdentity.keyId,
    orgId: args.orgId,
    ...(args.helperId !== undefined ? { helperId: args.helperId } : {}),
  };
  notify();
  return current;
}

/**
 * Register a freshly-generated identity into the session without re-deriving
 * from a wrapped secret (used right after setup, where we already hold the
 * IdentityKeyPair in memory).
 */
export function adopt(args: {
  identity: IdentityKeyPair;
  role: SessionRole;
  orgId: string;
  helperId?: string;
}): UnlockedSession {
  const publicIdentity = crypto.toPublicIdentity(args.identity);
  lock();
  current = {
    role: args.role,
    identity: args.identity,
    publicIdentity,
    keyId: publicIdentity.keyId,
    orgId: args.orgId,
    ...(args.helperId !== undefined ? { helperId: args.helperId } : {}),
  };
  notify();
  return current;
}

/**
 * Wipe the in-memory identity. Best-effort zeroing of the secret-key buffers;
 * once cleared the reference is dropped for GC. Call on lock/logout, on
 * shift-close, and on tab visibility loss if a strict policy is desired.
 */
export function lock(): void {
  if (current) {
    try {
      current.identity.box.secretKey.fill(0);
      current.identity.sign.secretKey.fill(0);
    } catch {
      // Buffers may be detached/frozen in some environments; ignore.
    }
  }
  const had = current !== null;
  current = null;
  if (had) notify();
  // Drop the cached org public info as well (non-secret, but session-scoped).
  if (orgInfo !== null) setOrgInfo(null);
}
