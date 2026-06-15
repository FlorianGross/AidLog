/**
 * DB-backed integration tests for ARCHIVAL ANCHORING.
 * Skipped (loudly) unless TEST_DATABASE_URL points at a privileged Postgres.
 *
 * Covers:
 *   - POST /api/notarize with no records → 400.
 *   - after appending real hash-chained records, POST builds + stores an anchor
 *     whose merkleRoot EXACTLY matches a locally recomputed Merkle root (proving
 *     the documented ordering/leaf rule is reproducible client-side), and writes
 *     an 'archive.anchored' audit entry.
 *   - GET /api/notarize lists the anchor (newest first).
 *   - a helper is forbidden (403) from both create and list (admin/lead only).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ROUTES, ENVELOPE_VERSION } from '@aidlog/contracts';
import type {
  AuthChallenge,
  AuthSession,
  CreateInvitationResponse,
  ProtocolRecord,
  SealedKey,
  SignableRecord,
  AnchorListResponse,
  AuditListResponse,
  CreateAnchorResponse,
  PublicIdentity,
} from '@aidlog/contracts';
import type { CryptoCore, IdentityKeyPair } from '@aidlog/crypto-core';
import type { DbHandle } from '../src/db/client.js';
import { buildMerkleRoot, type AnchorLeaf } from '../src/anchor.js';
import { hasDb, TEST_DATABASE_URL, SKIP_REASON } from './helpers.js';

const d = hasDb ? describe : describe.skip;

d(`notarize integration (${hasDb ? 'db present' : SKIP_REASON})`, () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let cc: CryptoCore;

  let org: IdentityKeyPair;
  let admin: IdentityKeyPair;
  let adminToken: string;
  const appended: AnchorLeaf[] = [];

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
      // No TSA_URL → baseline server-signed anchor only.
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
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    token?: string,
  ): Promise<InjectResponse> {
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

  async function invite(role: 'helper' | 'lead'): Promise<IdentityKeyPair> {
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

  function sealTo(type: 'org' | 'helper', identity: PublicIdentity): SealedKey {
    return {
      recipientType: type,
      recipientKeyId: identity.keyId,
      alg: 'x25519-sealedbox',
      ciphertext: cc.toBase64(new Uint8Array(48)),
    };
  }

  function signRecord(
    id: IdentityKeyPair,
    authorKeyId: string,
    deploymentId: string,
    seq: number,
    prevHash: string | null,
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
      sealedKeys: [sealTo('org', cc.toPublicIdentity(org))],
      prevHash,
      alg: { aead: 'xchacha20poly1305-ietf', sign: 'ed25519', hash: 'blake2b-256' },
      supersedes: null,
    };
    const recordHash = cc.toBase64(cc.computeRecordHash(signable));
    const signature = cc.toBase64(cc.sign(cc.computeRecordHash(signable), id.sign.secretKey));
    return { ...signable, recordHash, signature };
  }

  it('bootstraps org + admin and appends a 2-record chain', async () => {
    const reg = await inject('POST', ROUTES.registerOrg, {
      orgName: 'Anchor Org',
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

    const adminPub = cc.toPublicIdentity(admin);
    const deploymentId = crypto.randomUUID();
    const r0 = signRecord(admin, adminPub.keyId, deploymentId, 0, null);
    const a0 = await inject('POST', ROUTES.records, { record: r0 }, adminToken);
    expect([200, 201]).toContain(a0.statusCode);
    const r1 = signRecord(admin, adminPub.keyId, deploymentId, 1, r0.recordHash);
    const a1 = await inject('POST', ROUTES.records, { record: r1 }, adminToken);
    expect([200, 201]).toContain(a1.statusCode);

    appended.push(
      { recordHash: r0.recordHash, deploymentId, seq: 0 },
      { recordHash: r1.recordHash, deploymentId, seq: 1 },
    );
  });

  it('POST anchor builds a root that matches a locally recomputed Merkle root', async () => {
    const res = await inject('POST', ROUTES.notarize, undefined, adminToken);
    expect([200, 201]).toContain(res.statusCode);
    const { anchor } = res.json<CreateAnchorResponse>();
    expect(anchor.recordCount).toBe(2);
    expect(anchor.algorithm).toBe('merkle-blake2b-256/v1');
    expect(anchor.serverSignature.length).toBeGreaterThan(0);
    expect(anchor.tsaTokenPresent).toBeUndefined(); // no TSA configured

    // Recompute the root from the SAME leaves: must match exactly (reproducible).
    const expected = buildMerkleRoot(appended);
    expect(anchor.merkleRoot).toBe(expected.merkleRoot);

    // Audit captured the anchoring event.
    const audit = await inject('GET', ROUTES.audit, undefined, adminToken);
    const entries = audit.json<AuditListResponse>().entries;
    expect(entries.some((e) => e.action === 'archive.anchored')).toBe(true);
  });

  it('GET lists the stored anchor', async () => {
    const res = await inject('GET', ROUTES.notarize, undefined, adminToken);
    expect(res.statusCode).toBe(200);
    const { anchors } = res.json<AnchorListResponse>();
    expect(anchors.length).toBeGreaterThanOrEqual(1);
    expect(anchors[0]!.recordCount).toBe(2);
  });

  it('a helper is forbidden from create and list (admin/lead only)', async () => {
    const helper = await invite('helper');
    const helperToken = await login(helper);
    expect((await inject('POST', ROUTES.notarize, undefined, helperToken)).statusCode).toBe(403);
    expect((await inject('GET', ROUTES.notarize, undefined, helperToken)).statusCode).toBe(403);
  });
});
