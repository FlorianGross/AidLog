/**
 * DB-backed integration tests for org-key RECOVERY metadata + the AUDIT log.
 * Skipped (loudly) unless TEST_DATABASE_URL points at a privileged Postgres.
 *
 * Covers:
 *   - GET recovery returns null before configuration; admin POST configures it.
 *   - lead can READ recovery config but cannot POST it (admin-only write).
 *   - POST recovery assigns a trustee id per share and writes a
 *     'recovery.configured' audit entry. NO share/secret is stored.
 *   - re-POST upserts (replaces) the policy in place.
 *   - offboarding: disabling a user writes 'user.disabled' AND the disabled user
 *     can no longer authenticate; re-enabling writes 'user.enabled'; a role
 *     change writes 'user.role-changed'.
 *   - invite/redeem/shift-close emit their audit entries.
 *   - GET audit is admin-only, most-recent-first, and paginates.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ROUTES, ENVELOPE_VERSION } from '@aidlog/contracts';
import type {
  AuthChallenge,
  AuthSession,
  CreateInvitationResponse,
  UserListResponse,
  RecoveryConfig,
  AuditListResponse,
} from '@aidlog/contracts';
import type { CryptoCore, IdentityKeyPair } from '@aidlog/crypto-core';
import type { DbHandle } from '../src/db/client.js';
import { hasDb, TEST_DATABASE_URL, SKIP_REASON } from './helpers.js';

const d = hasDb ? describe : describe.skip;

d(`recovery + audit integration (${hasDb ? 'db present' : SKIP_REASON})`, () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let cc: CryptoCore;

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

  it('bootstraps the org with an admin', async () => {
    const reg = await inject('POST', ROUTES.registerOrg, {
      orgName: 'Recovery Org',
      identity: cc.toPublicIdentity(org),
      wrappedSecret: fakeWrapped(),
      admin: {
        displayName: 'Admin',
        identity: cc.toPublicIdentity(admin),
        wrappedSecret: fakeWrapped(),
      },
    });
    expect([200, 201]).toContain(reg.statusCode);
    orgId = reg.json<{ orgId: string }>().orgId;
    adminToken = await login(admin);
    expect(adminToken).toBeTruthy();
  });

  it('GET recovery is null before configuration', async () => {
    const res = await inject('GET', ROUTES.orgRecovery, undefined, adminToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it('admin POSTs recovery config: trustees get ids, NO share is stored, audit written', async () => {
    const trustees = [{ label: 'Leitung' }, { label: 'Stellv.' }, { label: 'Kasse' }];
    // Client computes the public-key check; the server only stores it verbatim.
    const orgKeyCheck = cc.toBase64(cc.hash(cc.fromBase64(cc.toPublicIdentity(org).boxPublicKey)));
    const res = await inject(
      'POST',
      ROUTES.orgRecovery,
      {
        threshold: 2,
        shareCount: 3,
        trustees,
        orgKeyCheck,
      },
      adminToken,
    );
    expect([200, 201]).toContain(res.statusCode);
    const cfg = res.json<RecoveryConfig>();
    expect(cfg.threshold).toBe(2);
    expect(cfg.shareCount).toBe(3);
    expect(cfg.trustees).toHaveLength(3);
    expect(cfg.trustees.every((t) => typeof t.id === 'string' && t.id.length > 0)).toBe(true);
    expect(cfg.trustees.map((t) => t.label)).toEqual(['Leitung', 'Stellv.', 'Kasse']);
    expect(cfg.orgKeyCheck).toBe(orgKeyCheck);

    // The stored row must carry NO share/secret material — assert the raw JSON
    // serialization of the persisted config contains none of those keys.
    const get = await inject('GET', ROUTES.orgRecovery, undefined, adminToken);
    const raw = JSON.stringify(get.json());
    expect(raw).not.toMatch(/"share"|"secret"|"password"|"wrappedSecret"/i);

    // Audit captured a recovery.configured entry.
    const audit = await inject('GET', ROUTES.audit, undefined, adminToken);
    const entries = audit.json<AuditListResponse>().entries;
    expect(entries.some((e) => e.action === 'recovery.configured' && e.detail === '2-of-3')).toBe(
      true,
    );
  });

  it('re-POST upserts the policy in place', async () => {
    const res = await inject(
      'POST',
      ROUTES.orgRecovery,
      {
        threshold: 3,
        shareCount: 4,
        trustees: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
      },
      adminToken,
    );
    expect([200, 201]).toContain(res.statusCode);
    const get = await inject('GET', ROUTES.orgRecovery, undefined, adminToken);
    const cfg = get.json<RecoveryConfig>();
    expect(cfg.threshold).toBe(3);
    expect(cfg.shareCount).toBe(4);
    expect(cfg.trustees).toHaveLength(4);
  });

  it('a lead can READ recovery config but cannot WRITE it; a helper can do neither', async () => {
    const lead = await invite('lead');
    const leadToken = await login(lead);
    expect((await inject('GET', ROUTES.orgRecovery, undefined, leadToken)).statusCode).toBe(200);
    expect(
      (
        await inject(
          'POST',
          ROUTES.orgRecovery,
          {
            threshold: 2,
            shareCount: 2,
            trustees: [{ label: 'X' }, { label: 'Y' }],
          },
          leadToken,
        )
      ).statusCode,
    ).toBe(403);

    const helper = await invite('helper');
    const helperToken = await login(helper);
    expect((await inject('GET', ROUTES.orgRecovery, undefined, helperToken)).statusCode).toBe(403);
    expect((await inject('GET', ROUTES.audit, undefined, helperToken)).statusCode).toBe(403);
  });

  it('offboarding: disabling a user blocks auth + audits; re-enable + role-change audit too', async () => {
    const lead = await invite('lead');
    const leadPub = cc.toPublicIdentity(lead);
    // Disabled users still authenticate until disabled — confirm baseline login works.
    expect(await login(lead)).toBeTruthy();

    // Find the lead's helperId.
    const list = await inject('GET', ROUTES.users, undefined, adminToken);
    const target = list
      .json<UserListResponse>()
      .users.find((u) => u.identity.keyId === leadPub.keyId)!;
    expect(target).toBeTruthy();

    // Disable.
    const dis = await inject(
      'PATCH',
      ROUTES.users,
      { helperId: target.helperId, status: 'disabled' },
      adminToken,
    );
    expect(dis.statusCode).toBe(200);

    // The disabled user can no longer obtain a session (authVerify rejects).
    const ch = await inject('POST', ROUTES.authChallenge, { keyId: leadPub.keyId });
    // challenge may still be issued; verify must fail with 401.
    if (ch.statusCode === 201) {
      const challenge = ch.json<AuthChallenge>().challenge;
      const sig = cc.toBase64(cc.sign(cc.fromBase64(challenge), lead.sign.secretKey));
      const verify = await inject('POST', ROUTES.authVerify, {
        keyId: leadPub.keyId,
        challenge,
        signature: sig,
      });
      expect(verify.statusCode).toBe(401);
    }

    // Re-enable + change role.
    const en = await inject(
      'PATCH',
      ROUTES.users,
      { helperId: target.helperId, status: 'active', role: 'helper' },
      adminToken,
    );
    expect(en.statusCode).toBe(200);

    const audit = await inject('GET', ROUTES.audit, undefined, adminToken);
    const actions = audit
      .json<AuditListResponse>()
      .entries.filter((e) => e.targetKeyId === leadPub.keyId)
      .map((e) => e.action);
    expect(actions).toContain('user.disabled');
    expect(actions).toContain('user.enabled');
    expect(actions).toContain('user.role-changed');
  });

  it('invite + redeem + shift-close are audited; audit is newest-first and paginates', async () => {
    // shift-close audit (admin closes a helper's wrappers; no rows is fine).
    const helperPub = cc.toPublicIdentity(cc.generateIdentity());
    const close = await inject(
      'POST',
      ROUTES.closeShift,
      {
        deploymentId: crypto.randomUUID(),
        helperKeyId: helperPub.keyId,
      },
      adminToken,
    );
    expect(close.statusCode).toBe(200);

    const all = await inject('GET', ROUTES.audit, undefined, adminToken);
    const entries = all.json<AuditListResponse>().entries;
    const present = new Set(entries.map((e) => e.action));
    expect(present.has('user.invited')).toBe(true);
    expect(present.has('user.redeemed')).toBe(true);
    expect(present.has('shift.closed')).toBe(true);

    // Newest-first ordering: timestamps are non-increasing.
    for (let i = 1; i < entries.length; i++) {
      expect(new Date(entries[i - 1]!.at).getTime()).toBeGreaterThanOrEqual(
        new Date(entries[i]!.at).getTime(),
      );
    }

    // Pagination cap: ask for 2 entries, get at most 2.
    const page = await inject('GET', `${ROUTES.audit}?limit=2`, undefined, adminToken);
    expect(page.json<AuditListResponse>().entries.length).toBeLessThanOrEqual(2);
  });
});
