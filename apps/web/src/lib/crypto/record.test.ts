// @vitest-environment node
// crypto-core's libsodium rejects jsdom's cross-realm Uint8Array ("unsupported
// input type"); run this suite in the Node environment like crypto-core itself.
import { describe, it, expect, beforeAll } from 'vitest';
import { crypto } from '@aidlog/crypto-core';
import { buildRecord, decryptRecord } from './record';
import { exampleSchema } from '../forms/example-schema';

describe('client crypto wrapper round-trips a ProtocolRecord via crypto-core', () => {
  beforeAll(async () => {
    await crypto.ready();
  });

  it('builds → seals → signs, then decrypts back to the original payload', async () => {
    const org = crypto.generateIdentity();
    const helper = crypto.generateIdentity();
    const orgPub = crypto.toPublicIdentity(org);
    const helperPub = crypto.toPublicIdentity(helper);

    const payload = {
      timestamp: '2026-06-11T10:30:00.000Z',
      location: 'Post A',
      patientPseudonym: 'Patient 9',
      ageBand: '18-39',
      complaint: 'Headache',
      vitals: { spo2: 99, hf: 72 },
    };

    const { record } = await buildRecord({
      deploymentId: 'dep-1',
      seq: 0,
      prevHash: null,
      author: helper,
      org: orgPub,
      helper: helperPub,
      schema: { schemaId: exampleSchema.schemaId, version: exampleSchema.version },
      payload,
    });

    // Wire-shape sanity. Here the author IS the helper (author: helper,
    // helper: helperPub for the SAME identity), so the persistent 'author'
    // wrapper buildRecord always adds is DEDUPED against the helper wrapper —
    // exactly one wrapper addresses the author's keyId. Result: org + helper.
    expect(record.seq).toBe(0);
    expect(record.prevHash).toBeNull();
    expect(record.payload.schemaId).toBe(exampleSchema.schemaId);
    expect(record.sealedKeys).toHaveLength(2);
    expect(record.sealedKeys.map((k) => k.recipientType).sort()).toEqual(['helper', 'org']);
    // No duplicate wrapper for the author's own keyId.
    expect(record.sealedKeys.filter((k) => k.recipientKeyId === helperPub.keyId)).toHaveLength(1);

    // Signature + hash verify through crypto-core (authorKeyId === base64 signPub)
    expect(crypto.verifyRecord(record, null)).toBe(true);

    // The helper can read their own entry (shift open).
    const asHelper = await decryptRecord(record, helper);
    expect(asHelper.payload).toEqual(payload);

    // The org lead can also read it (DEK sealed to org).
    const asOrg = await decryptRecord(record, org);
    expect(asOrg.payload).toEqual(payload);
  });

  it("adds a persistent 'author' wrapper the author can open even with NO helper wrapper", async () => {
    // Simulate a CLOSED shift: no helper wrapper is added (helper: null). The
    // author must STILL be able to decrypt their own record via the 'author'
    // wrapper — this is exactly the cross-device / post-shift-close guarantee.
    const org = crypto.generateIdentity();
    const author = crypto.generateIdentity();
    const payload = { timestamp: '2026-06-14T08:00:00.000Z', complaint: 'closed-shift read' };

    const { record } = await buildRecord({
      deploymentId: 'dep-closed',
      seq: 0,
      prevHash: null,
      author,
      authorPublic: crypto.toPublicIdentity(author),
      org: crypto.toPublicIdentity(org),
      helper: null, // shift closed → no transient helper wrapper
      schema: { schemaId: exampleSchema.schemaId, version: exampleSchema.version },
      payload,
    });

    // org + author only (no helper).
    expect(record.sealedKeys.map((k) => k.recipientType).sort()).toEqual(['author', 'org']);
    // The author can still read their own record despite the closed shift.
    const asAuthor = await decryptRecord(record, author);
    expect(asAuthor.payload).toEqual(payload);
  });

  it("dedupes the 'author' wrapper when the author already has a helper wrapper", async () => {
    // The author is also the helper (shift open). They must NOT get two wrappers
    // for the same keyId — one helper wrapper is enough; no duplicate 'author'.
    const org = crypto.generateIdentity();
    const author = crypto.generateIdentity();
    const authorPub = crypto.toPublicIdentity(author);

    const { record } = await buildRecord({
      deploymentId: 'dep-open',
      seq: 0,
      prevHash: null,
      author,
      authorPublic: authorPub,
      org: crypto.toPublicIdentity(org),
      helper: authorPub, // shift open: helper == author
      schema: { schemaId: exampleSchema.schemaId, version: exampleSchema.version },
      payload: { timestamp: '2026-06-14T09:00:00.000Z', complaint: 'open shift' },
    });

    // No duplicate wrapper for the author's keyId: exactly one wrapper addresses it.
    const mine = record.sealedKeys.filter((k) => k.recipientKeyId === authorPub.keyId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.recipientType).toBe('helper');
    // Only org + helper(=author): no separate 'author' wrapper was appended.
    expect(record.sealedKeys.map((k) => k.recipientType).sort()).toEqual(['helper', 'org']);
  });

  it('encrypts and recovers an image blob with the same DEK', async () => {
    const org = crypto.generateIdentity();
    const helper = crypto.generateIdentity();
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);

    const { record, blobCiphertexts } = await buildRecord({
      deploymentId: 'dep-1',
      seq: 1,
      prevHash: record0Hash(),
      author: helper,
      org: crypto.toPublicIdentity(org),
      helper: crypto.toPublicIdentity(helper),
      schema: { schemaId: exampleSchema.schemaId, version: exampleSchema.version },
      payload: {
        timestamp: '2026-06-11T11:00:00.000Z',
        location: 'Post A',
        patientPseudonym: 'P',
        ageBand: 'unknown',
        complaint: 'cut',
      },
      blobs: [{ field: 'photo', mediaType: 'image/png', data: imageBytes, label: 'wound.png' }],
    });

    expect(record.blobs).toHaveLength(1);
    const ctMap: Record<string, Uint8Array> = {};
    for (const b of blobCiphertexts) ctMap[b.blobId] = b.ciphertext;

    const dec = await decryptRecord(record, org, ctMap);
    expect(dec.blobs).toHaveLength(1);
    expect(dec.blobs[0]!.mediaType).toBe('image/png');
    expect([...dec.blobs[0]!.data]).toEqual([...imageBytes]);
  });
});

// helper to provide a non-null prevHash for the second test in isolation.
function record0Hash(): string {
  return crypto.toBase64(crypto.hash(crypto.utf8('seed')));
}
