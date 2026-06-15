// @vitest-environment node
// Verifies finalizeDraft stamps the PROTOCOL_ID_KEY into the (encrypted) payload.
// Node env so the libsodium Uint8Array realm matches.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { crypto } from '@aidlog/crypto-core';
import { adopt, lock, getSession, decryptRecord } from '$lib/crypto';
import { setOrgInfo } from '$lib/crypto';
import { _resetDbForTests } from '$lib/store/db';
import { clearOrgIdentityCache } from './org';
import { finalizeDraft } from './finalize';
import { emptyDraft } from './draftStore';
import { PROTOCOL_ID_KEY } from '$lib/protocols/marker';

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  _resetDbForTests();
  clearOrgIdentityCache();
  await crypto.ready();
  lock();
  const identity = crypto.generateIdentity();
  adopt({ identity, role: 'helper', orgId: 'org-1' });
  // Org public identity so finalize can seal to the org (never to self).
  const org = crypto.generateIdentity();
  setOrgInfo({
    orgId: 'org-1',
    orgName: 'Test',
    identity: crypto.toPublicIdentity(org),
  });
});

describe('finalizeDraft protocolId stamping', () => {
  it('writes the draft.protocolId into the encrypted payload under PROTOCOL_ID_KEY', async () => {
    const draft = {
      ...emptyDraft('dep-1', 'proto-123', 'abcde', 1),
      values: { patient_kennung: 'A.B.' },
    };
    const { record } = await finalizeDraft({ draft, head: undefined, shiftOpen: true });

    // The author is a recipient → decrypt with the session identity and assert the stamp.
    const s = getSession()!;
    const { payload } = await decryptRecord(record, s.identity);
    const obj = payload as Record<string, unknown>;
    expect(obj[PROTOCOL_ID_KEY]).toBe('proto-123');
    expect(obj.patient_kennung).toBe('A.B.');
    expect(record.seq).toBe(0);
  });

  it('does NOT stamp PROTOCOL_ID_KEY when protocolId is empty (journal path)', async () => {
    const draft = {
      ...emptyDraft('dep-1', '', 'event-journal', 1),
      values: { __journal__: true, j_text: 'Lage' },
    };
    const { record } = await finalizeDraft({ draft, head: undefined, shiftOpen: true });
    const s = getSession()!;
    const { payload } = await decryptRecord(record, s.identity);
    const obj = payload as Record<string, unknown>;
    expect(obj[PROTOCOL_ID_KEY]).toBeUndefined();
    expect(obj.__journal__).toBe(true);
  });
});
