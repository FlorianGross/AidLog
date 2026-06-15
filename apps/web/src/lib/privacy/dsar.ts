/**
 * lib/privacy/dsar.ts — Auskunft nach Art. 15 DSGVO (DSAR export), CLIENT-SIDE.
 *
 * The server cannot export plaintext — it holds no keys. So a DSAR is an
 * on-device decrypt+export performed by an authorised admin who unlocks the ORG
 * key locally, exactly like the analytics path (see $lib/analytics/run.ts).
 *
 * SECURITY: the org password (caller-held), the org secret, the per-record DEKs
 * and the decrypted payloads exist in memory ONLY for the run. The org secret
 * is zeroed in `finally`; nothing decrypted is persisted or logged. The
 * structured export is returned to the caller, who downloads it explicitly — no
 * data leaves the device otherwise.
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import type { OrgKeyset, ProtocolRecord, SealedKey } from '@aidlog/contracts';
import { ApiClient, api as defaultApi } from '$lib/api';
import { wipeBytes, wipeIdentitySecret } from '$lib/recovery';

/** One decrypted record in subject-access form (latest of each chain position). */
export interface DsarRecord {
  id: string;
  deploymentId: string;
  seq: number;
  createdAt: string;
  supersedes: string | null;
  /** The decrypted protocol payload (the personal data held for this subject). */
  payload: Record<string, unknown>;
}

/** The structured Art. 15 export document (contains personal data — local only). */
export interface DsarExport {
  kind: 'dsar-art15';
  generatedAt: string;
  deploymentId: string;
  recordCount: number;
  /** records that could not be opened (e.g. missing org wrapper) — counted only. */
  skipped: number;
  records: DsarRecord[];
}

export interface DsarArgs {
  keyset: OrgKeyset;
  /** ORG password — used transiently to unwrap the org key, never stored. */
  orgPassword: string;
  /** Restrict the export to one deployment (non-secret routing metadata). */
  deploymentId: string;
  client?: ApiClient;
}

/** Find this record's ORG-sealed DEK wrapper (scope=org returns only these). */
function orgWrapper(record: ProtocolRecord): SealedKey | undefined {
  return record.sealedKeys.find((k) => k.recipientType === 'org');
}

/**
 * Build the Art. 15 export for one deployment by decrypting its records
 * on-device with the org key. Throws on a wrong org password (AEAD auth
 * failure). The org secret is wiped before returning.
 */
export async function buildDsarExport(args: DsarArgs): Promise<DsarExport> {
  const client = args.client ?? defaultApi;
  await crypto.ready();

  let orgIdentity: IdentityKeyPair | null = await crypto.unwrapIdentity(
    args.keyset.wrappedSecret,
    args.orgPassword,
  );

  const out: DsarRecord[] = [];
  let skipped = 0;

  try {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const res = await client.syncOrg(cursor);
      for (const record of res.records) {
        if (record.deploymentId !== args.deploymentId) continue;
        const sealed = orgWrapper(record);
        if (!sealed) {
          skipped++;
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
          wipeBytes(payloadBytes);
          const payload =
            parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
          out.push({
            id: record.id,
            deploymentId: record.deploymentId,
            seq: record.seq,
            createdAt: record.createdAt,
            supersedes: record.supersedes ?? null,
            payload,
          });
        } catch {
          skipped++;
        } finally {
          wipeBytes(dek);
        }
      }
      cursor = res.cursor;
      hasMore = res.hasMore;
    }

    out.sort((a, b) => a.seq - b.seq);
    return {
      kind: 'dsar-art15',
      generatedAt: new Date().toISOString(),
      deploymentId: args.deploymentId,
      recordCount: out.length,
      skipped,
      records: out,
    };
  } finally {
    wipeIdentitySecret(orgIdentity);
    orgIdentity = null;
  }
}

/** Serialise the DSAR export as pretty JSON for download. */
export function dsarToJson(exp: DsarExport): string {
  return JSON.stringify(exp, null, 2);
}
