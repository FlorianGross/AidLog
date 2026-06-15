/**
 * DB-backed integration tests for SUPERVISOR read access.
 * Skipped (loudly) unless TEST_DATABASE_URL points at a privileged Postgres.
 *
 * Covers:
 *   - GET /api/org/supervisors returns ONLY active admins + leads, each with
 *     their PUBLIC identity (keyId/boxPublicKey/signPublicKey) + role, and NEVER
 *     any secret material (no wrappedSecret on the wire).
 *   - a HELPER may CALL the endpoint (needs the keys to seal new records).
 *   - DISABLED supervisors are excluded.
 *   - the sealed_keys CHECK accepts a 'supervisor' wrapper (record append OK).
 *   - scope=org now ALSO returns the CALLER's own supervisor wrapper, while
 *     still excluding OTHER users' helper/supervisor wrappers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ROUTES, ENVELOPE_VERSION } from '@aidlog/contracts';
import type {
  AuthChallenge,
  AuthSession,
  CreateInvitationResponse,
  ProtocolRecord,
  SignableRecord,
  SealedKey,
  SupervisorListResponse,
  UserListResponse,
} from '@aidlog/contracts';
import type { CryptoCore, IdentityKeyPair } from '@aidlog/crypto-core';
import type { DbHandle } from '../src/db/client.js';
import { hasDb, TEST_DATABASE_URL, SKIP_REASON } from './helpers.js';

const d = hasDb ? describe : describe.skip;

d(`supervisors integration (${hasDb ? 'db present' : SKIP_REASON})`, () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let cc: CryptoCore;

  let org: IdentityKeyPair;
  let admin: IdentityKeyPair;
  let adminToken: string;

  let lead: IdentityKeyPair;
  let leadToken: string;
  let helper: IdentityKeyPair;
  let helperToken: string;
  let disabledLead: IdentityKeyPair;

  beforeAll(async () => {
    ({ crypto: cc } = await import('@aidlog/crypto-core'));
    const { createDb } = await import('../src/db/client.js');
    const { runMigrations } = await import('../src/db/migrate.js');
    const { buildApp } = await import('../src/app.js');
    const { loadConfig, resetConfigCache } = await import('../src/config.js');

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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  async function invite(role: 'helper' | 'lead' | 'admin'): Promise<IdentityKeyPair> {
    const create = await inject('POST', ROUTES.invitations, { role }, adminToken);
    const { code } = create.json<CreateInvitationResponse>();
    const id = cc.generateIdentity();
    await inject('POST', ROUTES.redeemInvitation, {
      code,
      displayName: `${role}-user`,
      identity: cc.toPublicIdentity(id),
      wrappedSecret: fakeWrapped(),
    });
    return id;
  }

  function sealTo(
    type: 'org' | 'helper' | 'supervisor',
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

  it('bootstraps org + admin, and onboards lead/helper/disabled-lead', async () => {
    const reg = await inject('POST', ROUTES.registerOrg, {
      orgName: 'Supervisors Org',
      identity: cc.toPublicIdentity(org),
      wrappedSecret: fakeWrapped(),
      admin: {
        displayName: 'Admin',
        identity: cc.toPublicIdentity(admin),
        wrappedSecret: fakeWrapped(),
      },
    });
    expect([200, 201]).toContain(reg.statusCode);
    adminToken = await login(admin);

    lead = await invite('lead');
    leadToken = await login(lead);
    helper = await invite('helper');
    helperToken = await login(helper);
    disabledLead = await invite('lead');

    // Disable the disabledLead via admin PATCH.
    const users = (
      await inject('GET', ROUTES.users, undefined, adminToken)
    ).json<UserListResponse>().users;
    const target = users.find((u) => u.identity.keyId === cc.toPublicIdentity(disabledLead).keyId);
    expect(target).toBeDefined();
    const patch = await inject(
      'PATCH',
      ROUTES.users,
      { helperId: target!.helperId, status: 'disabled' },
      adminToken,
    );
    expect(patch.statusCode).toBe(200);
  });

  it('lists only ACTIVE admins + leads with PUBLIC identity (helper may call)', async () => {
    // A HELPER is allowed to call it (needs the keys to seal new records).
    const res = await inject('GET', ROUTES.orgSupervisors, undefined, helperToken);
    expect(res.statusCode).toBe(200);
    const { supervisors } = res.json<SupervisorListResponse>();

    const adminKeyId = cc.toPublicIdentity(admin).keyId;
    const leadKeyId = cc.toPublicIdentity(lead).keyId;
    const disabledKeyId = cc.toPublicIdentity(disabledLead).keyId;
    const helperKeyId = cc.toPublicIdentity(helper).keyId;

    const keyIds = supervisors.map((s) => s.identity.keyId).sort();
    expect(keyIds).toEqual([adminKeyId, leadKeyId].sort());

    // Disabled supervisor and the helper are excluded.
    expect(keyIds).not.toContain(disabledKeyId);
    expect(keyIds).not.toContain(helperKeyId);

    // Roles are 'admin' or 'lead' only.
    expect(supervisors.every((s) => s.role === 'admin' || s.role === 'lead')).toBe(true);

    // PUBLIC identity only — full triplet present, NO secret material on the wire.
    for (const s of supervisors) {
      expect(s.identity.keyId).toBeTruthy();
      expect(s.identity.boxPublicKey).toBeTruthy();
      expect(s.identity.signPublicKey).toBeTruthy();
    }
    expect(JSON.stringify(res.json())).not.toMatch(/wrappedSecret|ciphertext|secretKey/i);
  });

  it('rejects an unauthenticated call (401)', async () => {
    const res = await inject('GET', ROUTES.orgSupervisors);
    expect(res.statusCode).toBe(401);
  });

  it('accepts a record append carrying a supervisor wrapper (CHECK admits it)', async () => {
    const deploymentId = crypto.randomUUID();
    const helperPub = cc.toPublicIdentity(helper);
    const orgPub = cc.toPublicIdentity(org);
    const adminPub = cc.toPublicIdentity(admin);
    const leadPub = cc.toPublicIdentity(lead);

    const rec = signRecord(helper, helperPub.keyId, deploymentId, 0, null, [
      sealTo('org', orgPub),
      sealTo('helper', helperPub),
      sealTo('supervisor', adminPub),
      sealTo('supervisor', leadPub),
    ]);
    const appended = await inject('POST', ROUTES.records, { record: rec }, helperToken);
    expect([200, 201]).toContain(appended.statusCode);
  });

  it('scope=org returns the CALLER own supervisor wrapper, never another user wrapper', async () => {
    // The lead pulls the whole org. They must see:
    //   - org wrappers (decrypt with org key), AND
    //   - their OWN 'supervisor' wrapper (decrypt with their own key),
    // but NEVER the admin's supervisor wrapper or the helper's helper wrapper.
    const res = await inject('GET', `${ROUTES.sync}?scope=org`, undefined, leadToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: ProtocolRecord[] }>();

    const leadKeyId = cc.toPublicIdentity(lead).keyId;
    const adminKeyId = cc.toPublicIdentity(admin).keyId;
    const helperKeyId = cc.toPublicIdentity(helper).keyId;

    // Find the record we appended above (it has supervisor wrappers).
    const withSupervisor = body.records.filter((r) =>
      r.sealedKeys.some((k) => k.recipientType === 'supervisor'),
    );
    expect(withSupervisor.length).toBeGreaterThan(0);

    for (const r of body.records) {
      for (const k of r.sealedKeys) {
        // Only org wrappers OR wrappers addressed to the caller (the lead).
        const isOrg = k.recipientType === 'org';
        const isMine = k.recipientKeyId === leadKeyId;
        expect(isOrg || isMine).toBe(true);
        // Never the admin's supervisor wrapper, never the helper's helper wrapper.
        expect(k.recipientKeyId === adminKeyId && !isOrg).toBe(false);
        expect(k.recipientKeyId === helperKeyId && !isOrg).toBe(false);
      }
      // The lead's own supervisor wrapper, when present, IS served.
    }

    // Concretely: the lead sees their own supervisor wrapper on the seeded record.
    const seen = withSupervisor[0]!;
    expect(seen.sealedKeys.some((k) => k.recipientKeyId === leadKeyId)).toBe(true);
    expect(
      seen.sealedKeys.some(
        (k) => k.recipientType === 'supervisor' && k.recipientKeyId === adminKeyId,
      ),
    ).toBe(false);
  });
});
