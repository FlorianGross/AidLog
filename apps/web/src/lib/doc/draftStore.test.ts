// @vitest-environment node
// Uses crypto-core (libsodium) for sealing/AEAD of the draft; run in Node so the
// Uint8Array realm matches (jsdom's differs and libsodium rejects it).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { crypto } from '@aidlog/crypto-core';
import { adopt, lock } from '$lib/crypto';
import {
  saveDraft,
  loadDraft,
  listDrafts,
  markDraftFinalized,
  deleteDraft,
  emptyDraft,
  newProtocolId,
  draftKey,
  _resetDraftDbForTests,
  type Draft,
} from './draftStore';

const DB_NAME = 'aidlog-drafts';

function unlockTestSession(): void {
  const identity = crypto.generateIdentity();
  adopt({ identity, role: 'helper', orgId: 'org-1' });
}

beforeEach(async () => {
  // Fresh IndexedDB realm + module DB-cache per test.
  globalThis.indexedDB = new IDBFactory();
  _resetDraftDbForTests();
  await crypto.ready();
  lock();
});

function mkDraft(deploymentId: string, protocolId: string, values: Record<string, unknown>): Draft {
  return { ...emptyDraft(deploymentId, protocolId, 'abcde', 1), values };
}

describe('draftStore multi-protocol keying', () => {
  it('stores two drafts under one deployment that coexist', async () => {
    unlockTestSession();
    const dep = 'dep-1';
    const p1 = newProtocolId();
    const p2 = newProtocolId();
    expect(p1).not.toBe(p2);

    await saveDraft(mkDraft(dep, p1, { patient_kennung: 'A.B.' }));
    await saveDraft(mkDraft(dep, p2, { patient_kennung: 'C.D.' }));

    const d1 = await loadDraft(dep, p1);
    const d2 = await loadDraft(dep, p2);
    expect(d1?.values.patient_kennung).toBe('A.B.');
    expect(d2?.values.patient_kennung).toBe('C.D.');
    expect(d1?.protocolId).toBe(p1);
    expect(d2?.protocolId).toBe(p2);
  });

  it('listDrafts returns all of a deployment’s drafts and isolates by deployment', async () => {
    unlockTestSession();
    await saveDraft(mkDraft('dep-A', 'pa1', { q_beschwerde: 'x' }));
    await saveDraft(mkDraft('dep-A', 'pa2', { q_beschwerde: 'y' }));
    await saveDraft(mkDraft('dep-B', 'pb1', { q_beschwerde: 'z' }));

    const a = await listDrafts('dep-A');
    const b = await listDrafts('dep-B');
    expect(a.map((d) => d.protocolId).sort()).toEqual(['pa1', 'pa2']);
    expect(b.map((d) => d.protocolId)).toEqual(['pb1']);
  });

  it('markDraftFinalized + deleteDraft target one protocol only', async () => {
    unlockTestSession();
    const dep = 'dep-2';
    await saveDraft(mkDraft(dep, 'p1', {}));
    await saveDraft(mkDraft(dep, 'p2', {}));

    await markDraftFinalized(dep, 'p1');
    expect((await loadDraft(dep, 'p1'))?.finalized).toBe(true);
    expect((await loadDraft(dep, 'p2'))?.finalized).toBe(false);

    await deleteDraft(dep, 'p1');
    expect(await loadDraft(dep, 'p1')).toBeUndefined();
    expect(await loadDraft(dep, 'p2')).toBeDefined();
  });

  it('draftKey composes deploymentId:protocolId', () => {
    expect(draftKey('d', 'p')).toBe('d:p');
  });
});

describe('draftStore v1→v2 migration', () => {
  it('migrates a legacy single-per-deployment draft to protocolId === deploymentId', async () => {
    // Build a v1 DB by hand (keyPath 'deploymentId') and insert a legacy row that
    // is a real, decryptable draft for the current session.
    const dep = 'legacy-dep';
    // Encrypt a legacy draft body exactly like saveDraft would (minus the new keys).
    const s = adoptedSession();
    const dek = crypto.randomDek();
    const inner = { values: { patient_kennung: 'LEG' }, signatures: [], photos: [] };
    const aead = crypto.encryptPayload(crypto.utf8(JSON.stringify(inner)), dek);
    const sealed = crypto.sealDek(dek, crypto.fromBase64(s.publicIdentity.boxPublicKey));
    const legacyRow = {
      deploymentId: dep,
      schemaId: 'abcde',
      schemaVersion: 1,
      finalized: false,
      updatedAt: '2026-06-01T00:00:00.000Z',
      sealedDek: crypto.toBase64(sealed),
      sealedFor: s.publicIdentity.keyId,
      nonce: crypto.toBase64(aead.nonce),
      ciphertext: crypto.toBase64(aead.ciphertext),
    };

    await new Promise<void>((resolve, reject) => {
      const open = globalThis.indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        open.result.createObjectStore('drafts', { keyPath: 'deploymentId' });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put(legacyRow);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });

    // Now open via the app code path → triggers the v2 upgrade/migration.
    const migrated = await loadDraft(dep, dep); // default protocolId === deploymentId
    expect(migrated).toBeDefined();
    expect(migrated?.protocolId).toBe(dep);
    expect(migrated?.values.patient_kennung).toBe('LEG');

    // It is also discoverable via the by-deployment index.
    const all = await listDrafts(dep);
    expect(all).toHaveLength(1);
    expect(all[0]!.protocolId).toBe(dep);
  });
});

// Helper: re-adopt and return the session (adopt replaces any prior one).
function adoptedSession() {
  const identity = crypto.generateIdentity();
  return adopt({ identity, role: 'helper', orgId: 'org-1' });
}
