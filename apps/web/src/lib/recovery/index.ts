/**
 * lib/recovery — organisation-key RECOVERY orchestration (Shamir).
 *
 * SECURITY BOUNDARY (mirrors crypto/session.ts, see docs/ARCHITECTURE.md §8):
 *   - The org password, the reconstructed org SECRET, and the Shamir SHARES are
 *     handled in memory only and zeroed as soon as they are no longer needed.
 *   - A share or secret is NEVER sent to the server and NEVER persisted to
 *     localStorage / IndexedDB / logs. Only the metadata (T/N, trustee labels,
 *     orgKeyCheck) and the re-wrapped ciphertext (wrappedSecret) cross the wire.
 *   - All primitives go through @aidlog/crypto-core (the only libsodium holder);
 *     this module is the thin client-side orchestration on top of it.
 *
 * Threat model note surfaced in the UI: recovery reconstructs the org key from
 * >= T of N human-held shares; fewer than T shares reveal nothing.
 */
import { crypto } from '@aidlog/crypto-core';
import type { ShamirShare } from '@aidlog/crypto-core';
import type { OrgKeyset, PublicIdentity, WrappedSecretKey } from '@aidlog/contracts';

/** One trustee's printable/copyable share: a label + the encoded share text. */
export interface IssuedShare {
  /** 1-based position for display only (e.g. "Anteil 2 von 5"). */
  position: number;
  label: string;
  /** The human-transferable encoded share (index + base64 + checksum). */
  encoded: string;
}

/** Result of configuring recovery: the shares to hand out + the key check. */
export interface ConfigureResult {
  shares: IssuedShare[];
  /** BLAKE2b(org boxPublicKey), base64 — lets a later recovery verify the rebuild. */
  orgKeyCheck: string;
}

/** Best-effort zeroing of a secret byte buffer. */
export function wipeBytes(buf: Uint8Array | null | undefined): void {
  if (!buf) return;
  try {
    buf.fill(0);
  } catch {
    // Buffer may be detached/frozen in some environments; ignore.
  }
}

/** Zero the secret-key material of a reconstructed identity, then drop it. */
export function wipeIdentitySecret(
  id: {
    box: { secretKey: Uint8Array };
    sign: { secretKey: Uint8Array };
  } | null,
): void {
  if (!id) return;
  wipeBytes(id.box.secretKey);
  wipeBytes(id.sign.secretKey);
}

/**
 * Derive the org "key check": BLAKE2b of the org's X25519 box public key,
 * base64. Used both when CONFIGURING recovery (stored as metadata) and when
 * PERFORMING recovery (recomputed from the reconstructed key and compared), so
 * a wrong/insufficient share set is caught before a new password is set.
 */
export function computeOrgKeyCheck(boxPublicKeyB64: string): string {
  return crypto.toBase64(crypto.hash(crypto.fromBase64(boxPublicKeyB64)));
}

/**
 * Configure recovery: unwrap the org identity with the org password, export its
 * secret, split it into N shares with threshold T, and encode each for a human
 * trustee. The plaintext org secret is zeroed before returning; only encoded
 * shares (held by the caller in memory until handed out) and the orgKeyCheck
 * leave this function.
 *
 * Throws if the org password is wrong (crypto-core DecryptionError).
 */
export async function configureRecovery(args: {
  keyset: OrgKeyset;
  orgPassword: string;
  shareCount: number;
  threshold: number;
  trusteeLabels: string[];
}): Promise<ConfigureResult> {
  const { keyset, orgPassword, shareCount, threshold, trusteeLabels } = args;
  await crypto.ready();

  // Unwrap with the ORG password. Wrong password → throws (surfaced to UI).
  const orgId = await crypto.unwrapIdentity(keyset.wrappedSecret, orgPassword);

  let secret: Uint8Array | null = null;
  try {
    secret = crypto.exportIdentitySecret(orgId);
    const raw: ShamirShare[] = crypto.splitSecret(secret, shareCount, threshold);
    const encoded = raw.map((s) => crypto.encodeShare(s));
    // Zero the per-share y-coordinate buffers once encoded.
    for (const s of raw) wipeBytes(s.data);

    const orgKeyCheck = computeOrgKeyCheck(keyset.identity.boxPublicKey);

    const shares: IssuedShare[] = encoded.map((enc, i) => ({
      position: i + 1,
      label: trusteeLabels[i] ?? `Anteil ${i + 1}`,
      encoded: enc,
    }));

    return { shares, orgKeyCheck };
  } finally {
    wipeBytes(secret);
    // Drop the unwrapped org identity's secret material immediately.
    wipeIdentitySecret(orgId);
  }
}

/** A decode failure that knows WHICH pasted share (1-based) was malformed. */
export class ShareDecodeError extends Error {
  constructor(public position: number) {
    super(`share ${position} invalid`);
    this.name = 'ShareDecodeError';
  }
}

/** Thrown when the reconstructed key does not match the org's key check. */
export class RecoveryMismatchError extends Error {
  constructor() {
    super('reconstructed key does not match the organisation');
    this.name = 'RecoveryMismatchError';
  }
}

/**
 * Reconstruct the org identity from pasted shares and verify it against the
 * expected orgKeyCheck. Returns the reconstructed IdentityKeyPair AND its
 * public identity. The CALLER owns the returned secret material and MUST wipe
 * it (via `wipeIdentitySecret`) once the new wrapped secret has been produced.
 *
 * - Each non-empty share text is decoded; a malformed one throws
 *   `ShareDecodeError` naming its 1-based position.
 * - The combined secret is imported and its derived box public key is hashed
 *   and compared to `expectedKeyCheck`; a mismatch throws `RecoveryMismatchError`
 *   (wrong/foreign shares, or fewer than T → an unrelated value).
 */
export async function reconstructIdentity(args: {
  shareTexts: string[];
  expectedKeyCheck: string;
}): Promise<{
  identity: {
    box: { secretKey: Uint8Array; publicKey: Uint8Array };
    sign: { secretKey: Uint8Array; publicKey: Uint8Array };
  };
  publicIdentity: PublicIdentity;
}> {
  const { shareTexts, expectedKeyCheck } = args;
  await crypto.ready();

  const shares: ShamirShare[] = [];
  shareTexts.forEach((text, i) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      shares.push(crypto.decodeShare(trimmed));
    } catch {
      throw new ShareDecodeError(i + 1);
    }
  });

  let combined: Uint8Array | null = null;
  try {
    combined = crypto.combineSecret(shares);
    const identity = crypto.importIdentitySecret(combined);
    const publicIdentity = crypto.toPublicIdentity(identity);

    const check = computeOrgKeyCheck(publicIdentity.boxPublicKey);
    if (check !== expectedKeyCheck) {
      wipeIdentitySecret(identity);
      throw new RecoveryMismatchError();
    }
    return { identity, publicIdentity };
  } finally {
    // Wipe the raw combined secret + the per-share data buffers.
    wipeBytes(combined);
    for (const s of shares) wipeBytes(s.data);
  }
}

/**
 * Wrap a reconstructed identity under a NEW org password, producing the
 * ciphertext to PUT back via ROUTES.orgKeyset. The new password is used only
 * transiently inside crypto-core to derive the wrap key.
 */
export async function rewrapIdentity(args: {
  identity: Parameters<typeof crypto.wrapIdentity>[0];
  newOrgPassword: string;
}): Promise<WrappedSecretKey> {
  await crypto.ready();
  return crypto.wrapIdentity(args.identity, args.newOrgPassword);
}
