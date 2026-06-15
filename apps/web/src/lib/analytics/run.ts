/**
 * analytics/run.ts — orchestrates a CLIENT-SIDE org-analytics run.
 *
 * Flow (admin/lead):
 *   1. GET ROUTES.orgKeyset (PUBLIC identity + password-wrapped secret).
 *   2. unwrapIdentity(orgWrapped, orgPassword) → org IdentityKeyPair (memory only).
 *   3. Pull EVERY org record via api.syncOrg (scope=org): each carries only its
 *      ORG-sealed DEK.
 *   4. For each record: openSealedDek(org wrapper, orgIdentity.box) →
 *      decryptPayload → JSON.parse → keep ONLY as a DecryptedEntry for aggregation.
 *   5. aggregate() → fully anonymised AnalyticsResult.
 *   6. ZERO the org secret + the DEKs; drop all decrypted payloads.
 *
 * SECURITY: the org password (caller-held), the org secret, the per-record DEKs
 * and the decrypted payloads exist in memory ONLY for the run. The org secret is
 * zeroed in `finally`; nothing decrypted is persisted or logged. Only the
 * aggregate result leaves this function.
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import type { OrgKeyset, ProtocolRecord, SealedKey } from '@aidlog/contracts';
import { ApiClient, api as defaultApi } from '$lib/api';
import { wipeBytes, wipeIdentitySecret } from '$lib/recovery';
import { aggregate, type DecryptedEntry } from './aggregate';
import type { AnalyticsResult } from './types';

export interface RunProgress {
  /** records fetched + processed so far. */
  processed: number;
  /** total known so far (grows as pages arrive); undefined until first page. */
  total?: number;
  phase: 'unlocking' | 'fetching' | 'decrypting' | 'aggregating' | 'done';
}

export interface RunArgs {
  keyset: OrgKeyset;
  /** ORG password — used transiently to unwrap the org key, never stored. */
  orgPassword: string;
  /** optional progress callback (records processed). */
  onProgress?: (p: RunProgress) => void;
  /** page size for the org sync (defaults to the server cap). */
  pageSize?: number;
  client?: ApiClient;
  /** how many decrypt failures to tolerate before reporting (default: all skipped). */
}

export interface RunResult {
  analytics: AnalyticsResult;
  /** records that failed to decrypt/parse (e.g. missing org wrapper) — counted, not detailed. */
  skipped: number;
}

/** Find this record's ORG-sealed DEK wrapper (scope=org returns only these). */
function orgWrapper(record: ProtocolRecord): SealedKey | undefined {
  return record.sealedKeys.find((k) => k.recipientType === 'org');
}

export async function runAnalytics(args: RunArgs): Promise<RunResult> {
  const client = args.client ?? defaultApi;
  const report = (p: RunProgress): void => args.onProgress?.(p);

  await crypto.ready();
  report({ processed: 0, phase: 'unlocking' });

  // Unwrap the org identity. Throws on a wrong org password (AEAD auth failure).
  let orgIdentity: IdentityKeyPair | null = await crypto.unwrapIdentity(
    args.keyset.wrappedSecret,
    args.orgPassword,
  );

  const entries: DecryptedEntry[] = [];
  let skipped = 0;

  try {
    let cursor: string | undefined;
    let hasMore = true;
    let processed = 0;

    while (hasMore) {
      report({ processed, phase: 'fetching' });
      const res = await client.syncOrg(cursor, args.pageSize);

      for (const record of res.records) {
        const sealed = orgWrapper(record);
        if (!sealed) {
          skipped++;
          processed++;
          continue;
        }
        let dek: Uint8Array | null = null;
        try {
          dek = crypto.openSealedDek(crypto.fromBase64(sealed.ciphertext), orgIdentity.box);
          const payloadBytes = crypto.decryptPayload(
            {
              alg: record.payload.alg,
              nonce: crypto.fromBase64(record.payload.nonce),
              ciphertext: crypto.fromBase64(record.payload.ciphertext),
            },
            dek,
          );
          const parsed: unknown = JSON.parse(crypto.fromUtf8(payloadBytes));
          // Wipe the plaintext bytes buffer ASAP.
          wipeBytes(payloadBytes);
          const payload =
            parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
          entries.push({
            id: record.id,
            deploymentId: record.deploymentId,
            seq: record.seq,
            createdAt: record.createdAt,
            supersedes: record.supersedes ?? null,
            payload,
          });
        } catch {
          // A record that cannot be opened/parsed (e.g. no org wrapper, tamper)
          // is counted as skipped — never logged with content.
          skipped++;
        } finally {
          wipeBytes(dek);
        }
        processed++;
        if (processed % 25 === 0) report({ processed, phase: 'decrypting' });
      }

      cursor = res.cursor;
      hasMore = res.hasMore;
      report({ processed, phase: 'decrypting' });
    }

    report({ processed, phase: 'aggregating' });
    const analytics = aggregate(entries);
    report({ processed, phase: 'done' });
    return { analytics, skipped };
  } finally {
    // Zero the org secret + drop every decrypted payload from memory.
    wipeIdentitySecret(orgIdentity);
    orgIdentity = null;
    entries.length = 0;
  }
}
