/**
 * Drizzle schema for the BLIND sync store.
 *
 * Storage rules baked into this schema (see ARCHITECTURE.md §1, §4, §5):
 *  - `orgs` / `helpers` hold ONLY a public identity + a password-wrapped secret
 *    (opaque JSON). The server can never derive the secret keys.
 *  - `records` is append-only: a BEFORE UPDATE/DELETE trigger raises an
 *    exception, and the application DB role is granted only INSERT/SELECT (see
 *    migrations.ts). `ciphertext`-bearing columns are stored verbatim and never
 *    interpreted.
 *  - `sealed_keys` is a SEPARATE table so shift-close can DELETE the
 *    helper-typed wrappers without ever touching an immutable `records` row.
 *  - `schemas` stores SchemaDefinition documents (public form definitions; not
 *    secret).
 */
import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  timestamp,
  date,
  jsonb,
  uuid,
  boolean,
  primaryKey,
  unique,
  index,
  customType,
} from 'drizzle-orm/pg-core';

/** Postgres `bytea` column mapped to a Node Buffer (opaque binary; here: a TSA token). */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const orgs = pgTable('orgs', {
  orgId: uuid('org_id').primaryKey().defaultRandom(),
  orgName: text('org_name').notNull(),
  /** KeyId (base64 of the signing public key, or stable hash) — globally unique. */
  keyId: text('key_id').notNull().unique(),
  /** PublicIdentity { keyId, boxPublicKey, signPublicKey }. Public, non-secret. */
  identity: jsonb('identity').notNull(),
  /** WrappedSecretKey — opaque ciphertext blob; only the org password unwraps it. */
  wrappedSecret: jsonb('wrapped_secret').notNull(),
  /** Optional extra recovery wrappers (backup-key, future Shamir/WebAuthn). */
  recoveryWrappers: jsonb('recovery_wrappers'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * User accounts (the former `helpers` table, extended in 0002 with role/status).
 * Treated as `users` going forward: each row is a member of an org with a Role
 * ('admin' | 'lead' | 'helper'). Unlike `records`, this is operational state and
 * MAY be UPDATEd (role/status changes). Still BLIND: only public identity +
 * password-wrapped opaque secret are stored.
 */
export const helpers = pgTable(
  'helpers',
  {
    helperId: uuid('helper_id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    keyId: text('key_id').notNull().unique(),
    identity: jsonb('identity').notNull(),
    wrappedSecret: jsonb('wrapped_secret').notNull(),
    /** Role: 'admin' | 'lead' | 'helper'. */
    role: text('role').notNull().default('helper'),
    /**
     * Sanitätsdienst qualification (Ausbildungsstand) — OPERATIONAL, non-health
     * personnel metadata (NOT Art. 9 data); see contracts Qualification. Nullable
     * = unset. NEVER store any patient/health value here.
     */
    qualification: text('qualification'),
    /** 'active' | 'disabled'. Disabled users cannot authenticate. */
    status: text('status').notNull().default('active'),
    /** keyId of the admin who issued the invitation this account redeemed. */
    invitedByKeyId: text('invited_by_key_id'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('helpers_org_idx').on(t.orgId),
    roleIdx: index('helpers_role_idx').on(t.orgId, t.role),
  }),
);

/** Alias: `helpers` is the user-account table. */
export const users = helpers;

/**
 * Per-deployment ROSTER (Anwesenheit/Dienst). MUTABLE operational state: who is
 * on duty for a deployment, with check-in/out times and a role-at-event. This is
 * OPERATIONAL personnel/duty metadata — NOT patient/health data — and is stored
 * in clear (normal grants; no append-only trigger). NEVER add a patient/health
 * column here. PK (deployment_id, helper_key_id): each helper appears at most
 * once per deployment.
 */
export const deploymentRoster = pgTable(
  'deployment_roster',
  {
    deploymentId: uuid('deployment_id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    helperKeyId: text('helper_key_id').notNull(),
    displayName: text('display_name').notNull(),
    /** Snapshot of the helper's qualification (operational; see contracts). */
    qualification: text('qualification'),
    /** Free-text duty/role for this event ("Zugführer", "Trupp 1"). */
    roleAtEvent: text('role_at_event'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.deploymentId, t.helperKeyId] }),
    orgIdx: index('deployment_roster_org_idx').on(t.orgId, t.deploymentId),
  }),
);

export type DeploymentRosterRow = typeof deploymentRoster.$inferSelect;

/**
 * Append-only immutable protocol records. One row per ProtocolRecord.
 * NOTE: `sealedKeys` are intentionally NOT stored here — see `sealedKeys` table.
 * Everything except routing metadata is opaque ciphertext.
 */
export const records = pgTable(
  'records',
  {
    /** Monotonic server-assigned ingest cursor; drives incremental sync. */
    ingestSeq: integer('ingest_seq').generatedAlwaysAsIdentity(),
    /** ProtocolRecord.id (client uuid v4). */
    id: uuid('id').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    deploymentId: uuid('deployment_id').notNull(),
    seq: integer('seq').notNull(),
    envelopeVersion: integer('envelope_version').notNull(),
    /** Helper signing identity (KeyId). */
    authorKeyId: text('author_key_id').notNull(),
    /** EncryptedPayload { alg, nonce, ciphertext(base64), schemaId, schemaVersion } — opaque. */
    payload: jsonb('payload').notNull(),
    /** EncryptedBlobRef[] descriptors (ids + hashes + sizes) — no plaintext. */
    blobs: jsonb('blobs').notNull(),
    /** base64 hash of previous record, or null for seq 0. */
    prevHash: text('prev_hash'),
    /** base64 BLAKE2b-256 over the canonical record. */
    recordHash: text('record_hash').notNull(),
    /** base64 Ed25519 signature over recordHash. */
    signature: text('signature').notNull(),
    /** { aead, sign, hash } algorithm pins. */
    alg: jsonb('alg').notNull(),
    supersedes: uuid('supersedes'),
    /** Client clock (ISO 8601, stored as text verbatim from the record). */
    createdAt: text('created_at').notNull(),
    /** Server receipt time — independent of client clock, authoritative. */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /** Hash-chain / ordering integrity: no two records share a slot in a chain. */
    deploymentSeqUnique: unique('records_deployment_seq_unique').on(t.deploymentId, t.seq),
    deploymentIdx: index('records_deployment_idx').on(t.deploymentId, t.seq),
    orgIngestIdx: index('records_org_ingest_idx').on(t.orgId, t.ingestSeq),
    authorIdx: index('records_author_idx').on(t.authorKeyId),
    /** Org-scoped ordered scan for deterministic Merkle-anchor leaf layout (0006). */
    orgDeploymentSeqIdx: index('records_org_deployment_seq_idx').on(t.orgId, t.deploymentId, t.seq),
  }),
);

/**
 * DEK wrappers, split out of `records` so the shift-close "soft revocation" can
 * DELETE helper-typed rows without mutating an immutable record (§5).
 */
export const sealedKeys = pgTable(
  'sealed_keys',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    deploymentId: uuid('deployment_id').notNull(),
    /**
     * 'org' | 'helper' | 'cosigner' | 'supervisor' (see contracts RecipientType,
     * CHECK in migrations 0001/0002/0008). Only 'helper' rows are deletable at
     * shift close. 'supervisor' wrappers seal the DEK to active admins/leads so
     * they can read per-deployment statistics with their own key.
     */
    recipientType: text('recipient_type').notNull(),
    recipientKeyId: text('recipient_key_id').notNull(),
    alg: text('alg').notNull(),
    /** base64 crypto_box_seal(DEK, recipientBoxPublicKey) — opaque. */
    ciphertext: text('ciphertext').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.recordId, t.recipientKeyId] }),
    deploymentRecipientIdx: index('sealed_keys_deployment_recipient_idx').on(
      t.deploymentId,
      t.recipientType,
      t.recipientKeyId,
    ),
    recordIdx: index('sealed_keys_record_idx').on(t.recordId),
  }),
);

export const schemas = pgTable(
  'schemas',
  {
    schemaId: text('schema_id').notNull(),
    version: integer('version').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description'),
    /** JSON Schema draft 2020-12 form definition (public). */
    jsonSchema: jsonb('json_schema').notNull(),
    uiSchema: jsonb('ui_schema'),
    signature: text('signature'),
    authorKeyId: text('author_key_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.schemaId, t.version] }),
    orgIdx: index('schemas_org_idx').on(t.orgId),
  }),
);

/** Opaque, tamper-evident session records (issued after proof-of-possession). */
export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    keyId: text('key_id').notNull(),
    orgId: uuid('org_id').notNull(),
    role: text('role').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('sessions_key_idx').on(t.keyId),
  }),
);

/** Short-lived auth challenges (proof-of-possession nonces). */
export const authChallenges = pgTable('auth_challenges', {
  challenge: text('challenge').primaryKey(),
  keyId: text('key_id').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-use, admin-issued invitations. ONLY a hash of the code is stored
 * (`codeHash`); the code itself is returned to the admin once and never persisted.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    role: text('role').notNull(),
    displayName: text('display_name'),
    /** base64url HMAC-SHA256 of the single-use code. Never the code itself. */
    codeHash: text('code_hash').notNull().unique(),
    status: text('status').notNull().default('pending'),
    createdByKeyId: text('created_by_key_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedByKeyId: text('redeemed_by_key_id'),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  },
  (t) => ({
    orgIdx: index('invitations_org_idx').on(t.orgId, t.status),
  }),
);

/** A request asking one or more signers to counter-sign a finalised record. */
export const cosignatureRequests = pgTable(
  'cosignature_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    deploymentId: uuid('deployment_id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    requestedByKeyId: text('requested_by_key_id').notNull(),
    /** KeyId[] of requested signers. */
    requestedSigners: jsonb('requested_signers').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    note: text('note'),
  },
  (t) => ({
    orgIdx: index('cosign_requests_org_idx').on(t.orgId, t.status),
    recordIdx: index('cosign_requests_record_idx').on(t.recordId),
  }),
);

/** One decision (signed/rejected) per signer per request. */
export const cosignatures = pgTable(
  'cosignatures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => cosignatureRequests.id, { onDelete: 'restrict' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => records.id, { onDelete: 'restrict' }),
    signerKeyId: text('signer_key_id').notNull(),
    decision: text('decision').notNull(),
    /** base64 Ed25519 signature over the record's recordHash. */
    signature: text('signature').notNull(),
    /** optional EncryptedBlobRef descriptor (opaque), AEAD-encrypted under the DEK. */
    signatureImage: jsonb('signature_image'),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestSignerUnique: unique('cosignatures_request_signer_unique').on(
      t.requestId,
      t.signerKeyId,
    ),
    requestIdx: index('cosignatures_request_idx').on(t.requestId),
  }),
);

/**
 * Organisation-key RECOVERY metadata (Shamir). ONE row per org.
 *
 * SECURITY-CRITICAL: this table holds METADATA ONLY — never a Shamir share, the
 * org secret key, or any password. Shares are exported to human trustees on the
 * client and are never transmitted to the server. The route code reads no share
 * or secret from the request body; see routes/recovery.ts.
 */
export const recoveryConfig = pgTable('recovery_config', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.orgId, { onDelete: 'restrict' }),
  /** T shares required to reconstruct (2..255). */
  threshold: integer('threshold').notNull(),
  /** N shares issued (threshold..255). */
  shareCount: integer('share_count').notNull(),
  /** RecoveryTrustee[] — [{ id, label }]. Labels only; NO share material. */
  trustees: jsonb('trustees').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdByKeyId: text('created_by_key_id').notNull(),
  /** Optional BLAKE2b of the org PUBLIC box key (public, non-secret). */
  orgKeyCheck: text('org_key_check'),
});

/**
 * The org's CONFIGURABLE PROTOCOL SCHEMA (in-app schema editor). ONE row per org.
 *
 * `schema` is the DocSchema (sections/fields) that drives how the documentation
 * form renders — FIELD DEFINITIONS / org configuration, NOT patient data. It is
 * the SHAPE of the form, never a value a helper enters, so (unlike `records`)
 * it is stored in clear. The application bumps `version` on every save.
 */
export const orgSchema = pgTable('org_schema', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.orgId, { onDelete: 'restrict' }),
  /** Monotonic version, set to previous + 1 on each save. */
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** keyId of the admin who last saved the schema. */
  updatedByKeyId: text('updated_by_key_id').notNull(),
  /** DocSchema JSON (sections/fields). Form config only — never patient data. */
  schema: jsonb('schema').notNull(),
});

/**
 * PROTOCOL CATEGORIES (Sanitätsdienst / HvO / EGB …). MANY rows per org.
 *
 * An admin defines each category with its OWN DocSchema (`schema`, sections/
 * fields — FIELD DEFINITIONS / form config, exactly like `org_schema.schema`,
 * NOT patient data) plus a `createPermission` deciding who may create a
 * deployment under it. Unlike `records`, this is operational config and MAY be
 * UPDATEd (the app bumps `version` on each save). Categories are NEVER hard-
 * deleted (old deployments may reference one); soft-delete sets `active = false`.
 */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    /** Display name, e.g. "Sanitätsdienst", "HvO", "EGB". */
    name: text('name').notNull(),
    description: text('description'),
    /** Singular UI term for a deployment of this category ("Veranstaltung"). */
    deploymentLabel: text('deployment_label'),
    /** Who may create a deployment: 'all' | 'lead' | 'admin'. */
    createPermission: text('create_permission').notNull().default('all'),
    /** The category's own DocSchema (sections/fields). Form config; never patient data. */
    schema: jsonb('schema'),
    sortOrder: integer('sort_order').notNull().default(0),
    color: text('color'),
    icon: text('icon'),
    active: boolean('active').notNull().default(true),
    /** Monotonic version; bumped on each update / soft-delete. */
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** keyId of the admin who last saved this category. */
    updatedByKeyId: text('updated_by_key_id').notNull(),
  },
  (t) => ({
    orgSortIdx: index('categories_org_sort_idx').on(t.orgId, t.sortOrder),
  }),
);

/**
 * Administrative AUDIT log (offboarding & admin actions). Immutable once
 * written (app role has INSERT/SELECT only). Records WHO/WHAT/WHEN — never
 * patient data, ciphertext, secrets, or invitation codes.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    actorKeyId: text('actor_key_id').notNull(),
    action: text('action').notNull(),
    targetKeyId: text('target_key_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    detail: text('detail'),
  },
  (t) => ({
    orgAtIdx: index('audit_log_org_at_idx').on(t.orgId, t.at, t.id),
  }),
);

/**
 * Tamper-evident ARCHIVAL ANCHORS over the record hash-chain. One row per
 * anchoring event for an org. Append-only-ish: the app role has INSERT/SELECT
 * only (an anchor is durable evidence, never mutated in place).
 *
 * INTEGRITY METADATA ONLY: `merkleRoot` is a BLAKE2b-256 Merkle root over the
 * org's PUBLIC `records.recordHash` values; `serverSignature` authenticates the
 * root to this server; `tsaToken`/`tsaTime` are an OPTIONAL RFC 3161 trusted
 * timestamp. NEVER patient data, ciphertext, a DEK, or a secret key — and the
 * server decrypts NOTHING to build it.
 */
export const notarizationAnchors = pgTable(
  'notarization_anchors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    /** base64 BLAKE2b-256 Merkle root over recordHash leaves (deploymentId, seq order). */
    merkleRoot: text('merkle_root').notNull(),
    /** Number of record leaves the root was built from (> 0). */
    recordCount: integer('record_count').notNull(),
    /** Pinned Merkle/signature scheme id, e.g. 'merkle-blake2b-256/v1'. */
    algorithm: text('algorithm').notNull(),
    /** base64 HMAC-SHA256 over the canonical anchor string (server-keyed). */
    serverSignature: text('server_signature').notNull(),
    /** RFC 3161 TSA-asserted time, null when no TSA configured. */
    tsaTime: timestamp('tsa_time', { withTimezone: true }),
    /** RFC 3161 timestamp token (DER), null when no TSA configured. Opaque, public. */
    tsaToken: bytea('tsa_token'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index('notarization_anchors_org_created_idx').on(t.orgId, t.createdAt),
  }),
);

export type NotarizationAnchorRow = typeof notarizationAnchors.$inferSelect;

/**
 * GDPR org-wide RETENTION policy (Löschkonzept). ONE row per org. Mutable
 * config (admin CRUD). `retentionDays` is measured from `records.received_at`
 * (server-authoritative, tamper-resistant) — NOT the client `created_at`.
 * NON-secret: a single integer + audit columns; no patient data, no key.
 */
export const retentionPolicies = pgTable('retention_policies', {
  orgId: uuid('org_id')
    .primaryKey()
    .references(() => orgs.orgId, { onDelete: 'restrict' }),
  /** Days after received_at a record may be retained before erasure. */
  retentionDays: integer('retention_days').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  /** keyId of the admin who last saved the policy. */
  updatedByKeyId: text('updated_by_key_id'),
});

/**
 * GDPR DELETION LOG — tamper-evident erasure audit. Append-only: a BEFORE
 * UPDATE/DELETE trigger raises (migration 0009) AND the app role has
 * INSERT/SELECT only. One row per executed crypto-shredding action. NON-secret
 * metadata only (WHO/WHAT/WHEN, counts, ids) — never patient data, ciphertext,
 * a DEK, or a secret key.
 */
export const deletionLog = pgTable(
  'deletion_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    /** 'policy' (retention sweep) | 'deployment' (single-event Art. 17 request). */
    scope: text('scope').notNull(),
    deploymentId: uuid('deployment_id'),
    recordsAffected: integer('records_affected').notNull(),
    sealedKeysDeleted: integer('sealed_keys_deleted').notNull(),
    /** ISO cutoff for scope 'policy' (received_at < cutoff); null for 'deployment'. */
    cutoff: text('cutoff'),
    reason: text('reason'),
    executedByKeyId: text('executed_by_key_id').notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgAtIdx: index('deletion_log_org_at_idx').on(t.orgId, t.executedAt, t.id),
  }),
);

export type RetentionPolicyRow = typeof retentionPolicies.$inferSelect;
export type DeletionLogRow = typeof deletionLog.$inferSelect;

/**
 * Material-/Verbrauchsmaterial-Verwaltung (inventory) CATALOG. MANY rows per org.
 *
 * MUTABLE operational LOGISTICS state: stock levels, units, expiry, low-stock
 * thresholds for consumables/equipment. This is NON-health data and is stored in
 * clear (normal grants; no append-only trigger). Soft-deletable via `active`.
 * NEVER add a patient/health column here. This is a NORMAL inventory — NOT a
 * Betäubungsmittel (BtM) / controlled-substance ledger.
 */
export const materialItems = pgTable(
  'material_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    /** Free/coded grouping (Verbandmaterial / Verbrauch / Gerät / Sonstiges). */
    category: text('category'),
    /** Unit of measure (Stk / Pkg / Paar / ml / l / Set). */
    unit: text('unit').notNull().default('Stk'),
    /** Current on-hand quantity; clamped >= 0 by the app on consumption. */
    stockQuantity: integer('stock_quantity').notNull().default(0),
    /** Low-stock threshold; stock <= this raises a warning. null = none. */
    minQuantity: integer('min_quantity'),
    /** Optional expiry calendar date (no time), as a YYYY-MM-DD string. */
    expiresAt: date('expires_at'),
    /** Optional free-text storage location. */
    location: text('location'),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** keyId of the admin/lead who last saved this item. */
    updatedByKeyId: text('updated_by_key_id').notNull(),
  },
  (t) => ({
    orgIdx: index('material_items_org_idx').on(t.orgId, t.active),
  }),
);

/**
 * Material CONSUMPTION log. MANY rows per org/deployment. MUTABLE so an admin/
 * lead may delete/correct an entry (restoring stock). Each row is a PER-
 * DEPLOYMENT AGGREGATE ("3× Mullbinde used in event X") — it is NEVER linked to
 * a patient or a `records` row. NON-health logistics metadata only. NEVER add a
 * patient/health (or record) column here.
 */
export const materialConsumption = pgTable(
  'material_consumption',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    deploymentId: uuid('deployment_id').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => materialItems.id, { onDelete: 'restrict' }),
    /** Snapshot of the item name at log time (readable even if renamed). */
    itemName: text('item_name').notNull(),
    /** Aggregate quantity consumed in this deployment (> 0, app-validated). */
    quantity: integer('quantity').notNull(),
    note: text('note'),
    recordedByKeyId: text('recorded_by_key_id').notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deploymentIdx: index('material_consumption_deployment_idx').on(
      t.orgId,
      t.deploymentId,
      t.recordedAt,
    ),
  }),
);

export type MaterialItemRow = typeof materialItems.$inferSelect;
export type MaterialConsumptionRow = typeof materialConsumption.$inferSelect;

/**
 * CIRS — ANONYMOUS critical-incident reports (quality management). APPEND-ONLY:
 * a BEFORE UPDATE/DELETE trigger raises (migration 0012) AND the app role has
 * INSERT/SELECT only.
 *
 * ANONYMITY IS THE CORE PROPERTY: this table holds ONLY ciphertext + the single
 * ORG-sealed DEK (crypto_box_seal — anonymous sender). There is DELIBERATELY NO
 * submitter / author / session / IP column — a report is NOT attributable to its
 * reporter, and it is NEVER signed. NEVER add such a column. `createdAt` is a
 * coarse calendar DATE (no time) to blunt timing correlation. Only QM/admin can
 * read a report, by opening the org-sealed DEK with the org secret key.
 */
export const cirsReports = pgTable(
  'cirs_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    /** { aead } algorithm pin — opaque. */
    alg: jsonb('alg').notNull(),
    /** base64 AEAD nonce. */
    nonce: text('nonce').notNull(),
    /** base64 AEAD payload (XChaCha20-Poly1305 over canonical JSON of the form). */
    ciphertext: text('ciphertext').notNull(),
    /** base64 crypto_box_seal(DEK, org box public key) — the ONLY recipient. */
    sealedKey: text('sealed_key').notNull(),
    /**
     * COARSENED to date precision (no time) to reduce timing correlation. The DB
     * default (CURRENT_DATE, migration 0012) supplies it — the route never sets
     * it, so no finer-grained timestamp is ever recorded.
     */
    createdAt: date('created_at')
      .notNull()
      .default(sql`CURRENT_DATE`),
  },
  (t) => ({
    orgIdx: index('cirs_reports_org_idx').on(t.orgId),
  }),
);

/**
 * CIRS QM workflow status — MUTABLE. ONE row per report. Only the REVIEWER is
 * identified here (reviewerKeyId, non-anonymous by design); never the reporter.
 */
export const cirsStatus = pgTable(
  'cirs_status',
  {
    reportId: uuid('report_id')
      .primaryKey()
      .references(() => cirsReports.id, { onDelete: 'restrict' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    /** 'neu' | 'in_bearbeitung' | 'abgeschlossen'. */
    status: text('status').notNull().default('neu'),
    /** keyId of the admin/QM reviewer who last changed the status; null until touched. */
    reviewerKeyId: text('reviewer_key_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('cirs_status_org_idx').on(t.orgId, t.status),
  }),
);

export type CirsReportRow = typeof cirsReports.$inferSelect;
export type CirsStatusRow = typeof cirsStatus.$inferSelect;

/**
 * Web push subscriptions (operational/administrative notifications only).
 *
 * PRIVACY: a row is OPERATIONAL METADATA — the browser's push endpoint plus the
 * public keys the browser itself published so the push service can encrypt the
 * payload. It is NOT patient data, a DEK, a password, or a secret key of ours.
 * Payloads we send carry only generic, content-free text + a route (see
 * routes/push.ts). One row per (browser endpoint); a user/device may have many.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** KeyId of the subscribing user — who receives the notification. */
    keyId: text('key_id').notNull(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => orgs.orgId, { onDelete: 'restrict' }),
    /** The push service endpoint URL — globally unique per browser subscription. */
    endpoint: text('endpoint').notNull().unique(),
    /** base64url P-256 ECDH public key published by the browser. */
    p256dh: text('p256dh').notNull(),
    /** base64url auth secret published by the browser (RFC 8291). */
    auth: text('auth').notNull(),
    /** optional human-readable device label. */
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    keyIdx: index('push_subscriptions_key_idx').on(t.keyId),
    orgIdx: index('push_subscriptions_org_idx').on(t.orgId),
  }),
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export type OrgRow = typeof orgs.$inferSelect;
export type RecoveryConfigRow = typeof recoveryConfig.$inferSelect;
export type OrgSchemaRow = typeof orgSchema.$inferSelect;
export type CategoryRow = typeof categories.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type HelperRow = typeof helpers.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;
export type CosignatureRequestRow = typeof cosignatureRequests.$inferSelect;
export type CosignatureRow = typeof cosignatures.$inferSelect;
export type RecordRow = typeof records.$inferSelect;
export type SealedKeyRow = typeof sealedKeys.$inferSelect;
export type SchemaRow = typeof schemas.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
