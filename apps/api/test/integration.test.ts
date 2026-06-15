/**
 * DB-backed integration tests. Run with TEST_DATABASE_URL pointing at a
 * privileged Postgres (so the migration can create the aidlog_app role). When
 * unset, every test here is skipped with a clear message.
 *
 * Covers the four required behaviours:
 *   1. append-only enforcement — UPDATE/DELETE on records rejected.
 *   2. hash-chain rejection — wrong prevHash → 409.
 *   3. auth challenge/verify happy path + bad signature rejected.
 *   4. closeShift deletes ONLY helper wrappers (org wrapper survives).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ROUTES, ENVELOPE_VERSION } from '@aidlog/contracts';
import type {
  ProtocolRecord,
  SignableRecord,
  SealedKey,
  AuthChallenge,
  AuthSession,
} from '@aidlog/contracts';
// Runtime modules (crypto-core, db, app) are imported DYNAMICALLY inside
// beforeAll so the heavy crypto/WASM stack only loads when a test DB is
// configured — keeping the offline suite loadable even if optional native deps
// aren't resolvable in the local install.
import type { CryptoCore } from '@aidlog/crypto-core';
import type { DbHandle } from '../src/db/client.js';
import type { sealedKeys as SealedKeysTable } from '../src/db/schema.js';
import { hasDb, TEST_DATABASE_URL, SKIP_REASON } from './helpers.js';

const d = hasDb ? describe : describe.skip;

d(`integration (${hasDb ? 'db present' : SKIP_REASON})`, () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let cc: CryptoCore;
  let sealedKeys: typeof SealedKeysTable;
  let eq: typeof import('drizzle-orm').eq;
  let and: typeof import('drizzle-orm').and;
  let helper: import('@aidlog/crypto-core').IdentityKeyPair;
  let org: import('@aidlog/crypto-core').IdentityKeyPair;
  let orgId: string;
  let helperToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ({ crypto: cc } = await import('@aidlog/crypto-core'));
    const { createDb } = await import('../src/db/client.js');
    const { runMigrations } = await import('../src/db/migrate.js');
    const { buildApp } = await import('../src/app.js');
    const { loadConfig, resetConfigCache } = await import('../src/config.js');
    ({ sealedKeys } = await import('../src/db/schema.js'));
    ({ eq, and } = await import('drizzle-orm'));

    await cc.ready();
    await runMigrations(TEST_DATABASE_URL!);

    resetConfigCache();
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: TEST_DATABASE_URL!,
      SESSION_SECRET: 'integration-secret-long-enough',
      S3_ENDPOINT: 'http://localhost:9000',
      S3_ACCESS_KEY: 'x',
      S3_SECRET_KEY: 'y',
      S3_BUCKET: 'test',
    });

    handle = createDb(config.DATABASE_URL);
    // Blob store is unused in these tests; pass a stub that throws if touched.
    const blobs = {
      presignUpload: async () => {
        throw new Error('not used');
      },
      directUpload: async () => {
        throw new Error('not used');
      },
      ensureBucket: async () => {},
      client: {} as never,
      bucket: 'test',
    };
    app = await buildApp({ ctx: { config, db: handle.db, blobs } });

    org = cc.generateIdentity();
    helper = cc.generateIdentity();
  });

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  // Minimal shape of the light-my-request Response we use (avoids a direct dep).
  interface InjectResponse {
    statusCode: number;
    json<T = unknown>(): T;
  }
  async function inject(method: 'GET' | 'POST', url: string, payload?: unknown, token?: string) {
    const opts: Record<string, unknown> = { method, url };
    if (payload !== undefined) opts.payload = payload;
    if (token) opts.headers = { authorization: `Bearer ${token}` };
    return (await app.inject(opts as never)) as unknown as InjectResponse;
  }

  // --- test fixtures (close over `cc`, set in beforeAll) ---

  function fakeWrapped() {
    return {
      alg: 'xchacha20poly1305-ietf' as const,
      kdf: {
        alg: 'argon2id' as const,
        salt: cc.toBase64(new Uint8Array(16)),
        opsLimit: 2,
        memLimit: 67108864,
      },
      nonce: cc.toBase64(new Uint8Array(24)),
      ciphertext: cc.toBase64(new Uint8Array(48)),
    };
  }

  function sealTo(
    type: 'org' | 'helper',
    identity: { keyId: string; boxPublicKey: string },
  ): SealedKey {
    return {
      recipientType: type,
      recipientKeyId: identity.keyId,
      alg: 'x25519-sealedbox',
      ciphertext: cc.toBase64(cc.sealDek(new Uint8Array(32), cc.fromBase64(identity.boxPublicKey))),
    };
  }

  function signRecord(
    id: import('@aidlog/crypto-core').IdentityKeyPair,
    authorKeyId: string,
    deploymentId: string,
    seq: number,
    prevHash: string | null,
    keys: SealedKey[],
  ): ProtocolRecord {
    const signable: SignableRecord = {
      envelopeVersion: ENVELOPE_VERSION,
      id: crypto.randomUUID(),
      deploymentId,
      seq,
      createdAt: new Date().toISOString(),
      authorKeyId,
      payload: {
        alg: 'xchacha20poly1305-ietf',
        nonce: cc.toBase64(new Uint8Array(24)),
        ciphertext: cc.toBase64(new Uint8Array(16)),
        schemaId: 'default',
        schemaVersion: 1,
      },
      blobs: [],
      sealedKeys: keys,
      prevHash,
      alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
      supersedes: null,
    };
    const recordHash = cc.toBase64(cc.computeRecordHash(signable));
    const signature = cc.toBase64(cc.sign(cc.computeRecordHash(signable), id.sign.secretKey));
    return { ...signable, recordHash, signature };
  }

  it('registers org + helper and authenticates via challenge/verify', async () => {
    // Org bootstrap now also provisions an admin account (the org key acts as
    // admin too). Self-registration is disabled; the helper is onboarded via an
    // admin-issued invitation, which is the canonical account-creation path.
    const orgPub = cc.toPublicIdentity(org);
    const adminId = cc.generateIdentity();
    const adminPub = cc.toPublicIdentity(adminId);
    const orgReg = await app.inject({
      method: 'POST',
      url: ROUTES.registerOrg,
      payload: {
        orgName: 'Test Org',
        identity: orgPub,
        wrappedSecret: fakeWrapped(),
        admin: { displayName: 'Admin', identity: adminPub, wrappedSecret: fakeWrapped() },
      },
    });
    expect([200, 201]).toContain(orgReg.statusCode);
    orgId = orgReg.json().orgId;

    // Self-registration is closed (410 Gone).
    const helperPub = cc.toPublicIdentity(helper);
    const closed = await app.inject({
      method: 'POST',
      url: ROUTES.registerHelper,
      payload: {
        orgId,
        displayName: 'Helper One',
        identity: helperPub,
        wrappedSecret: fakeWrapped(),
      },
    });
    expect(closed.statusCode).toBe(410);

    // Admin logs in, issues an invitation, helper redeems it.
    const adminChallenge = await app.inject({
      method: 'POST',
      url: ROUTES.authChallenge,
      payload: { keyId: adminPub.keyId },
    });
    const adminChallengeStr = (adminChallenge.json() as AuthChallenge).challenge;
    const adminSig = cc.toBase64(cc.sign(cc.fromBase64(adminChallengeStr), adminId.sign.secretKey));
    const adminVerify = await app.inject({
      method: 'POST',
      url: ROUTES.authVerify,
      payload: { keyId: adminPub.keyId, challenge: adminChallengeStr, signature: adminSig },
    });
    adminToken = (adminVerify.json() as AuthSession).token;

    const invite = await app.inject({
      method: 'POST',
      url: ROUTES.invitations,
      payload: { role: 'helper', displayName: 'Helper One' },
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect([200, 201]).toContain(invite.statusCode);
    const inviteCode = (invite.json() as { code: string }).code;

    const helperReg = await app.inject({
      method: 'POST',
      url: ROUTES.redeemInvitation,
      payload: {
        code: inviteCode,
        displayName: 'Helper One',
        identity: helperPub,
        wrappedSecret: fakeWrapped(),
      },
    });
    expect([200, 201]).toContain(helperReg.statusCode);

    // challenge
    const ch = await app.inject({
      method: 'POST',
      url: ROUTES.authChallenge,
      payload: { keyId: helperPub.keyId },
    });
    expect([200, 201]).toContain(ch.statusCode);
    const challenge = (ch.json() as AuthChallenge).challenge;

    // bad signature rejected
    const badSig = cc.toBase64(cc.sign(cc.fromBase64(challenge), org.sign.secretKey)); // wrong key
    const bad = await app.inject({
      method: 'POST',
      url: ROUTES.authVerify,
      payload: { keyId: helperPub.keyId, challenge, signature: badSig },
    });
    expect(bad.statusCode).toBe(401);

    // need a fresh challenge (single-use consumed above)
    const ch2 = await app.inject({
      method: 'POST',
      url: ROUTES.authChallenge,
      payload: { keyId: helperPub.keyId },
    });
    const challenge2 = (ch2.json() as AuthChallenge).challenge;
    const goodSig = cc.toBase64(cc.sign(cc.fromBase64(challenge2), helper.sign.secretKey));
    const ok = await app.inject({
      method: 'POST',
      url: ROUTES.authVerify,
      payload: { keyId: helperPub.keyId, challenge: challenge2, signature: goodSig },
    });
    expect([200, 201]).toContain(ok.statusCode);
    helperToken = (ok.json() as AuthSession).token;
    expect(helperToken).toBeTruthy();
  });

  it('appends a record, then rejects a wrong-prevHash record with 409', async () => {
    const deploymentId = crypto.randomUUID();
    const helperPub = cc.toPublicIdentity(helper);
    const orgPub = cc.toPublicIdentity(org);

    const r0 = signRecord(helper, helperPub.keyId, deploymentId, 0, null, [
      sealTo('org', orgPub),
      sealTo('helper', helperPub),
    ]);
    const a0 = await inject('POST', ROUTES.records, { record: r0 }, helperToken);
    expect([200, 201]).toContain(a0.statusCode);

    // record with WRONG prevHash → 409
    const rBad = signRecord(helper, helperPub.keyId, deploymentId, 1, 'AAAA', [
      sealTo('org', orgPub),
    ]);
    const aBad = await inject('POST', ROUTES.records, { record: rBad }, helperToken);
    expect(aBad.statusCode).toBe(409);

    // correct chain continuation → ok
    const r1 = signRecord(helper, helperPub.keyId, deploymentId, 1, r0.recordHash, [
      sealTo('org', orgPub),
      sealTo('helper', helperPub),
    ]);
    const a1 = await inject('POST', ROUTES.records, { record: r1 }, helperToken);
    expect([200, 201]).toContain(a1.statusCode);
  });

  it('enforces append-only: UPDATE and DELETE on records are rejected by the DB', async () => {
    // Directly attempt mutation, bypassing the API, to prove the trigger fires.
    await expect(handle.sql`UPDATE records SET seq = seq WHERE true`).rejects.toThrow(
      /append-only/i,
    );
    await expect(handle.sql`DELETE FROM records WHERE true`).rejects.toThrow(/append-only/i);
  });

  it('closeShift deletes only helper wrappers, leaving the org wrapper intact', async () => {
    const deploymentId = crypto.randomUUID();
    const helperPub = cc.toPublicIdentity(helper);
    const orgPub = cc.toPublicIdentity(org);
    const rec = signRecord(helper, helperPub.keyId, deploymentId, 0, null, [
      sealTo('org', orgPub),
      sealTo('helper', helperPub),
    ]);
    const appended = await inject('POST', ROUTES.records, { record: rec }, helperToken);
    expect([200, 201]).toContain(appended.statusCode);

    const before = await handle.db
      .select()
      .from(sealedKeys)
      .where(eq(sealedKeys.deploymentId, deploymentId));
    expect(before.length).toBe(2);

    const close = await inject(
      'POST',
      ROUTES.closeShift,
      { deploymentId, helperKeyId: helperPub.keyId },
      helperToken,
    );
    expect(close.statusCode).toBe(200);

    const after = await handle.db
      .select()
      .from(sealedKeys)
      .where(eq(sealedKeys.deploymentId, deploymentId));
    expect(after.length).toBe(1);
    expect(after[0]!.recipientType).toBe('org');

    // helper wrapper specifically gone
    const helperWrappers = await handle.db
      .select()
      .from(sealedKeys)
      .where(
        and(eq(sealedKeys.deploymentId, deploymentId), eq(sealedKeys.recipientType, 'helper')),
      );
    expect(helperWrappers.length).toBe(0);
  });

  it('scope=org lets an admin read ALL org records with ONLY org-sealed keys', async () => {
    // Append a fresh deployment authored by the helper, with org + helper wrappers.
    const deploymentId = crypto.randomUUID();
    const helperPub = cc.toPublicIdentity(helper);
    const orgPub = cc.toPublicIdentity(org);
    const rec = signRecord(helper, helperPub.keyId, deploymentId, 0, null, [
      sealTo('org', orgPub),
      sealTo('helper', helperPub),
    ]);
    const appended = await inject('POST', ROUTES.records, { record: rec }, helperToken);
    expect([200, 201]).toContain(appended.statusCode);

    // Admin pulls the whole org with scope=org.
    const res = await inject('GET', `${ROUTES.sync}?scope=org`, undefined, adminToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: ProtocolRecord[]; hasMore: boolean; cursor: string }>();

    // The admin did NOT author these helper records, yet sees them under scope=org.
    const seen = body.records.find((r) => r.id === rec.id);
    expect(seen).toBeDefined();
    // Every returned record carries ONLY org-type sealed keys (never helper/cosigner).
    for (const r of body.records) {
      expect(r.sealedKeys.length).toBeGreaterThan(0);
      expect(r.sealedKeys.every((k) => k.recipientType === 'org')).toBe(true);
    }
  });

  it('scope=org is forbidden for a helper (403)', async () => {
    const res = await inject('GET', `${ROUTES.sync}?scope=org`, undefined, helperToken);
    expect(res.statusCode).toBe(403);
  });

  it('scope=self (default) is unchanged: a helper still sees only own records', async () => {
    const res = await inject('GET', `${ROUTES.sync}`, undefined, helperToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: ProtocolRecord[] }>();
    const helperKeyId = cc.toPublicIdentity(helper).keyId;
    for (const r of body.records) {
      expect(r.authorKeyId).toBe(helperKeyId);
    }
  });
});
