/**
 * webauthn/index.ts — Passkey (WebAuthn + PRF) unlock for Aidlog.
 *
 * The flow binds a device-local passkey to the in-memory identity WITHOUT ever
 * persisting the identity secret in the clear:
 *
 *   register: navigator.credentials.create({ prf })  →  prfSecret (32 bytes)
 *             crypto.wrapIdentityWithKey(identity, prfSecret)  →  ciphertext
 *             store { credentialId, prfWrappedSecret } in IndexedDB
 *
 *   unlock:   navigator.credentials.get({ prf, allowCredentials:[id] })
 *             →  prfSecret (same 32 bytes, re-derived by the authenticator)
 *             crypto.unwrapIdentityWithKey(prfWrappedSecret, prfSecret)  → identity
 *
 * SECURITY: `prfSecret` is a Uint8Array held in memory only and `fill(0)`-ed in
 * a `finally` the moment the wrap/unwrap returns. Nothing secret is logged. The
 * persisted/transferred material is exclusively ciphertext.
 *
 * All content crypto goes through `@aidlog/crypto-core`; this module only uses
 * the browser WebAuthn API and non-crypto base64url encoding for ids/challenges.
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import type { WrappedSecretKey } from '@aidlog/contracts';
import { savePasskey, getPasskey, type StoredPasskey } from './store';

export { listPasskeys, deletePasskey, hasAnyPasskey } from './store';
export type { StoredPasskey } from './store';

/**
 * A FIXED application salt fed to the PRF extension. Using one stable salt makes
 * the PRF output deterministic per credential, so the same passkey always
 * derives the same 32-byte unwrap key. It is a domain-separation label, not a
 * secret. (32 bytes of ASCII "aidlog-passkey-unlock-prf-salt:v1".)
 */
const PRF_SALT = new TextEncoder().encode('aidlog-passkey-unlock-prf-salt:v1');

// --- base64url (non-crypto id/challenge encoding) --------------------------

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Copy `src` into a fresh ArrayBuffer-backed Uint8Array so it satisfies the DOM
 * `BufferSource` type (the WebAuthn lib types reject `Uint8Array<ArrayBufferLike>`,
 * which could in principle be SharedArrayBuffer-backed).
 */
function asBufferSource(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(src.length));
  out.set(src);
  return out;
}

// --- feature detection -----------------------------------------------------

/**
 * Whether this browser exposes the WebAuthn platform-authenticator API at all.
 * (The PRF extension itself can only be confirmed at registration time — the
 * authenticator reports support in the create() result — so the UI treats this
 * as "passkeys MIGHT be available" and degrades gracefully if PRF is absent.)
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator !== 'undefined' &&
    !!navigator.credentials &&
    typeof navigator.credentials.create === 'function' &&
    typeof navigator.credentials.get === 'function'
  );
}

/** Relying-party id = the registrable domain (host without port). */
function rpId(): string {
  return window.location.hostname;
}

/** Read the PRF "first" output from a credential's extension results, if any. */
function readPrfFirst(cred: PublicKeyCredential): ArrayBuffer | undefined {
  const ext = cred.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer | undefined } };
  };
  return ext.prf?.results?.first;
}

/** Typed failure the UI can branch on (e.g. PRF unsupported vs user-cancelled). */
export class PasskeyError extends Error {
  constructor(
    message: string,
    readonly code: 'prf-unsupported' | 'cancelled' | 'unsupported' | 'failed',
  ) {
    super(message);
    this.name = 'PasskeyError';
  }
}

// --- registration ----------------------------------------------------------

/**
 * Register a new passkey for the CURRENTLY UNLOCKED identity and store its
 * PRF-wrapped secret locally. Must be called while `identity` (with secret keys)
 * is in memory. Returns the stored descriptor (ciphertext + credentialId).
 *
 * @param identity   the in-memory unlocked identity (its secret is wrapped).
 * @param userId     stable bytes identifying the account (e.g. keyId bytes).
 * @param userName   account handle shown by the authenticator UI.
 * @param label      human label persisted for the passkey list.
 */
export async function registerPasskey(args: {
  identity: IdentityKeyPair;
  userId: Uint8Array;
  userName: string;
  label: string;
}): Promise<StoredPasskey> {
  if (!isWebAuthnSupported()) {
    throw new PasskeyError('WebAuthn not available', 'unsupported');
  }
  await crypto.ready();

  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));

  let cred: PublicKeyCredential;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { id: rpId(), name: 'Aidlog' },
        user: {
          id: asBufferSource(args.userId),
          name: args.userName,
          displayName: args.userName,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
        timeout: 60_000,
        extensions: {
          // Request PRF; evaluate it immediately for our fixed salt so we get a
          // usable secret in this same ceremony (supported by Chrome/Safari).
          prf: { eval: { first: PRF_SALT } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new PasskeyError('Registration cancelled', 'cancelled');
    }
    throw new PasskeyError('Passkey registration failed', 'failed');
  }
  if (!cred) throw new PasskeyError('No credential returned', 'failed');

  const prfBuf = readPrfFirst(cred);
  if (!prfBuf) {
    // Authenticator created the credential but does NOT support PRF — it is
    // useless for unlock. Best effort: we simply cannot use it; surface clearly.
    throw new PasskeyError('PRF extension not supported by this authenticator', 'prf-unsupported');
  }

  const prfSecret = new Uint8Array(prfBuf);
  let prfWrappedSecret: WrappedSecretKey;
  try {
    prfWrappedSecret = crypto.wrapIdentityWithKey(args.identity, prfSecret);
  } finally {
    prfSecret.fill(0); // zero the PRF secret immediately after wrapping
  }

  const stored: StoredPasskey = {
    credentialId: toB64Url(new Uint8Array(cred.rawId)),
    label: args.label,
    prfWrappedSecret,
    createdAt: new Date().toISOString(),
  };
  await savePasskey(stored);
  return stored;
}

// --- unlock ----------------------------------------------------------------

/**
 * Unlock using a device-local passkey. Performs a WebAuthn assertion scoped to
 * the passkeys registered on THIS device, re-derives the PRF secret, and unwraps
 * the identity. The PRF secret is zeroed straight after the unwrap.
 *
 * @returns the unwrapped {@link IdentityKeyPair} (secret keys present, memory
 *   only) — the caller adopts it into the session exactly like the password path.
 */
export async function unlockWithPasskey(passkeys: StoredPasskey[]): Promise<IdentityKeyPair> {
  if (!isWebAuthnSupported()) {
    throw new PasskeyError('WebAuthn not available', 'unsupported');
  }
  if (passkeys.length === 0) {
    throw new PasskeyError('No passkey registered on this device', 'failed');
  }
  await crypto.ready();

  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));

  let assertion: PublicKeyCredential;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: rpId(),
        allowCredentials: passkeys.map((pk) => ({
          type: 'public-key' as const,
          id: asBufferSource(fromB64Url(pk.credentialId)),
        })),
        userVerification: 'required',
        timeout: 60_000,
        extensions: {
          prf: { eval: { first: PRF_SALT } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new PasskeyError('Unlock cancelled', 'cancelled');
    }
    throw new PasskeyError('Passkey unlock failed', 'failed');
  }
  if (!assertion) throw new PasskeyError('No assertion returned', 'failed');

  // Match the asserted credential back to its stored wrapper.
  const usedId = toB64Url(new Uint8Array(assertion.rawId));
  const match = passkeys.find((pk) => pk.credentialId === usedId) ?? (await getPasskey(usedId));
  if (!match) throw new PasskeyError('Asserted passkey is unknown on this device', 'failed');

  const prfBuf = readPrfFirst(assertion);
  if (!prfBuf) {
    throw new PasskeyError('PRF result missing from assertion', 'prf-unsupported');
  }

  const prfSecret = new Uint8Array(prfBuf);
  try {
    return crypto.unwrapIdentityWithKey(match.prfWrappedSecret, prfSecret);
  } finally {
    prfSecret.fill(0); // zero the PRF secret after unwrap (success or throw)
  }
}
