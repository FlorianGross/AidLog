/**
 * Invitation code generation + hashing.
 *
 * The single-use invitation `code` is the only secret in the user-onboarding
 * flow that the admin sees. The server NEVER stores it in clear: it stores only
 * a keyed HMAC-SHA256 (`codeHash`) keyed by SESSION_SECRET, the same way auth.ts
 * tags session tokens. Redemption recomputes the HMAC of the presented code and
 * looks the row up by hash, so a database leak cannot reveal usable codes.
 *
 * This is non-content cryptography (onboarding token + its hash), explicitly
 * permitted to use node:crypto with the pragma below — no plaintext, DEK,
 * password, or secret key is ever touched here (ARCHITECTURE.md §4, §8).
 */
import { createHmac, randomBytes } from 'node:crypto'; // crypto-lint-allow: random invitation code + keyed hash of it; non-content onboarding token (ARCHITECTURE.md §8)

/** Generate a high-entropy, URL-safe single-use code (~192 bits). */
export function generateInvitationCode(): string {
  return randomBytes(24).toString('base64url');
}

/** Keyed HMAC-SHA256 of a code → base64url. Deterministic for lookup. */
export function hashInvitationCode(secret: string, code: string): string {
  return createHmac('sha256', secret).update(code).digest('base64url');
}
