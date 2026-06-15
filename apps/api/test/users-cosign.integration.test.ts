/**
 * DB-backed integration tests for the user/role system, invitations, and
 * co-signature. Skipped (loudly) unless TEST_DATABASE_URL points at a
 * privileged Postgres, exactly like integration.test.ts.
 *
 * Covers:
 *   - org bootstrap creates an admin account; admin can log in.
 *   - invitation create → redeem happy path; redeemed user can log in.
 *   - redeem with a bad code is rejected; a redeemed code cannot be reused.
 *   - role guard: a helper cannot create invitations or manage users.
 *   - last-admin guard: cannot demote/disable the final admin.
 *   - co-signature: good signature accepted, tampered rejected.
 *   - sealedKeys append adds a cosigner grant WITHOUT mutating the record.
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
  CreateInvitationResponse,
  RedeemInvitationResponse,
  UserListResponse,
  CosignatureRequest as CosignatureRequestDto,
} from '@aidlog/contracts';
import type { CryptoCore, IdentityKeyPair } from '@aidlog/crypto-core';
import type { DbHandle } from '../src/db/client.js';
import { hasDb, TEST_DATABASE_URL, SKIP_REASON } from './helpers.js';

const d = hasDb ? describe : describe.skip;

d(`users + cosign integration (${hasDb ? 'db present' : SKIP_REASON})`, () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let cc: CryptoCore;
  let eq: typeof import('drizzle-orm').eq;
  let records: typeof import('../src/db/schema.js').records;
  let sealedKeys: typeof import('../src/db/schema.js').sealedKeys;

  let org: IdentityKeyPair;
  let admin: IdentityKeyPair;
  let orgId: string;
  let adminToken: string;

  beforeAll(async () => {
    ({ crypto: cc } = await import('@aidlog/crypto-core'));
    const { createDb } = await import('../src/db/client.js');
    const { runMigrations } = await import('../src/db/migrate.js');
    const { buildApp } = await import('../src/app.js');
    const { loadConfig, resetConfigCache } = await import('../src/config.js');
    ({ eq } = await import('drizzle-orm'));
    ({ records, sealedKeys } = await import('../src/db/schema.js'));

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
    admin = cc.generateIdentity();
  });

  afterAll(async () => {
    await app?.close();
    await handle?.close();
  });

  interface InjectResponse {
    statusCode: number;
    json<T = unknown>(): T;
  }
  async function inject(
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    payload?: unknown,
    token?: string,
  ) {
    const opts: Record<string, unknown> = { method, url };
    if (payload !== undefined) opts.payload = payload;
    if (token) opts.headers = { authorization: `Bearer ${token}` };
    return (await app.inject(opts as never)) as unknown as InjectResponse;
  }

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

  async function login(id: IdentityKeyPair): Promise<string> {
    const pub = cc.toPublicIdentity(id);
    const ch = await inject('POST', ROUTES.authChallenge, { keyId: pub.keyId });
    const challenge = ch.json<AuthChallenge>().challenge;
    const sig = cc.toBase64(cc.sign(cc.fromBase64(challenge), id.sign.secretKey));
    const ok = await inject('POST', ROUTES.authVerify, {
      keyId: pub.keyId,
      challenge,
      signature: sig,
    });
    return ok.json<AuthSession>().token;
  }

  function sealTo(
    type: 'org' | 'helper' | 'cosigner',
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
    id: IdentityKeyPair,
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

  it('bootstraps an org WITH an admin account, and the admin can log in', async () => {
    const orgPub = cc.toPublicIdentity(org);
    const adminPub = cc.toPublicIdentity(admin);
    const reg = await inject('POST', ROUTES.registerOrg, {
      orgName: 'Cosign Org',
      identity: orgPub,
      wrappedSecret: fakeWrapped(),
      admin: { displayName: 'Admin One', identity: adminPub, wrappedSecret: fakeWrapped() },
    });
    expect([200, 201]).toContain(reg.statusCode);
    orgId = reg.json<{ orgId: string }>().orgId;

    adminToken = await login(admin);
    expect(adminToken).toBeTruthy();

    // GET orgInfo returns the public org identity.
    const info = await inject('GET', ROUTES.orgInfo, undefined, adminToken);
    expect(info.statusCode).toBe(200);
    expect(info.json<{ orgId: string }>().orgId).toBe(orgId);
  });

  it('self-registration (registerHelper) is disabled (410)', async () => {
    const stranger = cc.toPublicIdentity(cc.generateIdentity());
    const res = await inject('POST', ROUTES.registerHelper, {
      orgId,
      displayName: 'Nope',
      identity: stranger,
      wrappedSecret: fakeWrapped(),
    });
    expect(res.statusCode).toBe(410);
  });

  it('admin creates an invitation, a helper redeems it and can log in', async () => {
    const create = await inject(
      'POST',
      ROUTES.invitations,
      { role: 'helper', displayName: 'Helper Two' },
      adminToken,
    );
    expect([200, 201]).toContain(create.statusCode);
    const { code, invitation } = create.json<CreateInvitationResponse>();
    expect(code).toBeTruthy();
    expect(invitation.status).toBe('pending');

    const helper = cc.generateIdentity();
    const helperPub = cc.toPublicIdentity(helper);
    const redeem = await inject('POST', ROUTES.redeemInvitation, {
      code,
      displayName: 'Helper Two',
      identity: helperPub,
      wrappedSecret: fakeWrapped(),
    });
    expect([200, 201]).toContain(redeem.statusCode);
    const body = redeem.json<RedeemInvitationResponse>();
    expect(body.account.role).toBe('helper');
    expect(body.org.orgId).toBe(orgId);

    const token = await login(helper);
    expect(token).toBeTruthy();

    // Reusing the same code now fails (single-use).
    const reuse = await inject('POST', ROUTES.redeemInvitation, {
      code,
      displayName: 'Helper Two again',
      identity: cc.toPublicIdentity(cc.generateIdentity()),
      wrappedSecret: fakeWrapped(),
    });
    expect(reuse.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects redeeming a bad/unknown code', async () => {
    const res = await inject('POST', ROUTES.redeemInvitation, {
      code: 'not-a-real-code',
      displayName: 'X',
      identity: cc.toPublicIdentity(cc.generateIdentity()),
      wrappedSecret: fakeWrapped(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('role guard: a helper cannot create invitations or list users', async () => {
    const create = await inject('POST', ROUTES.invitations, { role: 'helper' }, adminToken);
    const { code } = create.json<CreateInvitationResponse>();
    const helper = cc.generateIdentity();
    await inject('POST', ROUTES.redeemInvitation, {
      code,
      displayName: 'Guarded Helper',
      identity: cc.toPublicIdentity(helper),
      wrappedSecret: fakeWrapped(),
    });
    const helperToken = await login(helper);

    const inv = await inject('POST', ROUTES.invitations, { role: 'helper' }, helperToken);
    expect(inv.statusCode).toBe(403);
    const users = await inject('GET', ROUTES.users, undefined, helperToken);
    expect(users.statusCode).toBe(403);
  });

  it('last-admin guard: cannot demote the only admin', async () => {
    const list = await inject('GET', ROUTES.users, undefined, adminToken);
    const me = list.json<UserListResponse>().users.find((u) => u.role === 'admin');
    expect(me).toBeTruthy();
    const res = await inject(
      'PATCH',
      ROUTES.users,
      { helperId: me!.helperId, role: 'helper' },
      adminToken,
    );
    expect(res.statusCode).toBe(409);
  });

  it('cosign: good signature accepted, tampered rejected; sealedKeys append does not mutate the record', async () => {
    // Admin authors a record (admin keyId is a valid author).
    const deploymentId = crypto.randomUUID();
    const adminPub = cc.toPublicIdentity(admin);
    const orgPub = cc.toPublicIdentity(org);
    const rec = signRecord(admin, adminPub.keyId, deploymentId, 0, null, [
      sealTo('org', orgPub),
      sealTo('helper', adminPub),
    ]);
    const appended = await inject('POST', ROUTES.records, { record: rec }, adminToken);
    expect([200, 201]).toContain(appended.statusCode);

    // A cosigner (lead) account.
    const create = await inject('POST', ROUTES.invitations, { role: 'lead' }, adminToken);
    const lead = cc.generateIdentity();
    await inject('POST', ROUTES.redeemInvitation, {
      code: create.json<CreateInvitationResponse>().code,
      displayName: 'Lead One',
      identity: cc.toPublicIdentity(lead),
      wrappedSecret: fakeWrapped(),
    });
    const leadToken = await login(lead);
    const leadPub = cc.toPublicIdentity(lead);

    // Record sealed-keys before the cosign request.
    const before = await handle.db.select().from(sealedKeys).where(eq(sealedKeys.recordId, rec.id));
    const beforeRec = await handle.db.select().from(records).where(eq(records.id, rec.id));

    // Author creates a cosign request, sealing the DEK to the lead (cosigner).
    const reqRes = await inject(
      'POST',
      ROUTES.cosignRequests,
      {
        recordId: rec.id,
        deploymentId,
        requestedSigners: [leadPub.keyId],
        sealedKeys: [sealTo('cosigner', leadPub)],
        note: 'please counter-sign',
      },
      adminToken,
    );
    expect([200, 201]).toContain(reqRes.statusCode);
    const request = reqRes.json<CosignatureRequestDto>();

    // sealed_keys grew by one cosigner grant; the immutable record is unchanged.
    const after = await handle.db.select().from(sealedKeys).where(eq(sealedKeys.recordId, rec.id));
    expect(after.length).toBe(before.length + 1);
    expect(after.some((k) => k.recipientType === 'cosigner')).toBe(true);
    const afterRec = await handle.db.select().from(records).where(eq(records.id, rec.id));
    expect(afterRec[0]!.recordHash).toBe(beforeRec[0]!.recordHash);
    expect(afterRec[0]!.signature).toBe(beforeRec[0]!.signature);

    // The lead sees the request as awaiting their signature.
    const mine = await inject('GET', ROUTES.cosignRequests, undefined, leadToken);
    expect(
      mine.json<{ requests: CosignatureRequestDto[] }>().requests.some((r) => r.id === request.id),
    ).toBe(true);

    // Tampered signature (over the wrong hash) is rejected.
    const wrongHash = cc.hash(cc.utf8('not the record'));
    const badSig = cc.toBase64(cc.sign(wrongHash, lead.sign.secretKey));
    const bad = await inject(
      'POST',
      ROUTES.cosignSubmit,
      { requestId: request.id, decision: 'signed', signature: badSig },
      leadToken,
    );
    expect(bad.statusCode).toBe(400);

    // Valid co-signature over the record's recordHash is accepted → complete.
    const goodSig = cc.toBase64(cc.sign(cc.fromBase64(rec.recordHash), lead.sign.secretKey));
    const good = await inject(
      'POST',
      ROUTES.cosignSubmit,
      { requestId: request.id, decision: 'signed', signature: goodSig },
      leadToken,
    );
    expect([200, 201]).toContain(good.statusCode);

    const refreshed = await inject('GET', ROUTES.cosignRequests, undefined, adminToken);
    const created = refreshed
      .json<{ created: CosignatureRequestDto[] }>()
      .created.find((r) => r.id === request.id);
    expect(created!.status).toBe('complete');
  });
});
