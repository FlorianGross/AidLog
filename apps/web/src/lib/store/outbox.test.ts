// @vitest-environment node
// Uses crypto-core (libsodium) for base64 of ciphertext; run in Node so the
// Uint8Array realm matches (jsdom's differs and libsodium rejects it).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { crypto } from '@aidlog/crypto-core';
import { enqueue, flush, pending, pendingCount } from './outbox';
import { _resetDbForTests } from './db';
import { ApiClient } from '../api';
import type { ProtocolRecord } from '@aidlog/contracts';

function fakeRecord(id: string, seq: number): ProtocolRecord {
  return {
    envelopeVersion: 1,
    id,
    deploymentId: 'dep-1',
    seq,
    createdAt: '2026-06-11T10:00:00.000Z',
    authorKeyId: 'k',
    payload: {
      alg: 'xchacha20poly1305-ietf',
      nonce: 'n',
      ciphertext: 'c',
      schemaId: 's',
      schemaVersion: 1,
    },
    blobs: [],
    sealedKeys: [],
    prevHash: seq === 0 ? null : 'h',
    recordHash: 'rh',
    signature: 'sig',
    alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
    supersedes: null,
  };
}

describe('offline outbox queue persists and flushes', () => {
  beforeEach(() => {
    // fresh in-memory IndexedDB per test
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    _resetDbForTests();
  });

  it('persists enqueued ciphertext records across a fresh DB connection', async () => {
    await crypto.ready();
    await enqueue({
      record: fakeRecord('r0', 0),
      blobCiphertexts: [
        { blobId: 'b0', mediaType: 'image/png', ciphertext: new Uint8Array([1, 2, 3]) },
      ],
    });
    expect(await pendingCount()).toBe(1);

    // simulate a reload: drop the cached connection, reopen
    _resetDbForTests();
    const items = await pending();
    expect(items).toHaveLength(1);
    expect(items[0]!.record.id).toBe('r0');
    expect(items[0]!.blobs[0]!.blobId).toBe('b0');
    // ciphertext is stored base64 (never raw plaintext)
    expect(typeof items[0]!.blobs[0]!.ciphertextB64).toBe('string');
  });

  it('flushes queued records to the API in chain order and clears them', async () => {
    await crypto.ready();
    await enqueue({ record: fakeRecord('r1', 1), blobCiphertexts: [] });
    await enqueue({ record: fakeRecord('r0', 0), blobCiphertexts: [] });

    const client = new ApiClient('');
    const appended: string[] = [];
    vi.spyOn(client, 'appendRecord').mockImplementation(async (rec) => {
      appended.push(rec.id);
      return { id: rec.id, receivedAt: 'now', seq: rec.seq };
    });

    const res = await flush(client);
    expect(res.delivered).toBe(2);
    expect(res.remaining).toBe(0);
    // delivered in seq order: r0 (0) before r1 (1)
    expect(appended).toEqual(['r0', 'r1']);
    expect(await pendingCount()).toBe(0);
  });

  it('uploads blob ciphertext before appending and keeps failures queued', async () => {
    await crypto.ready();
    await enqueue({
      record: fakeRecord('r0', 0),
      blobCiphertexts: [
        { blobId: 'b0', mediaType: 'image/png', ciphertext: new Uint8Array([9, 9, 9]) },
      ],
    });

    const client = new ApiClient('');
    const ticket = {
      blobId: 'b0',
      uploadUrl: 'https://blob.example/put',
      method: 'PUT' as const,
      expiresAt: 'later',
    };
    const blobTicket = vi.spyOn(client, 'blobTicket').mockResolvedValue(ticket);
    const uploadBlob = vi.spyOn(client, 'uploadBlob').mockResolvedValue();

    // First attempt: appendRecord fails → item stays queued with error.
    const appendSpy = vi
      .spyOn(client, 'appendRecord')
      .mockRejectedValueOnce(new Error('network down'));
    const r1 = await flush(client);
    expect(blobTicket).toHaveBeenCalledWith('b0', 3);
    expect(uploadBlob).toHaveBeenCalledOnce();
    expect(r1.failed).toBe(1);
    expect(r1.remaining).toBe(1);
    const stillQueued = await pending();
    expect(stillQueued[0]!.attempts).toBe(1);
    expect(stillQueued[0]!.lastError).toContain('network down');

    // Second attempt succeeds → queue clears.
    appendSpy.mockResolvedValue({ id: 'r0', receivedAt: 'now', seq: 0 });
    const r2 = await flush(client);
    expect(r2.delivered).toBe(1);
    expect(await pendingCount()).toBe(0);
  });
});
