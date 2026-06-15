/**
 * Zod validators for every request body, mirroring the DTOs in
 * `@aidlog/contracts`. The server validates SHAPE only — it intentionally never
 * inspects or interprets ciphertext fields. These schemas guard against
 * malformed input, not against content (which is opaque by design).
 *
 * Where a contracts type is structural, the matching zod schema is annotated
 * `satisfies z.ZodType<...>` so a drift in the contract breaks the build.
 */
import { z } from 'zod';
import { ENVELOPE_VERSION, ROLES, QUALIFICATIONS } from '@aidlog/contracts';
import type {
  AuthVerifyRequest,
  CloseShiftRequest,
  RegisterHelperRequest,
} from '@aidlog/contracts';

const base64 = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'must be standard padded base64');

const kdfParams = z.object({
  alg: z.literal('argon2id'),
  salt: base64,
  opsLimit: z.number().int().nonnegative(),
  memLimit: z.number().int().nonnegative(),
});

const wrappedSecret = z.object({
  alg: z.literal('xchacha20poly1305-ietf'),
  kdf: kdfParams,
  nonce: base64,
  ciphertext: base64,
});

/** PUT /api/org/keyset — re-wrap the org secret (e.g. after Shamir recovery). */
export const updateOrgKeysetSchema = z
  .object({
    wrappedSecret,
    recoveryWrappers: z.array(wrappedSecret).optional(),
  })
  .strict();

const publicIdentity = z.object({
  keyId: z.string().min(1),
  boxPublicKey: base64,
  signPublicKey: base64,
});

/**
 * registerOrg handshake (EXTENDED).
 *
 * `identity` + `wrappedSecret` are the ORG keyset (as in the contract
 * RegisterOrgRequest). We additionally accept an optional `admin` block: the
 * personal identity + password-wrapped secret of the org's FIRST user, who is
 * created with role 'admin'. When present, the server provisions both the org
 * keyset and the bootstrap admin account in one transaction.
 *
 * Frontend contract: send `admin` on setup so the org has an admin who can log
 * in and issue invitations. Omitting it registers the org keyset only (legacy
 * shape); in that case the org's own keyId acts as the admin identity for login.
 */
export const adminAccountSchema = z.object({
  displayName: z.string().min(1).max(256),
  identity: publicIdentity,
  wrappedSecret,
});

// NOTE: not annotated `satisfies z.ZodType<...>` — `admin` is optional and the
// repo enables `exactOptionalPropertyTypes`, which makes zod's `T | undefined`
// output incompatible with the `?:`-only target (same reasoning as
// appendRecordSchema below). The base shape still mirrors RegisterOrgRequest.
export const registerOrgSchema = z
  .object({
    orgName: z.string().min(1).max(256),
    identity: publicIdentity,
    wrappedSecret,
    admin: adminAccountSchema.optional(),
  })
  .strict();

export const registerHelperSchema = z
  .object({
    orgId: z.string().uuid(),
    displayName: z.string().min(1).max(256),
    identity: publicIdentity,
    wrappedSecret,
  })
  .strict() satisfies z.ZodType<RegisterHelperRequest>;

export const authChallengeSchema = z
  .object({
    keyId: z.string().min(1),
  })
  .strict();

export const authVerifySchema = z
  .object({
    keyId: z.string().min(1),
    challenge: base64,
    signature: base64,
  })
  .strict() satisfies z.ZodType<AuthVerifyRequest>;

const encryptedPayload = z.object({
  alg: z.literal('xchacha20poly1305-ietf'),
  nonce: base64,
  ciphertext: base64,
  schemaId: z.string().min(1),
  schemaVersion: z.number().int().nonnegative(),
});

const encryptedBlobRef = z.object({
  blobId: z.string().min(1),
  alg: z.literal('xchacha20poly1305-ietf'),
  header: base64,
  size: z.number().int().nonnegative(),
  hash: base64,
  mediaType: z.string().min(1).max(255),
  label: z.string().max(1024).optional(),
});

const sealedKey = z.object({
  // 'supervisor' lets NEW records be additionally sealed to active admins/leads
  // (see contracts RecipientType + migration 0008). Shared by appendRecordSchema
  // (protocolRecord.sealedKeys) and the cosign-style sealed-key POSTs below, so a
  // supervisor wrapper validates wherever a SealedKey is accepted.
  recipientType: z.enum(['org', 'helper', 'cosigner', 'supervisor']),
  recipientKeyId: z.string().min(1),
  alg: z.literal('x25519-sealedbox'),
  ciphertext: base64,
});

const protocolRecord = z.object({
  envelopeVersion: z.literal(ENVELOPE_VERSION),
  id: z.string().uuid(),
  deploymentId: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  authorKeyId: z.string().min(1),
  payload: encryptedPayload,
  blobs: z.array(encryptedBlobRef),
  sealedKeys: z.array(sealedKey).min(1),
  prevHash: base64.nullable(),
  recordHash: base64,
  signature: base64,
  alg: z.object({
    aead: z.literal('xchacha20poly1305-ietf'),
    sign: z.literal('ed25519'),
    hash: z.literal('blake2b-256'),
  }),
  supersedes: z.string().uuid().nullable().optional(),
});

// NOTE: not annotated `satisfies z.ZodType<AppendRecordRequest>` because the
// contract uses optional props (e.g. EncryptedBlobRef.label, supersedes) and
// the repo enables `exactOptionalPropertyTypes`, which makes zod's
// `string | undefined` outputs incompatible with the `?:`-only DTO shape. The
// schema is structurally equivalent and is the runtime source of truth.
export const appendRecordSchema = z
  .object({
    record: protocolRecord,
  })
  .strict();

export const blobTicketSchema = z
  .object({
    /** client-proposed blobId (uuid); server may accept or assign its own. */
    blobId: z.string().uuid().optional(),
    /** ciphertext size hint in bytes, for the presigned content-length. */
    size: z.number().int().positive().optional(),
    mediaType: z.string().min(1).max(255).optional(),
  })
  .strict();

export const syncQuerySchema = z
  .object({
    cursor: z.string().optional(),
    deploymentId: z.string().uuid().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    /**
     * Read scope. Default 'self' = the existing role-scoped behaviour (a helper
     * sees only their own authored records + org/own sealedKeys). 'org' = every
     * record in the org WITH its org-type sealedKeys, allowed ONLY for an
     * admin/lead (the route enforces the role). Used by the client-side ORG
     * analytics dashboard, which decrypts org records locally with the org key.
     */
    scope: z.enum(['self', 'org']).optional(),
  })
  .strict();

// Creation payload for a SchemaDefinition: `createdAt` is assigned by the
// server, so this is intentionally a subset of the stored DTO.
export const schemaDefinitionSchema = z
  .object({
    schemaId: z.string().min(1).max(256),
    version: z.number().int().nonnegative(),
    title: z.string().min(1).max(512),
    description: z.string().max(4096).optional(),
    jsonSchema: z.record(z.unknown()),
    uiSchema: z.record(z.unknown()).optional(),
    signature: base64.optional(),
    authorKeyId: z.string().min(1).optional(),
  })
  .strict();

export const closeShiftSchema = z
  .object({
    deploymentId: z.string().uuid(),
    helperKeyId: z.string().min(1),
  })
  .strict() satisfies z.ZodType<CloseShiftRequest>;

// ---------------------------------------------------------------------------
// User system, invitations & co-signature
// ---------------------------------------------------------------------------

const role = z.enum(ROLES as unknown as [string, ...string[]]);

export const createInvitationSchema = z
  .object({
    role,
    displayName: z.string().min(1).max(256).optional(),
    expiresInHours: z
      .number()
      .int()
      .positive()
      .max(24 * 30)
      .optional(),
  })
  .strict();

export const redeemInvitationSchema = z
  .object({
    code: z.string().min(1).max(512),
    displayName: z.string().min(1).max(256),
    identity: publicIdentity,
    wrappedSecret,
  })
  .strict();

export const updateUserSchema = z
  .object({
    helperId: z.string().uuid(),
    role: role.optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Personal & Qualifikationen — PATCH /api/users/:keyId/qualification (admin).
//
// The qualification is OPERATIONAL personnel metadata (an Ausbildungsstand), NOT
// patient/health data. We validate it against the pinned enum from contracts;
// `null` clears the assignment. `.strict()` rejects any extra field.
// ---------------------------------------------------------------------------
const qualificationValues = QUALIFICATIONS.map((q) => q.value) as [string, ...string[]];
const qualification = z.enum(qualificationValues);

export const setQualificationSchema = z
  .object({
    qualification: qualification.nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Anwesenheit/Dienst roster — POST/PUT /api/deployments/:id/roster.
//
// OPERATIONAL duty metadata only (who is on duty + check-in/out + role-at-event)
// — NEVER patient/health data. A helper may upsert only their OWN entry; an
// admin/lead may target anyone (helperKeyId). The server fills displayName +
// qualification from the account; the client supplies only duty fields.
// `.strict()` rejects extras.
// ---------------------------------------------------------------------------
export const rosterUpsertSchema = z
  .object({
    helperKeyId: z.string().min(1).optional(),
    roleAtEvent: z.string().max(256).nullable().optional(),
    action: z.enum(['in', 'out']).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Org-key recovery (Shamir) — METADATA ONLY.
// The request carries NO share and NO secret: only the policy (threshold/count),
// trustee labels, and an optional public-key check value. `.strict()` rejects
// any extra field, so a client cannot smuggle a share into the request body.
// ---------------------------------------------------------------------------
export const setRecoveryConfigSchema = z
  .object({
    threshold: z.number().int().min(2).max(255),
    shareCount: z.number().int().min(2).max(255),
    trustees: z
      .array(z.object({ label: z.string().min(1).max(256) }).strict())
      .min(1)
      .max(255),
    orgKeyCheck: base64.optional(),
  })
  .strict()
  .refine((v) => v.shareCount >= v.threshold, {
    message: 'shareCount must be >= threshold',
    path: ['shareCount'],
  })
  .refine((v) => v.trustees.length === v.shareCount, {
    message: 'trustees length must equal shareCount (one trustee per share)',
    path: ['trustees'],
  });

// ---------------------------------------------------------------------------
// Configurable protocol schema (in-app schema editor) — PUT /api/org/schema.
//
// `schema` is the org's DocSchema (sections/fields). These are FIELD DEFINITIONS
// / form config, NOT patient data. We guard SHAPE only — a non-empty `sections`
// array and a `schemaId` string — and stay tolerant of new field props
// (`.passthrough()`), so the editor can add field metadata without a server
// change. We intentionally do NOT over-constrain field internals here.
// ---------------------------------------------------------------------------
export const setOrgSchemaSchema = z
  .object({
    schema: z
      .object({
        schemaId: z.string().min(1).max(256),
        sections: z.array(z.unknown()).min(1),
      })
      .passthrough(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Protocol categories (Sanitätsdienst / HvO / EGB …) — POST /api/org/categories.
//
// A category is org CONFIG: a name + its OWN DocSchema (`schema`) + a permission
// deciding who may create a deployment under it. Like org_schema, `schema` is
// FIELD DEFINITIONS / form config (NOT patient data, no secrets) so it is opaque
// to the server — we guard SHAPE only and `.passthrough()` its internals so the
// editor can add field metadata without a server change. `id` present = update,
// absent = create. `.strict()` rejects extra top-level fields.
// ---------------------------------------------------------------------------
export const upsertCategorySchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(256),
    description: z.string().max(4096).optional(),
    deploymentLabel: z.string().max(256).optional(),
    createPermission: z.enum(['all', 'lead', 'admin']),
    // Opaque DocSchema (sections/fields) — passthrough, never over-constrained.
    schema: z.object({}).passthrough().optional(),
    sortOrder: z.number().int().min(0).max(100000).optional(),
    color: z.string().max(64).optional(),
    icon: z.string().max(128).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const addSealedKeysSchema = z
  .object({
    recordId: z.string().uuid(),
    sealedKeys: z.array(sealedKey).min(1).max(64),
  })
  .strict();

export const createCosignatureSchema = z
  .object({
    recordId: z.string().uuid(),
    deploymentId: z.string().uuid(),
    requestedSigners: z.array(z.string().min(1)).min(1).max(32),
    sealedKeys: z.array(sealedKey).min(1).max(64),
    note: z.string().max(4096).optional(),
  })
  .strict();

export const submitCosignatureSchema = z
  .object({
    requestId: z.string().uuid(),
    decision: z.enum(['signed', 'rejected']),
    signature: base64,
    signatureImage: encryptedBlobRef.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Web push — register a browser subscription (operational metadata only).
//
// The endpoint + keys are produced by the browser's PushManager. We guard SHAPE
// only: a valid https endpoint and base64url public keys (RFC 8291 uses the
// URL-safe alphabet). No patient data, secret key, DEK, or password is ever
// carried here. `.strict()` rejects any extra field.
// ---------------------------------------------------------------------------
const base64url = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, 'must be base64url');

export const registerPushSchema = z
  .object({
    subscription: z
      .object({
        endpoint: z.string().url().max(2048),
        keys: z
          .object({
            p256dh: base64url,
            auth: base64url,
          })
          .strict(),
      })
      .strict(),
    label: z.string().max(256).optional(),
  })
  .strict();

export const unsubscribePushSchema = z
  .object({
    endpoint: z.string().url().max(2048),
  })
  .strict();

// ---------------------------------------------------------------------------
// GDPR retention / erasure (Löschkonzept) — PUT /api/org/retention,
// POST /api/org/retention/purge.
//
// SHAPE only. retentionDays is a positive integer with a sane upper bound
// (~100 years) so a fat-fingered value can't disable erasure forever. The
// purge body carries non-secret routing metadata only (a scope, an optional
// deploymentId, a dryRun flag); `.strict()` rejects extras. No ciphertext,
// secret, or decrypted content is ever read here.
// ---------------------------------------------------------------------------
const MAX_RETENTION_DAYS = 36525; // ~100 years

export const setRetentionSchema = z
  .object({
    retentionDays: z.number().int().positive().max(MAX_RETENTION_DAYS),
  })
  .strict();

export const purgeSchema = z
  .object({
    scope: z.enum(['policy', 'deployment']),
    deploymentId: z.string().uuid().optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.scope !== 'deployment' || typeof v.deploymentId === 'string', {
    message: "deploymentId is required when scope is 'deployment'",
    path: ['deploymentId'],
  });

// ---------------------------------------------------------------------------
// Material-/Verbrauchsmaterial-Verwaltung (inventory).
//
// SHAPE only, OPERATIONAL LOGISTICS data — NEVER patient/health data. A catalog
// item carries a name, unit, integer stock + optional integer threshold, an
// optional expiry calendar DATE (YYYY-MM-DD), category and location. Quantities
// are non-negative integers (consumption is a POSITIVE integer). `.strict()`
// rejects extras — in particular there is no field for a patient/record link, so
// one can never be smuggled in. This is a NORMAL inventory, NOT a BtM register.
// ---------------------------------------------------------------------------
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO calendar date (YYYY-MM-DD)');

export const upsertMaterialItemSchema = z
  .object({
    name: z.string().min(1).max(256),
    category: z.string().max(128).nullable().optional(),
    unit: z.string().min(1).max(32),
    stockQuantity: z.number().int().min(0).max(1_000_000_000),
    minQuantity: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
    expiresAt: isoDate.nullable().optional(),
    location: z.string().max(256).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const logConsumptionSchema = z
  .object({
    itemId: z.string().uuid(),
    quantity: z.number().int().positive().max(1_000_000_000),
    note: z.string().max(1024).nullable().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// CIRS — ANONYMOUS critical-incident reports (POST /api/cirs).
//
// ANONYMITY IS THE CORE PROPERTY. We validate SHAPE only and, crucially,
// `.strict()` REJECTS any extra field — so a client (or a buggy caller) can NEVER
// smuggle an author/submitter/keyId/signature into the submission. The accepted
// body is exactly { alg, nonce, ciphertext, sealedKey }: the opaque AEAD payload
// plus the SINGLE org-sealed DEK (crypto_box_seal, x25519-sealedbox). There is no
// reporter attribution field, and the report is never signed. The server reads
// none of the ciphertext.
// ---------------------------------------------------------------------------
export const cirsSubmissionSchema = z
  .object({
    alg: z.literal('xchacha20poly1305-ietf'),
    nonce: base64,
    ciphertext: base64,
    sealedKey: base64,
  })
  .strict();

/** PUT /api/cirs/:id/status — set the QM workflow status (admin). */
export const setCirsStatusSchema = z
  .object({
    status: z.enum(['neu', 'in_bearbeitung', 'abgeschlossen']),
  })
  .strict();
