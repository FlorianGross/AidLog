/**
 * cirs/decrypt.ts — QM-side decryption of ANONYMOUS CIRS reports.
 *
 * Mirrors the admin "Auswertung" org-key path (analytics/run.ts): the QM/admin
 * unlocks the ORG secret key from the org keyset with the org password (in memory
 * only), then opens each report's ORG-sealed DEK and decrypts the payload
 * LOCALLY. The server never sees plaintext. The org secret + DEKs are wiped after.
 *
 * A CIRS report carries NO reporter attribution, so nothing here can (or does)
 * reveal who submitted it — decryption yields only the free-form content.
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import type { CirsReport, OrgKeyset } from '@aidlog/contracts';
import { wipeBytes, wipeIdentitySecret } from '$lib/recovery';
import type { CirsFormPayload } from './submit';

/** A report joined with its decrypted content (or a decrypt-failure marker). */
export interface DecryptedCirsReport {
  id: string;
  createdAt: string;
  status: CirsReport['status'];
  /** Decrypted free-form content, or null if this report could not be opened. */
  content: CirsFormPayload | null;
}

/**
 * Unlock the org key with `orgPassword`, then decrypt every report. The org
 * secret + per-report DEKs live in memory ONLY for this call and are wiped in
 * `finally`. Throws (AEAD auth failure) on a wrong org password.
 */
export async function decryptCirsReports(
  keyset: OrgKeyset,
  orgPassword: string,
  reports: CirsReport[],
): Promise<DecryptedCirsReport[]> {
  await crypto.ready();

  // Throws on a wrong org password (AEAD auth failure) — surfaced by the caller.
  let orgIdentity: IdentityKeyPair | null = await crypto.unwrapIdentity(
    keyset.wrappedSecret,
    orgPassword,
  );

  try {
    return reports.map((report) => {
      let dek: Uint8Array | null = null;
      try {
        dek = crypto.openSealedDek(crypto.fromBase64(report.sealedKey), orgIdentity!.box);
        const payloadBytes = crypto.decryptPayload(
          {
            alg: report.alg,
            nonce: crypto.fromBase64(report.nonce),
            ciphertext: crypto.fromBase64(report.ciphertext),
          },
          dek,
        );
        const parsed: unknown = JSON.parse(crypto.fromUtf8(payloadBytes));
        wipeBytes(payloadBytes);
        const content = parsed && typeof parsed === 'object' ? (parsed as CirsFormPayload) : {};
        return { id: report.id, createdAt: report.createdAt, status: report.status, content };
      } catch {
        // A report that cannot be opened/parsed is surfaced as content: null —
        // never logged with content.
        return { id: report.id, createdAt: report.createdAt, status: report.status, content: null };
      } finally {
        wipeBytes(dek);
      }
    });
  } finally {
    wipeIdentitySecret(orgIdentity);
    orgIdentity = null;
  }
}
