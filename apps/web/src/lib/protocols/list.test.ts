// @vitest-environment node
// Builds real sealed records (so decryptRecord opens them) + drafts, then checks
// listProtocols grouping. Node env so the libsodium Uint8Array realm matches.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { crypto } from '@aidlog/crypto-core';
import type { ProtocolRecord } from '@aidlog/contracts';
import { adopt, lock, getSession } from '$lib/crypto';
import { getDB, _resetDbForTests } from '$lib/store/db';
import { saveDraft, emptyDraft, _resetDraftDbForTests } from '$lib/doc/draftStore';
import { JOURNAL_FLAG_KEY } from '$lib/journal/types';
import { QUICK_FLAG_KEY } from '$lib/quickentry/types';
import { PROTOCOL_ID_KEY } from './marker';
import { listProtocols, PROTOCOL_FALLBACK_LABEL_KEY } from './list';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
  _resetDraftDbForTests();
  await crypto.ready();
  lock();
  const identity = crypto.generateIdentity();
  adopt({ identity, role: 'lead', orgId: 'org-1' });
});

/** Build a record whose DEK is sealed to the CURRENT session, with `payload`. */
function sealedRecord(
  deploymentId: string,
  seq: number,
  payload: Record<string, unknown>,
  opts: { supersedes?: string | null } = {},
): ProtocolRecord {
  const s = getSession()!;
  const dek = crypto.randomDek();
  const aead = crypto.encryptPayload(crypto.utf8(JSON.stringify(payload)), dek);
  const sealed = crypto.sealDek(dek, crypto.fromBase64(s.publicIdentity.boxPublicKey));
  return {
    envelopeVersion: 1,
    id: `${deploymentId}-${seq}`,
    deploymentId,
    seq,
    createdAt: `2026-06-1${seq}T10:00:00.000Z`,
    authorKeyId: s.publicIdentity.keyId,
    payload: {
      alg: 'xchacha20poly1305-ietf',
      nonce: crypto.toBase64(aead.nonce),
      ciphertext: crypto.toBase64(aead.ciphertext),
      schemaId: 'abcde',
      schemaVersion: 1,
    },
    blobs: [],
    sealedKeys: [
      {
        recipientType: 'org',
        recipientKeyId: s.publicIdentity.keyId,
        alg: 'x25519-sealedbox',
        ciphertext: crypto.toBase64(sealed),
      },
    ],
    prevHash: seq === 0 ? null : 'h',
    recordHash: `rh-${seq}`,
    signature: 'sig',
    alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
    supersedes: opts.supersedes ?? null,
  } as ProtocolRecord;
}

async function putRecords(records: ProtocolRecord[]): Promise<void> {
  const db = await getDB();
  for (const r of records) await db.put('records', r);
}

describe('listProtocols grouping', () => {
  it('groups full protocols + quick contacts, excludes journal entries', async () => {
    const dep = 'dep-1';
    await putRecords([
      sealedRecord(dep, 0, { [PROTOCOL_ID_KEY]: 'proto-A', patient_kennung: 'A.B.' }),
      sealedRecord(dep, 1, {
        [PROTOCOL_ID_KEY]: 'quick-1',
        [QUICK_FLAG_KEY]: true,
        q_beschwerde: 'Kopf',
      }),
      sealedRecord(dep, 2, { [JOURNAL_FLAG_KEY]: true, j_text: 'Lagemeldung' }),
    ]);

    const list = await listProtocols(dep);
    const ids = list.map((p) => p.protocolId).sort();
    expect(ids).toEqual(['proto-A', 'quick-1']); // journal excluded

    const full = list.find((p) => p.protocolId === 'proto-A')!;
    expect(full.status).toBe('final');
    expect(full.isQuick).toBe(false);
    expect(full.label).toBe('A.B.');

    const quick = list.find((p) => p.protocolId === 'quick-1')!;
    expect(quick.isQuick).toBe(true);
    expect(quick.label).toBe('Kopf');
  });

  it('keeps the latest (highest seq) version per protocolId for corrections', async () => {
    const dep = 'dep-2';
    await putRecords([
      sealedRecord(dep, 0, { [PROTOCOL_ID_KEY]: 'proto-X', patient_kennung: 'OLD' }),
      sealedRecord(
        dep,
        1,
        { [PROTOCOL_ID_KEY]: 'proto-X', patient_kennung: 'NEW' },
        { supersedes: 'dep-2-0' },
      ),
    ]);
    const list = await listProtocols(dep);
    expect(list).toHaveLength(1);
    expect(list[0]!.label).toBe('NEW');
    expect(list[0]!.latestRecordId).toBe('dep-2-1');
  });

  it('groups legacy records WITHOUT a protocolId marker under the deploymentId', async () => {
    const dep = 'legacy-dep';
    await putRecords([
      sealedRecord(dep, 0, { patient_kennung: 'L1' }),
      sealedRecord(dep, 1, { patient_kennung: 'L2' }),
    ]);
    const list = await listProtocols(dep);
    expect(list).toHaveLength(1);
    expect(list[0]!.protocolId).toBe(dep);
    // Representative is the latest seq.
    expect(list[0]!.label).toBe('L2');
  });

  it('lists local drafts as status "draft" and merges with finalized records', async () => {
    const dep = 'dep-3';
    await saveDraft({
      ...emptyDraft(dep, 'draft-only', 'abcde', 1),
      values: { patient_kennung: 'D.E.' },
    });
    await putRecords([
      sealedRecord(dep, 0, { [PROTOCOL_ID_KEY]: 'final-1', patient_kennung: 'F.G.' }),
    ]);

    const list = await listProtocols(dep);
    const draft = list.find((p) => p.protocolId === 'draft-only')!;
    const final = list.find((p) => p.protocolId === 'final-1')!;
    expect(draft.status).toBe('draft');
    expect(final.status).toBe('final');
  });

  it('a finalized record supersedes a draft sharing its protocolId', async () => {
    const dep = 'dep-4';
    await saveDraft({
      ...emptyDraft(dep, 'shared', 'abcde', 1),
      values: { patient_kennung: 'WIP' },
    });
    await putRecords([
      sealedRecord(dep, 0, { [PROTOCOL_ID_KEY]: 'shared', patient_kennung: 'DONE' }),
    ]);

    const list = await listProtocols(dep);
    const shared = list.filter((p) => p.protocolId === 'shared');
    expect(shared).toHaveLength(1);
    expect(shared[0]!.status).toBe('final');
    expect(shared[0]!.label).toBe('DONE');
  });

  it('falls back to a neutral label key when no patient/complaint field is present', async () => {
    const dep = 'dep-5';
    await putRecords([sealedRecord(dep, 0, { [PROTOCOL_ID_KEY]: 'p', some_other: 'x' })]);
    const list = await listProtocols(dep);
    expect(list[0]!.label).toBe(PROTOCOL_FALLBACK_LABEL_KEY);
  });

  it('returns [] when locked', async () => {
    lock();
    expect(await listProtocols('dep-x')).toEqual([]);
  });
});
