/**
 * cirs/submit.ts — build + POST an ANONYMOUS CIRS report from the client.
 *
 * ANONYMITY IS THE CORE PROPERTY. Unlike a ProtocolRecord (built via
 * buildRecord/finalizeDraft), a CIRS report is NEVER signed and NEVER attributed:
 *   - We generate a FRESH random DEK, encrypt the JSON payload under it (AEAD),
 *     and seal that DEK to the ORG box public key ONLY, via crypto.sealDek
 *     (crypto_box_seal / x25519-sealedbox — an ANONYMOUS-SENDER primitive). These
 *     are the SAME crypto-core primitives buildSealedKeys/sealDek use.
 *   - We attach NO author key id, NO Ed25519 signature, and NO sealedKey to the
 *     reporter. The wire CirsSubmission is exactly { alg, nonce, ciphertext,
 *     sealedKey } — no submitter field exists.
 *   - The DEK is WIPED immediately after sealing.
 *
 * The DEK seal uses the SAME org public identity resolution as the record
 * pipeline (getOrgPublicIdentity), so the org QM can later open it with the org
 * secret key — without it ever being readable by the server.
 *
 * RESIDUAL LIMIT (out of scope, surfaced honestly to the reporter in the UI): the
 * authenticated submit request still reveals the live request's IP/timing to a
 * malicious operator; true network-level anonymity is not provided here.
 */
import { crypto } from '@aidlog/crypto-core';
import { ALGORITHMS, ROUTES, type CirsSubmission } from '@aidlog/contracts';
import { api } from '$lib/api';
import { getOrgPublicIdentity } from '$lib/doc/org';
import { stableStringify } from '$lib/crypto';

/** The structured-but-free-form CIRS form content (all optional German free text). */
export interface CirsFormPayload {
  /** Was ist passiert? */
  ereignis?: string;
  /** Bereich / Kontext (OHNE Patientendaten). */
  kontext?: string;
  /** Beitragende Faktoren. */
  faktoren?: string;
  /** Mögliche Folgen. */
  folgen?: string;
  /** Verbesserungsvorschlag. */
  vorschlag?: string;
  /** Ungefährer Zeitraum (grob, z. B. "KW 23" / "Mai 2026") — bewusst unscharf. */
  zeitraum?: string;
}

/**
 * Encrypt the CIRS payload under a fresh DEK, seal the DEK to the org ONLY, and
 * POST the anonymous submission. Returns the server-assigned report id.
 *
 * NOTE: this builds the submission WITHOUT going through the signing record
 * pipeline (buildRecord/finalizeDraft) on purpose — that pipeline signs and
 * attributes a record to its author, which would break reporter anonymity.
 */
export async function submitCirsReport(payload: CirsFormPayload): Promise<{ id: string }> {
  await crypto.ready();

  // The org public identity is the ONLY recipient of the sealed DEK.
  const org = await getOrgPublicIdentity();

  // Fresh per-report data key. Wiped in `finally`.
  const dek = crypto.randomDek();
  try {
    // Encrypt the canonical JSON payload (AEAD under the DEK).
    const payloadBytes = crypto.utf8(stableStringify(payload));
    const aead = crypto.encryptPayload(payloadBytes, dek);

    // Seal the DEK to the ORG box public key ONLY (anonymous sender). NO author
    // recipient, NO signature.
    const sealed = crypto.sealDek(dek, crypto.fromBase64(org.boxPublicKey));

    const submission: CirsSubmission = {
      alg: ALGORITHMS.aead,
      nonce: crypto.toBase64(aead.nonce),
      ciphertext: crypto.toBase64(aead.ciphertext),
      sealedKey: crypto.toBase64(sealed),
    };

    return api.submitCirs(submission);
  } finally {
    try {
      dek.fill(0);
    } catch {
      /* detached buffer — ignore */
    }
  }
}
