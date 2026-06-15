/**
 * DB-backed integration tests for PROTOCOL CATEGORIES.
 * Skipped (loudly) unless TEST_DATABASE_URL points at a privileged Postgres.
 *
 * Covers:
 *   - LAZY SEED: the first GET for a fresh org creates exactly ONE default
 *     "Sanitätsdienst" category (createPermission 'all', label 'Veranstaltung'),
 *     and a second GET does not duplicate it.
 *   - ROLE GUARD: a helper cannot POST or DELETE (admin-only writes).
 *   - UPSERT: create (no id) then update (id) bumps `version` and persists changes.
 *   - SOFT DELETE: active flips to false (+version bump); the category drops out
 *     of the active list but is never hard-deleted.
 *   - LAST-ACTIVE GUARD: deactivating the final active category is refused (409).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ROUTES } from '@aidlog/contracts';
import type {
  AuthChallenge,
  AuthSession,
  CategoryListResponse,
  CreateInvitationResponse,
  ProtocolCategory,
} from '@aidlog/contracts';
import type { CryptoCore, IdentityKeyPair } from '@aidlog/crypto-core';
import type { DbHandle } from '../src/db/client.js';
import { hasDb, TEST_DATABASE_URL, SKIP_REASON } from './helpers.js';

const d = hasDb ? describe : describe.skip;

d(`categories integration (${hasDb ? 'db present' : SKIP_REASON})`, () => {
  let app: FastifyInstance;
  let handle: DbHandle;
  let cc: CryptoCore;

  let org: IdentityKeyPair;
  let admin: IdentityKeyPair;
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

  it('bootstraps the org with an admin', async () => {
    const reg = await inject('POST', ROUTES.registerOrg, {
      orgName: 'Categories Org',
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
    expect(adminToken).toBeTruthy();
  });

  it('lazy-seeds exactly one default Sanitätsdienst on first GET; idempotent', async () => {
    const res = await inject('GET', ROUTES.orgCategories, undefined, adminToken);
    expect(res.statusCode).toBe(200);
    const list = res.json<CategoryListResponse>().categories;
    expect(list).toHaveLength(1);
    const def = list[0]!;
    expect(def.name).toBe('Sanitätsdienst');
    expect(def.createPermission).toBe('all');
    expect(def.deploymentLabel).toBe('Veranstaltung');
    expect(def.active).toBe(true);
    expect(def.sortOrder).toBe(0);

    // A second GET must NOT create another default.
    const again = await inject('GET', ROUTES.orgCategories, undefined, adminToken);
    expect(again.json<CategoryListResponse>().categories).toHaveLength(1);
  });

  it('a helper cannot POST or DELETE (admin-only writes)', async () => {
    const helper = await invite('helper');
    const helperToken = await login(helper);
    // helper CAN read.
    expect((await inject('GET', ROUTES.orgCategories, undefined, helperToken)).statusCode).toBe(
      200,
    );
    // helper CANNOT write.
    const post = await inject(
      'POST',
      ROUTES.orgCategories,
      { name: 'HvO', createPermission: 'lead' },
      helperToken,
    );
    expect(post.statusCode).toBe(403);
    const del = await inject(
      'DELETE',
      `${ROUTES.orgCategories}?id=11111111-1111-1111-1111-111111111111`,
      undefined,
      helperToken,
    );
    expect(del.statusCode).toBe(403);
  });

  it('upsert: create then update bumps version and persists changes', async () => {
    const created = await inject(
      'POST',
      ROUTES.orgCategories,
      { name: 'HvO', createPermission: 'lead', deploymentLabel: 'Einsatz', sortOrder: 1 },
      adminToken,
    );
    expect(created.statusCode).toBe(200);
    const cat = created.json<ProtocolCategory>();
    expect(cat.id).toBeTruthy();
    expect(cat.version).toBe(1);
    expect(cat.createPermission).toBe('lead');

    const updated = await inject(
      'POST',
      ROUTES.orgCategories,
      {
        id: cat.id,
        name: 'HvO Bereich',
        createPermission: 'admin',
        deploymentLabel: 'Einsatz',
        sortOrder: 2,
      },
      adminToken,
    );
    expect(updated.statusCode).toBe(200);
    const after = updated.json<ProtocolCategory>();
    expect(after.id).toBe(cat.id);
    expect(after.version).toBe(2);
    expect(after.name).toBe('HvO Bereich');
    expect(after.createPermission).toBe('admin');
    expect(after.sortOrder).toBe(2);

    // Now 2 active categories, ordered by sortOrder.
    const list = (
      await inject('GET', ROUTES.orgCategories, undefined, adminToken)
    ).json<CategoryListResponse>().categories;
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.sortOrder)).toEqual([0, 2]);
  });

  it('soft-delete deactivates (version bump) and drops it from the active list', async () => {
    // Create a throwaway category to delete.
    const created = await inject(
      'POST',
      ROUTES.orgCategories,
      { name: 'EGB', createPermission: 'all', sortOrder: 5 },
      adminToken,
    );
    const cat = created.json<ProtocolCategory>();

    const del = await inject(
      'DELETE',
      `${ROUTES.orgCategories}?id=${cat.id}`,
      undefined,
      adminToken,
    );
    expect(del.statusCode).toBe(200);
    const gone = del.json<ProtocolCategory>();
    expect(gone.active).toBe(false);
    expect(gone.version).toBe(cat.version + 1);

    const list = (
      await inject('GET', ROUTES.orgCategories, undefined, adminToken)
    ).json<CategoryListResponse>().categories;
    expect(list.some((c) => c.id === cat.id)).toBe(false);
  });

  it('refuses to deactivate the LAST active category (org must keep >= 1)', async () => {
    // Reduce to a single active category by deactivating all but one.
    let list = (
      await inject('GET', ROUTES.orgCategories, undefined, adminToken)
    ).json<CategoryListResponse>().categories;
    // Deactivate every category except the first until only one remains.
    for (let i = 1; i < list.length; i++) {
      const res = await inject(
        'DELETE',
        `${ROUTES.orgCategories}?id=${list[i]!.id}`,
        undefined,
        adminToken,
      );
      expect(res.statusCode).toBe(200);
    }
    list = (
      await inject('GET', ROUTES.orgCategories, undefined, adminToken)
    ).json<CategoryListResponse>().categories;
    expect(list).toHaveLength(1);

    // Deleting the last one must be refused.
    const refuse = await inject(
      'DELETE',
      `${ROUTES.orgCategories}?id=${list[0]!.id}`,
      undefined,
      adminToken,
    );
    expect(refuse.statusCode).toBe(409);
    // Still present and active.
    const stillThere = (
      await inject('GET', ROUTES.orgCategories, undefined, adminToken)
    ).json<CategoryListResponse>().categories;
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0]!.active).toBe(true);
  });
});
