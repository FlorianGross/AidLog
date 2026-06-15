/**
 * @aidlog/contracts
 * -----------------
 * The single source of truth for the on-the-wire data model shared by
 * `crypto-core` (encryption), `api` (server) and `web` (client).
 *
 * Design invariants — DO NOT break without bumping ENVELOPE_VERSION:
 *  - The server only ever stores ciphertext + non-sensitive routing metadata.
 *  - Every protocol record is immutable, signed, and hash-chained.
 *  - Algorithm identifiers are pinned explicitly so old data stays decryptable.
 *
 * All binary values crossing the wire are base64 (standard, padded) strings.
 */

// ---------------------------------------------------------------------------
// Versioning & algorithm identifiers (pinned)
// ---------------------------------------------------------------------------

/** Bump on any breaking change to the envelope / record shape below. */
export const ENVELOPE_VERSION = 1 as const;

export type AeadAlg = 'xchacha20poly1305-ietf';
export type KdfAlg = 'argon2id';
/** libsodium crypto_box_seal: anonymous sender → X25519 recipient public key. */
export type SealAlg = 'x25519-sealedbox';
export type SignAlg = 'ed25519';
export type HashAlg = 'blake2b-256';

export const ALGORITHMS = {
  aead: 'xchacha20poly1305-ietf',
  kdf: 'argon2id',
  seal: 'x25519-sealedbox',
  sign: 'ed25519',
  hash: 'blake2b-256',
} as const satisfies {
  aead: AeadAlg;
  kdf: KdfAlg;
  seal: SealAlg;
  sign: SignAlg;
  hash: HashAlg;
};

/** Argon2id parameters. Tune `opsLimit`/`memLimit` per deployment hardware. */
export interface KdfParams {
  alg: KdfAlg;
  /** base64, 16+ bytes, unique per derived secret. */
  salt: string;
  opsLimit: number;
  /** bytes */
  memLimit: number;
}

// ---------------------------------------------------------------------------
// Identity & keys
// ---------------------------------------------------------------------------

/**
 * Stable identifier for an identity. CONVENTION (pinned): `keyId` is the
 * base64 (ORIGINAL variant) of the Ed25519 **signing** public key. This lets a
 * verifier recover the signing key directly from `authorKeyId` on a record.
 */
export type KeyId = string;

/** A public-key bundle published for an identity (org or helper). */
export interface PublicIdentity {
  keyId: KeyId;
  /** X25519 public key (base64) — used as crypto_box_seal recipient. */
  boxPublicKey: string;
  /** Ed25519 public key (base64) — used to verify signatures. */
  signPublicKey: string;
}

/** A secret key wrapped (symmetrically encrypted) with a password-derived key. */
export interface WrappedSecretKey {
  alg: AeadAlg;
  kdf: KdfParams;
  nonce: string; // base64
  ciphertext: string; // base64 — encrypts {boxSecretKey, signSecretKey}
}

/**
 * Organisation key material as stored by the server.
 * The server holds ONLY the public identity and the password-wrapped secret.
 * It can never derive the secret without the org password.
 */
export interface OrgKeyset {
  orgId: string;
  identity: PublicIdentity;
  wrappedSecret: WrappedSecretKey;
  /** Optional additional recovery wrappers (e.g. backup-key, future Shamir). */
  recoveryWrappers?: WrappedSecretKey[];
  createdAt: string; // ISO 8601
}

export interface HelperKeyset {
  helperId: string;
  orgId: string;
  identity: PublicIdentity;
  wrappedSecret: WrappedSecretKey;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Envelope: how a per-record data key (DEK) is wrapped to recipients
// ---------------------------------------------------------------------------

/**
 * 'author' is a PERSISTENT wrapper sealing the DEK to the record's OWN author, so
 * a helper retains read access to records THEY documented permanently and across
 * devices — even after shift close (which deletes only the transient 'helper'
 * wrapper). This is the explicitly chosen "Meine Einsätze" tradeoff; see
 * apps/web/src/lib/crypto/record.ts (buildRecord) and migration 0013.
 */
export type RecipientType = 'org' | 'helper' | 'cosigner' | 'supervisor' | 'author';

/** The per-record symmetric DEK, sealed to one recipient's box public key. */
export interface SealedKey {
  recipientType: RecipientType;
  recipientKeyId: KeyId;
  alg: SealAlg;
  /** base64 crypto_box_seal(DEK, recipientBoxPublicKey). */
  ciphertext: string;
}

// ---------------------------------------------------------------------------
// Encrypted content
// ---------------------------------------------------------------------------

/** The structured protocol JSON, AEAD-encrypted with the record DEK. */
export interface EncryptedPayload {
  alg: AeadAlg;
  nonce: string; // base64
  ciphertext: string; // base64 — AEAD over canonical JSON of the form data
  schemaId: string;
  schemaVersion: number;
}

/**
 * A binary attachment (photo, scan, signature image) encrypted with the same
 * record DEK via a streaming AEAD. The ciphertext itself lives in object
 * storage; this is only the descriptor.
 */
export interface EncryptedBlobRef {
  blobId: string; // object-storage id assigned by the server
  alg: AeadAlg;
  /** base64 secretstream header (per-blob). */
  header: string;
  /** ciphertext size in bytes. */
  size: number;
  /** base64 BLAKE2b-256 of the ciphertext, for integrity checks. */
  hash: string;
  /** original media type, needed to render after decryption. */
  mediaType: string;
  /** optional original filename, also AEAD-protected inside payload if sensitive. */
  label?: string;
}

// ---------------------------------------------------------------------------
// The immutable, signed, hash-chained protocol record
// ---------------------------------------------------------------------------

/**
 * One append-only event. A "deployment" (Einsatz) is an ordered chain of these.
 * Corrections never mutate; they append a new record with `supersedes` set.
 */
export interface ProtocolRecord {
  envelopeVersion: typeof ENVELOPE_VERSION;
  id: string; // uuid v4
  deploymentId: string; // groups records of one Einsatz
  seq: number; // 0-based position within the deployment chain
  /** client clock, ISO 8601. The server also records its own receipt time. */
  createdAt: string;
  authorKeyId: KeyId; // helper signing identity
  payload: EncryptedPayload;
  blobs: EncryptedBlobRef[];
  /** DEK sealed to org (+ to helper while the shift is open). */
  sealedKeys: SealedKey[];
  /** base64 hash of the previous record in this deployment, or null for seq 0. */
  prevHash: string | null;
  /** base64 BLAKE2b-256 over the canonical record (excluding recordHash+signature). */
  recordHash: string;
  /** base64 Ed25519 signature over recordHash by authorKeyId. */
  signature: string;
  alg: { aead: AeadAlg; sign: SignAlg; hash: HashAlg };
  /** id of the record this one corrects, if any. */
  supersedes?: string | null;
}

/** Fields the client computes a recordHash over (everything except hash+sig). */
export type SignableRecord = Omit<ProtocolRecord, 'recordHash' | 'signature'>;

// ---------------------------------------------------------------------------
// Configurable protocol schema (the "modifiable fields" requirement)
// ---------------------------------------------------------------------------

/**
 * Versioned form definition. The web client renders the data-entry form
 * dynamically from `jsonSchema` + `uiSchema`; the api validates submitted
 * (decrypted) payloads against it only on the client — the server never sees
 * plaintext, so schema validation is a client-side concern.
 */
export interface SchemaDefinition {
  schemaId: string;
  version: number;
  title: string;
  description?: string;
  /** JSON Schema draft 2020-12 describing the protocol fields. */
  jsonSchema: Record<string, unknown>;
  /** Optional rendering hints: field order, widget types, grouping, i18n keys. */
  uiSchema?: Record<string, unknown>;
  createdAt: string;
  /** Schema documents may themselves be signed by the org for integrity. */
  signature?: string;
  authorKeyId?: KeyId;
}

// ---------------------------------------------------------------------------
// API surface (DTOs). The server is a thin authenticated sync + blob store.
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export interface RegisterOrgRequest {
  orgName: string;
  identity: PublicIdentity;
  wrappedSecret: WrappedSecretKey;
}

export interface RegisterHelperRequest {
  orgId: string;
  displayName: string;
  identity: PublicIdentity;
  wrappedSecret: WrappedSecretKey;
}

/** Auth is by proof-of-possession of the signing key (challenge/response). */
export interface AuthChallenge {
  challenge: string; // base64 random nonce
  expiresAt: string;
}
export interface AuthVerifyRequest {
  keyId: KeyId;
  challenge: string;
  /** Ed25519 signature over the challenge. */
  signature: string;
}
export interface AuthSession {
  token: string;
  expiresAt: string;
  keyId: KeyId;
  orgId: string;
  role: Role;
}

/** Client → server: append a new record (server rejects any mutation of existing). */
export interface AppendRecordRequest {
  record: ProtocolRecord;
}
export interface AppendRecordResponse {
  id: string;
  /** server receipt timestamp (independent of client clock). */
  receivedAt: string;
  seq: number;
}

/** Request a pre-authorized slot to upload an encrypted blob. */
export interface BlobUploadTicket {
  blobId: string;
  uploadUrl: string;
  method: 'PUT' | 'POST';
  headers?: Record<string, string>;
  expiresAt: string;
}

export interface DeploymentSummary {
  deploymentId: string;
  recordCount: number;
  firstSeq: number;
  lastSeq: number;
  lastRecordHash: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// "Meine Einsätze" — the deployments the caller authored (cross-device, read-only)
//
// The server groups the caller's OWN records (author_key_id == session.keyId) by
// deploymentId and returns ONLY non-secret routing metadata: the deployment id,
// how many records the caller authored in it, and the first/last client
// timestamps. It NEVER returns ciphertext, titles or categories — the server
// cannot know those (they live inside the encrypted payload / in client-local
// DeploymentMeta). The web client decrypts the synced records (now possible via
// the persistent 'author' sealed-key wrapper) to recover a display label.
// ---------------------------------------------------------------------------

export interface MyDeploymentSummary {
  deploymentId: string;
  /** Number of records the caller authored in this deployment. */
  recordCount: number;
  /** Earliest client `createdAt` (ISO 8601) among the caller's records here. */
  firstCreatedAt: string;
  /** Latest client `createdAt` (ISO 8601) among the caller's records here. */
  lastCreatedAt: string;
}

/** GET ROUTES.myDeployments — the caller's authored deployments, newest first. */
export interface MyDeploymentsResponse {
  deployments: MyDeploymentSummary[];
}

/** Server → client sync: records the client is permitted to read (by role). */
export interface SyncResponse {
  records: ProtocolRecord[];
  /** opaque cursor for incremental sync. */
  cursor: string;
  hasMore: boolean;
}

/**
 * Shift-end "soft revocation": the server deletes the helper-sealed envelope
 * for the given deployment so only the org wrapper remains. Append-only data
 * is untouched; only the redundant helper key-wrapper is removed.
 */
export interface CloseShiftRequest {
  deploymentId: string;
  helperKeyId: KeyId;
}

export const ROUTES = {
  health: '/api/health',
  registerOrg: '/api/orgs',
  registerHelper: '/api/helpers',
  authChallenge: '/api/auth/challenge',
  authVerify: '/api/auth/verify',
  records: '/api/records',
  blobTicket: '/api/blobs/ticket',
  sync: '/api/sync',
  schemas: '/api/schemas',
  closeShift: '/api/shifts/close',
  // --- user system & org ---
  orgInfo: '/api/org', // GET: public org identity (so clients can seal DEKs to org)
  users: '/api/users', // GET list (admin/lead); PATCH /:id role/status
  account: '/api/account', // GET (auth) the caller's OWN account incl. qualification
  userQualification: '/api/users/:keyId/qualification', // PATCH (admin) set a user's qualification
  deploymentRoster: '/api/deployments/:id/roster', // GET (auth, org) roster; POST/PUT upsert check-in/out
  invitations: '/api/invitations', // POST create (admin); GET list
  redeemInvitation: '/api/invitations/redeem', // POST: helper redeems a code -> account
  // --- co-signature ---
  cosignRequests: '/api/cosign', // POST create request (+sealed keys); GET mine (pending)
  cosignSubmit: '/api/cosign/sign', // POST a signature (or rejection) for a request
  sealedKeys: '/api/records/sealed-keys', // POST additional sealed keys for a record (cosign grants)
  // --- key recovery (Shamir) & audit ---
  orgKeyset: '/api/org/keyset', // GET (admin) the org keyset incl. wrappedSecret; PUT to re-wrap
  orgRecovery: '/api/org/recovery', // GET/POST recovery METADATA (never the shares)
  audit: '/api/audit', // GET org audit log (admin)
  // --- configurable protocol schema (in-app schema editor) ---
  orgSchema: '/api/org/schema', // GET (auth) active schema; PUT (admin) to replace it
  // --- protocol categories (Sanitätsdienst / HvO / EGB …) ---
  orgCategories: '/api/org/categories', // GET (auth) list; POST (admin) upsert; DELETE (admin) ?id=
  // --- supervisors (Einsatzleiter/Admin) public keys, for sealing records to them ---
  orgSupervisors: '/api/org/supervisors', // GET (auth) public identities of active admins + leads
  // --- web push (operational/administrative notifications ONLY) ---
  pushVapidKey: '/api/push/vapid', // GET (auth) the server's public VAPID key
  pushSubscribe: '/api/push/subscribe', // POST (auth) store the caller's push subscription
  pushUnsubscribe: '/api/push/unsubscribe', // POST (auth) remove a push subscription
  // --- archival anchoring (tamper-evident Merkle anchor + trusted timestamp) ---
  notarize: '/api/notarize', // POST create anchor (admin/lead); GET list anchors (admin/lead)
  // --- GDPR data protection (Löschkonzept / retention + crypto-shredding erasure) ---
  orgRetention: '/api/org/retention', // GET (admin) current policy | null; PUT (admin) upsert
  orgRetentionPurge: '/api/org/retention/purge', // POST (admin) crypto-shred (dryRun preview or execute)
  deletionLog: '/api/org/deletion-log', // GET (admin) tamper-evident erasure audit, newest first
  // --- Material-/Verbrauchsmaterial-Verwaltung (inventory) ---
  orgMaterial: '/api/org/material', // GET (auth) list items; POST (admin/lead) create
  orgMaterialItem: '/api/org/material/:id', // PUT (admin/lead) update; DELETE (admin/lead) deactivate/delete
  deploymentConsumption: '/api/deployments/:id/consumption', // GET (auth) list; POST (auth) log; DELETE (admin/lead) ?entryId=
  // --- CIRS (anonymous critical-incident reporting) ---
  cirs: '/api/cirs', // POST (auth, anonymous) submit a report; GET (admin) list reports to decrypt
  cirsStatus: '/api/cirs/:id/status', // PUT (admin) set a report's QM workflow status
  // --- "Meine Einsätze" (the caller's own authored deployments, cross-device) ---
  myDeployments: '/api/my/deployments', // GET (auth) ids+counts+timestamps of deployments the caller authored
} as const;

/**
 * The org's configurable protocol schema. These are FIELD DEFINITIONS (sections,
 * field labels/types) — org configuration, NOT patient data — so they are stored
 * in clear. The web app's `DocSchema` (sections/fields) is carried as opaque JSON
 * in `schema`; the client casts it. Editing the protocol = saving a new version
 * here, no code change.
 */
export interface OrgSchemaDocument {
  orgId: string;
  version: number;
  updatedAt: string;
  updatedByKeyId: KeyId;
  schema: unknown;
}

export interface SetOrgSchemaRequest {
  schema: unknown;
}

// ===========================================================================
// Protocol categories (Sanitätsdienst / HvO / EGB …)
//
// An admin defines categories, each with its OWN protocol schema (a DocSchema as
// opaque JSON, like org_schema) and a permission deciding who may create a
// deployment under it. For a Sanitätsdienst, `createPermission: 'all'` lets every
// user create an event ("Veranstaltung"). Existing deployments without a
// categoryId keep using the single org schema / ABCDE default (backward compat).
// ===========================================================================

export type CategoryCreatePermission = 'all' | 'lead' | 'admin';

export interface ProtocolCategory {
  id: string;
  orgId: string;
  name: string; // "Sanitätsdienst", "HvO", "EGB"
  description?: string;
  /** Singular term shown in the UI for a deployment of this category. */
  deploymentLabel?: string; // "Veranstaltung" | "Einsatz" | …
  createPermission: CategoryCreatePermission;
  /** The category's own DocSchema (sections/fields), carried as opaque JSON. */
  schema: unknown;
  sortOrder: number;
  color?: string;
  icon?: string;
  active: boolean;
  version: number;
  updatedAt: string;
  updatedByKeyId: KeyId;
}

export interface UpsertCategoryRequest {
  id?: string; // omit to create, set to update
  name: string;
  description?: string;
  deploymentLabel?: string;
  createPermission: CategoryCreatePermission;
  schema?: unknown;
  sortOrder?: number;
  color?: string;
  icon?: string;
  active?: boolean;
}

export interface CategoryListResponse {
  categories: ProtocolCategory[];
}

// ===========================================================================
// Supervisors (Einsatzleiter / Admin) — read access for event statistics
//
// So that an Einsatzleiter can see a deployment's statistics, NEW records are
// additionally sealed to every active supervisor (admin + lead). Any
// authenticated user fetches the supervisors' PUBLIC identities here to seal the
// per-record DEK to them (recipientType 'supervisor'). Public keys only — no
// secret material. Forward-only: pre-existing records aren't retroactively
// sealed to supervisors.
// ===========================================================================

export interface SupervisorRecipient {
  identity: PublicIdentity;
  role: Role; // 'admin' | 'lead'
}

export interface SupervisorListResponse {
  supervisors: SupervisorRecipient[];
}

/**
 * Replace the org's password-wrapped secret (and optional recovery wrappers).
 * Used after a Shamir recovery re-wraps the reconstructed org secret under a NEW
 * org password. The server stores only ciphertext; it never sees the secret.
 */
export interface UpdateOrgKeysetRequest {
  wrappedSecret: WrappedSecretKey;
  recoveryWrappers?: WrappedSecretKey[];
}

// ===========================================================================
// Organisation key recovery (Shamir) — METADATA ONLY
//
// The org secret key can be split into N shares with a threshold T (Shamir).
// Shares are distributed to human trustees (printed / exported) and NEVER sent
// to the server. The server stores only non-secret metadata so the org knows
// recovery is configured and who the trustees are. Reconstruction happens
// entirely client-side: collect T shares -> rebuild the org secret -> re-wrap
// under a new org password. See @aidlog/crypto-core split/combine.
// ===========================================================================

export interface RecoveryTrustee {
  id: string;
  label: string; // e.g. "Bereitschaftsleitung", "Stellv. Leitung"
}

export interface RecoveryConfig {
  orgId: string;
  threshold: number; // T shares required to reconstruct
  shareCount: number; // N shares issued
  trustees: RecoveryTrustee[];
  createdAt: string;
  createdByKeyId: KeyId;
  /** BLAKE2b of the org public box key — lets recovery verify a correct rebuild. */
  orgKeyCheck?: string;
}

export interface SetRecoveryConfigRequest {
  threshold: number;
  shareCount: number;
  trustees: { label: string }[];
  orgKeyCheck?: string;
}

// ===========================================================================
// Audit log (offboarding & administrative actions)
// Non-sensitive administrative events; never patient data.
// ===========================================================================

export type AuditAction =
  | 'user.invited'
  | 'user.redeemed'
  | 'user.disabled'
  | 'user.enabled'
  | 'user.role-changed'
  | 'recovery.configured'
  | 'shift.closed'
  /** An archival Merkle anchor over the org's record hash-chain was created. */
  | 'archive.anchored'
  /** A protocol category was created or updated (incl. soft-delete) by an admin. */
  | 'category.updated';

export interface AuditEntry {
  id: string;
  orgId: string;
  actorKeyId: KeyId;
  action: AuditAction;
  targetKeyId?: KeyId;
  at: string;
  detail?: string;
}

export interface AuditListResponse {
  entries: AuditEntry[];
}

// ===========================================================================
// User system, roles & invitations
// ===========================================================================

/**
 * Roles (least → most privilege):
 *  - 'helper' : Helfer — create deployments and document patient contacts.
 *  - 'lead'   : Einsatzleiter — everything a helper can, plus run/close shifts,
 *               request and provide co-signatures, see all org deployments.
 *  - 'admin'  : Administrator — org-key custodian + full user management
 *               (create invitations, enable/disable users, assign roles).
 */
export type Role = 'admin' | 'lead' | 'helper';

export const ROLES: readonly Role[] = ['admin', 'lead', 'helper'] as const;

// ===========================================================================
// Sanitätsdienst QUALIFICATION (Ausbildungsstand) — OPERATIONAL metadata
//
// A helper's qualification level is NON-health, OPERATIONAL personnel metadata
// (an Ausbildungsstand), NOT Art. 9 special-category data. It MAY therefore be
// stored server-side in PLAINTEXT alongside the account. It is an ORDERED scale:
// the canonical list below pins each value's German label and its ordinal
// `rank` (lowest → highest). This is the SINGLE source of truth shared by api +
// web so a section's `minQualification` gate and the admin selector agree.
//
// "unset" (no qualification assigned) is represented as `null`, with rank 0 via
// `qualificationRank(null)` — i.e. below every named level.
// ===========================================================================

/** Ordered Sanitätsdienst qualification levels (lowest → highest). */
export type Qualification = 'sanh' | 'san' | 'rs' | 'notsan' | 'arzt';

export interface QualificationDef {
  value: Qualification;
  /** German label (literal, consistent with abcde.ts enum labels). */
  label: string;
  /** Ordinal, 1-based ascending. Higher = more qualified. */
  rank: number;
}

/**
 * Canonical ordered list. ranks are 1-based and ascending; an unset/null
 * qualification ranks 0 (below `sanh`). DO NOT reorder without a data review —
 * the `rank` is the comparison key for section gating.
 */
export const QUALIFICATIONS: readonly QualificationDef[] = [
  { value: 'sanh', label: 'Sanitätshelfer', rank: 1 },
  { value: 'san', label: 'Sanitäter', rank: 2 },
  { value: 'rs', label: 'Rettungssanitäter', rank: 3 },
  { value: 'notsan', label: 'Notfallsanitäter', rank: 4 },
  { value: 'arzt', label: 'Arzt/Notärztin', rank: 5 },
] as const;

/** True for any valid {@link Qualification} value. */
export function isQualification(value: unknown): value is Qualification {
  return typeof value === 'string' && QUALIFICATIONS.some((q) => q.value === value);
}

/**
 * Ordinal rank for comparisons. An unset (null/undefined) or unknown value
 * ranks 0 — below every named level — so an under-qualified/unset user is gated
 * out of any section that sets a `minQualification`.
 */
export function qualificationRank(q: Qualification | null | undefined): number {
  if (q == null) return 0;
  return QUALIFICATIONS.find((def) => def.value === q)?.rank ?? 0;
}

/** German label for a qualification, or a neutral dash for unset. */
export function qualificationLabel(q: Qualification | null | undefined): string {
  if (q == null) return '—';
  return QUALIFICATIONS.find((def) => def.value === q)?.label ?? '—';
}

export interface UserAccount {
  helperId: string;
  orgId: string;
  displayName: string;
  role: Role;
  identity: PublicIdentity;
  status: 'active' | 'disabled';
  /** Sanitätsdienst qualification (operational, non-health). null = unset. */
  qualification?: Qualification | null;
  createdAt: string;
  /** keyId of the admin who created the invitation this account was redeemed from. */
  invitedByKeyId?: KeyId;
  lastSeenAt?: string;
}

/** PATCH ROUTES.userQualification — admin sets a user's qualification (or clears it). */
export interface SetQualificationRequest {
  qualification: Qualification | null;
}

/**
 * GET ROUTES.account — the CALLER's own account (any authenticated user). Lets a
 * helper learn their own qualification (for client-side section gating) without
 * the admin-only user list. Non-secret routing metadata only.
 */
export interface OwnAccountResponse {
  helperId: string;
  orgId: string;
  displayName: string;
  role: Role;
  qualification: Qualification | null;
}

/** Public org identity, served so any client can seal a DEK to the org. */
export interface OrgPublicInfo {
  orgId: string;
  orgName: string;
  identity: PublicIdentity;
}

// --- invitation flow (accounts are created ONLY by an admin) ---------------

export type InvitationStatus = 'pending' | 'redeemed' | 'revoked' | 'expired';

export interface Invitation {
  id: string;
  orgId: string;
  role: Role;
  /** suggested display name; the redeemer may override. */
  displayName?: string;
  status: InvitationStatus;
  createdByKeyId: KeyId;
  createdAt: string;
  expiresAt: string;
  redeemedByKeyId?: KeyId;
  redeemedAt?: string;
}

export interface CreateInvitationRequest {
  role: Role;
  displayName?: string;
  /** lifetime of the single-use code; server clamps to a sane maximum. */
  expiresInHours?: number;
}

/** The single-use `code` is returned ONCE on creation and never stored in clear. */
export interface CreateInvitationResponse {
  invitation: Invitation;
  code: string;
}

export interface RedeemInvitationRequest {
  code: string;
  displayName: string;
  identity: PublicIdentity;
  /** the redeemer's own secret keys, wrapped under their chosen password. */
  wrappedSecret: WrappedSecretKey;
}

export interface RedeemInvitationResponse {
  account: UserAccount;
  org: OrgPublicInfo;
}

export interface UpdateUserRequest {
  helperId: string;
  role?: Role;
  status?: 'active' | 'disabled';
}

export interface UserListResponse {
  users: UserAccount[];
}

// ===========================================================================
// Anwesenheit / Dienst (per-deployment ROSTER) — OPERATIONAL metadata
//
// Who is on duty for a given deployment (Einsatz/Veranstaltung): a check-in/out
// log with each helper's display name + qualification + role-at-event. This is
// OPERATIONAL personnel/duty metadata — NOT patient/health data — so it lives
// server-side in PLAINTEXT (NEVER put any patient/health field here). The table
// is MUTABLE (normal grants): a helper may check themselves in/out; an admin or
// lead may manage anyone in the org. Everything is scoped to the caller's org.
// ===========================================================================

export interface RosterEntry {
  deploymentId: string;
  helperKeyId: KeyId;
  displayName: string;
  /** Snapshot of the helper's qualification at roster time (operational). */
  qualification: Qualification | null;
  /** Free-text duty/role for this event, e.g. "Zugführer", "Trupp 1". */
  roleAtEvent?: string | null;
  /** ISO 8601 check-in time, or null if not yet checked in. */
  checkedInAt?: string | null;
  /** ISO 8601 check-out time, or null while still on duty. */
  checkedOutAt?: string | null;
}

export interface RosterListResponse {
  entries: RosterEntry[];
}

/**
 * POST/PUT ROUTES.deploymentRoster — upsert one roster entry (check-in/out,
 * role-at-event). A helper may upsert only their OWN entry (helperKeyId omitted
 * or equal to their keyId); an admin/lead may upsert anyone's. The server fills
 * displayName + qualification from the target account; only operational duty
 * fields are accepted from the client.
 */
export interface RosterUpsertRequest {
  /** Target helper keyId. Omit to act on yourself (self check-in/out). */
  helperKeyId?: KeyId;
  roleAtEvent?: string | null;
  /** 'in' stamps checkedInAt now; 'out' stamps checkedOutAt now; omit to only set roleAtEvent. */
  action?: 'in' | 'out';
}

// ===========================================================================
// Co-signature (Gegenzeichnung) — co-signer reads AND signs
// ===========================================================================

export type CosignStatus = 'pending' | 'partially-signed' | 'complete' | 'rejected';

/**
 * A request asking one or more users to counter-sign a finalised record.
 * Because signers must be able to READ what they sign, the requester seals the
 * record DEK to each requested signer (POST ROUTES.sealedKeys with
 * recipientType 'cosigner') as part of creating the request.
 */
export interface CosignatureRequest {
  id: string;
  recordId: string;
  deploymentId: string;
  orgId: string;
  requestedByKeyId: KeyId;
  /** signing identities asked to counter-sign (helper/lead keyIds). */
  requestedSigners: KeyId[];
  status: CosignStatus;
  createdAt: string;
  note?: string;
}

export interface CreateCosignatureRequest {
  recordId: string;
  deploymentId: string;
  requestedSigners: KeyId[];
  /** DEK sealed to each requested signer, to be stored in sealed_keys. */
  sealedKeys: SealedKey[];
  note?: string;
}

export type CosignDecision = 'signed' | 'rejected';

export interface Cosignature {
  id: string;
  requestId: string;
  recordId: string;
  signerKeyId: KeyId;
  decision: CosignDecision;
  /** Ed25519 signature over the record's recordHash by the co-signer. */
  signature: string;
  /** optional hand-drawn signature image, AEAD-encrypted under the record DEK. */
  signatureImage?: EncryptedBlobRef;
  signedAt: string;
}

export interface SubmitCosignatureRequest {
  requestId: string;
  decision: CosignDecision;
  signature: string;
  signatureImage?: EncryptedBlobRef;
}

/** POST ROUTES.sealedKeys — attach more wrapped DEKs to an existing record. */
export interface AddSealedKeysRequest {
  recordId: string;
  sealedKeys: SealedKey[];
}

// ===========================================================================
// Archival anchoring (legally-robust, tamper-evident) — NON-CONTENT METADATA
//
// `records.recordHash` (with prevHash + seq) is NON-secret integrity metadata the
// blind server already stores. The server can therefore build a deterministic
// Merkle tree over ALL of an org's recordHashes — producing a single `merkleRoot`
// that proves the set of records existed and is internally consistent — WITHOUT
// decrypting anything. "Anchoring" = signing that root server-side (baseline) and
// OPTIONALLY obtaining an RFC 3161 trusted timestamp, then storing the result.
//
// Later, anyone holding the org's recordHashes (via the existing scope=org sync
// metadata — recordHash/seq/deploymentId only, no decryption) can RECOMPUTE the
// root and confirm it matches a stored anchor, proving the data was neither
// backdated (timestamp) nor altered (root mismatch would reveal it).
//
// REPRODUCIBLE MERKLE RULE (server AND client MUST agree, see anchor.ts):
//   1. LEAVES: take every record's `recordHash` for the org. Order them by
//      (deploymentId ASC, seq ASC) — a total order, since (deploymentId, seq) is
//      unique. Each leaf = BLAKE2b-256( 0x00 || rawBytes(recordHash) ), where
//      rawBytes is the base64-decode of the stored recordHash. The 0x00 leaf
//      prefix gives second-preimage resistance (RFC 6962 style).
//   2. NODES: parent = BLAKE2b-256( 0x01 || left || right ).
//   3. ODD level: if a level has an odd node count, the last node is DUPLICATED
//      (paired with itself) — classic Bitcoin-style duplication.
//   4. The `merkleRoot` is the base64 of the final root hash. recordCount = leaf
//      count. An empty set (recordCount 0) has no anchor (the route rejects it).
// ===========================================================================

/** Algorithm pin for the Merkle anchor + server signature scheme. */
export type AnchorAlg = 'merkle-blake2b-256/v1';

/**
 * A stored notarization anchor over an org's record hash-chain. Carries ONLY
 * non-secret integrity metadata: a Merkle root over public recordHashes, a
 * server signature over that root, and (optionally) an RFC 3161 timestamp. It
 * NEVER contains patient data, ciphertext, DEKs, or secret keys.
 */
export interface NotarizationAnchor {
  id: string;
  orgId: string;
  /** base64 BLAKE2b-256 Merkle root over the org's recordHashes (see rule above). */
  merkleRoot: string;
  /** Number of record leaves the root was built from. */
  recordCount: number;
  /** Pinned Merkle/signature scheme identifier. */
  algorithm: AnchorAlg;
  /** Server receipt time the anchor was created (ISO 8601, server clock). */
  createdAt: string;
  /**
   * base64 server signature over the canonical anchor string
   * `${algorithm}:${merkleRoot}:${recordCount}` (HMAC-SHA256, keyed by a
   * dedicated server secret). Proves the root was anchored by THIS server; it is
   * NOT a content key and cannot decrypt anything.
   */
  serverSignature: string;
  /** RFC 3161 TSA-asserted time (ISO 8601), present only if a TSA was configured. */
  tsaTime?: string;
  /** True when an RFC 3161 timestamp token is stored alongside this anchor. */
  tsaTokenPresent?: boolean;
}

/** POST ROUTES.notarize → the anchor that was just created. */
export interface CreateAnchorResponse {
  anchor: NotarizationAnchor;
}

/** GET ROUTES.notarize → all anchors for the caller's org, newest first. */
export interface AnchorListResponse {
  anchors: NotarizationAnchor[];
}

// ===========================================================================
// Web push notifications (OPERATIONAL / ADMINISTRATIVE events only)
//
// PRIVACY-CRITICAL: push payloads carry ONLY generic, content-free text plus a
// route to open. NEVER patient data, record/deployment content, names, or any
// identifier that reveals content. A subscription is operational metadata
// (browser endpoint + the keys the browser itself published for encryption);
// the server never sees patient data through this channel.
//
// The shape mirrors the browser `PushSubscription.toJSON()` output so the web
// client can post it verbatim after `pushManager.subscribe()`.
// ===========================================================================

/** A browser push subscription, as produced by `PushSubscription.toJSON()`. */
export interface PushSubscriptionDTO {
  /** The push service endpoint URL the browser registered with. */
  endpoint: string;
  /** Public keys the browser published so the server can encrypt the payload. */
  keys: {
    /** base64url P-256 ECDH public key (client-generated, not a secret of ours). */
    p256dh: string;
    /** base64url auth secret for the message encryption (per RFC 8291). */
    auth: string;
  };
}

/** POST ROUTES.pushSubscribe — register the caller's subscription. */
export interface RegisterPushRequest {
  subscription: PushSubscriptionDTO;
  /** optional human-readable device label (e.g. "Dienst-Tablet"). */
  label?: string;
}

/** GET ROUTES.pushVapidKey — the server's public VAPID key (or null if push is off). */
export interface PushVapidKeyResponse {
  /** base64url VAPID application server public key, or null when push is not configured. */
  publicKey: string | null;
}

// ===========================================================================
// GDPR DATA PROTECTION — Löschkonzept (retention) + erasure via CRYPTO-SHREDDING
//
// THE CENTRAL PRINCIPLE: the server holds ONLY ciphertext + non-secret routing
// metadata; it has no decryption keys. GDPR erasure (Art. 17) is therefore
// implemented as CRYPTO-SHREDDING — to "erase" a record's personal data we
// DELETE its rows in `sealed_keys`. Once every wrapper of a record's DEK is
// gone, the DEK can never be recovered by anyone (not even with the org
// password), so the AEAD ciphertext in `records.payload` and the encrypted
// blobs become permanently undecryptable = erased. The append-only `records`
// rows (hash-chain + Ed25519 signatures) stay in place for audit integrity;
// only their keys are stripped. NOTHING decrypted is ever exposed here — these
// endpoints carry ciphertext-free, non-secret metadata only (counts, ids,
// timestamps, policy numbers).
//
// CAVEAT (surfaced in the UI + infra/BACKUP.md): crypto-shredding takes effect
// in restorable backups only AFTER the backups containing the deleted
// sealed_keys have rotated out of the retention window.
// ===========================================================================

/**
 * Org-wide retention policy. Per-category retention is NOT server-enforceable
 * (the category lives inside the ciphertext), so retention is org-wide. It is
 * measured from `records.received_at` (server-authoritative, tamper-resistant),
 * NOT the client `created_at`.
 */
export interface RetentionPolicy {
  /** Days after `received_at` that records may be retained before erasure. */
  retentionDays: number;
  updatedAt: string; // ISO 8601
  updatedByKeyId?: KeyId;
}

/** PUT ROUTES.orgRetention — upsert the org-wide retention period. */
export interface SetRetentionRequest {
  retentionDays: number;
}

/**
 * POST ROUTES.orgRetentionPurge — erase personal data via crypto-shredding.
 *  - scope 'policy'     : erase records older than the configured retention.
 *  - scope 'deployment' : erase ALL records of one deployment (Art. 17 single
 *                         event request); `deploymentId` is non-secret metadata.
 *  - `dryRun` : COUNT only; change nothing; return the would-affect numbers.
 */
export interface PurgeRequest {
  scope: 'policy' | 'deployment';
  deploymentId?: string;
  dryRun?: boolean;
}

/** Result of a purge — non-secret counts only; never any decrypted content. */
export interface PurgeResponse {
  scope: 'policy' | 'deployment';
  dryRun: boolean;
  /** distinct records whose keys were (or would be) shredded. */
  recordsAffected: number;
  /** sealed_keys rows deleted (or that would be deleted). */
  sealedKeysDeleted: number;
  /** distinct deployments touched. */
  deploymentsAffected: number;
  /** ISO cutoff for scope 'policy' (received_at < cutoff). Absent for 'deployment'. */
  cutoff?: string;
}

/**
 * One tamper-evident entry in the erasure audit (`deletion_log`). The table is
 * append-only (SELECT+INSERT only; a reject-UPDATE/DELETE trigger mirrors the
 * `records` pattern). Non-secret metadata only — never decrypted content.
 */
export interface DeletionLogEntry {
  id: string;
  scope: 'policy' | 'deployment';
  deploymentId?: string;
  recordsAffected: number;
  sealedKeysDeleted: number;
  cutoff?: string;
  reason?: string;
  executedByKeyId: KeyId;
  executedAt: string; // ISO 8601
}

/** GET ROUTES.deletionLog — erasure audit for the org, newest first. */
export interface DeletionLogResponse {
  entries: DeletionLogEntry[];
}

// ===========================================================================
// Material-/Verbrauchsmaterial-Verwaltung (inventory) — OPERATIONAL metadata
//
// A plain consumables/equipment inventory: stock levels, units, expiry,
// low-stock thresholds, plus a PER-DEPLOYMENT-AGGREGATE consumption log
// ("3× Mullbinde used in event X").
//
// PRIVACY-CRITICAL: this is OPERATIONAL, NON-health logistics metadata. It is
// stored server-side in PLAINTEXT (MUTABLE tables). It is NEVER patient/health
// data: consumption is tracked per DEPLOYMENT AGGREGATE only and is NEVER linked
// to an individual patient or protocol record. Patient-specific medication stays
// inside the encrypted protocol's `medikamente` group — it is NOT mirrored here.
// NEVER put a patient/health field into these types, tables, or logs. This is
// EXPLICITLY a normal-consumables inventory — NOT a Betäubungsmittel (BtM) /
// controlled-substance register.
// ===========================================================================

/** Unit of measure for a material item (free-form on the wire; these are the UI presets). */
export type MaterialUnit = 'Stk' | 'Pkg' | 'Paar' | 'ml' | 'l' | 'Set';

/** Canonical UI list of units (the catalog field is a free string; this drives the picker). */
export const MATERIAL_UNITS: readonly MaterialUnit[] = ['Stk', 'Pkg', 'Paar', 'ml', 'l', 'Set'];

/**
 * One catalog item (a consumable or piece of equipment). `stockQuantity` is the
 * current on-hand count; `minQuantity` is the optional low-stock threshold;
 * `expiresAt` is an optional ISO date (YYYY-MM-DD). The derived `lowStock` /
 * `expiringSoon` / `expired` flags are convenience booleans the server MAY fill;
 * the client also computes them from the raw fields (see web `$lib/material`).
 */
export interface MaterialItem {
  id: string;
  orgId: string;
  name: string;
  /** Free/coded grouping, e.g. Verbandmaterial / Verbrauch / Gerät / Sonstiges. */
  category?: string | null;
  /** Unit of measure, e.g. Stk / Pkg / Paar / ml / l / Set. */
  unit: string;
  /** Current on-hand quantity. */
  stockQuantity: number;
  /** Low-stock threshold; stock <= this raises a warning. null = no threshold. */
  minQuantity?: number | null;
  /** Optional expiry date as an ISO calendar date (YYYY-MM-DD). */
  expiresAt?: string | null;
  /** Optional free-text storage location (e.g. "Rucksack 2", "Lager Regal B"). */
  location?: string | null;
  active: boolean;
  updatedAt: string; // ISO 8601
  updatedByKeyId: KeyId;
}

/**
 * POST/PUT body for a catalog item. Omit `id` semantics are not used here (the id
 * is in the URL for PUT); this is the mutable field set. `category`, `minQuantity`,
 * `expiresAt`, `location` are optional/nullable.
 */
export interface UpsertMaterialItemRequest {
  name: string;
  category?: string | null;
  unit: string;
  stockQuantity: number;
  minQuantity?: number | null;
  expiresAt?: string | null;
  location?: string | null;
  active?: boolean;
}

/** GET ROUTES.orgMaterial — the org's catalog items. */
export interface MaterialListResponse {
  items: MaterialItem[];
}

/**
 * One consumption entry: a PER-DEPLOYMENT AGGREGATE record that `quantity` units
 * of `itemId` were used during `deploymentId`. NEVER linked to a patient/record.
 */
export interface ConsumptionEntry {
  id: string;
  orgId: string;
  deploymentId: string;
  itemId: string;
  /** Snapshot of the item name at log time, so the list is readable even if the item is later renamed/deleted. */
  itemName: string;
  quantity: number;
  note?: string | null;
  recordedByKeyId: KeyId;
  recordedAt: string; // ISO 8601
}

/** GET ROUTES.deploymentConsumption — consumption entries for one deployment. */
export interface ConsumptionListResponse {
  entries: ConsumptionEntry[];
}

/**
 * POST ROUTES.deploymentConsumption — log consumption for a deployment. The
 * server decrements the item's stock transactionally (clamped at 0). `quantity`
 * must be a positive number. NO patient/record linkage is accepted or stored.
 */
export interface LogConsumptionRequest {
  itemId: string;
  quantity: number;
  note?: string | null;
}

// ---------------------------------------------------------------------------
// CIRS — Critical Incident Reporting System (ANONYMOUS quality-management).
//
// ANONYMITY IS THE CORE PROPERTY. Unlike a ProtocolRecord, a CIRS report is
// NEVER signed and NEVER attributed to its reporter:
//   - NO authorKeyId, NO Ed25519 signature, NO sealedKey addressed to the author.
//   - The report payload is encrypted client-side under a fresh random DEK; that
//     DEK is sealed to the ORG public box key ONLY, via crypto_box_seal
//     (x25519-sealedbox) — an ANONYMOUS-SENDER primitive. The server stores
//     ciphertext + the single org-sealed DEK and can read neither.
//   - The submit wire DTO carries NO submitter/author field of any kind, and the
//     server stores NO submitter id / session id / IP on the report row.
//
// Only QM/admin can READ a report, by unlocking the ORG secret key (org password)
// exactly like the admin "Auswertung" path, then opening the org-sealed DEK.
//
// RESIDUAL LIMIT (documented honestly to the reporter in the UI): a malicious
// server operator could still correlate the authenticated request / IP / timing
// at submission time. True network-level anonymity is out of scope. To reduce
// timing correlation the server COARSENS the stored timestamp to DATE precision
// (createdAt is a YYYY-MM-DD calendar date, not a wall-clock instant).
// ---------------------------------------------------------------------------

/** QM workflow status of a CIRS report. Only the REVIEWER is identified — never the reporter. */
export type CirsStatus = 'neu' | 'in_bearbeitung' | 'abgeschlossen';

export const CIRS_STATUSES = ['neu', 'in_bearbeitung', 'abgeschlossen'] as const;

/**
 * POST ROUTES.cirs — the ANONYMOUS encrypted submission. Deliberately carries NO
 * author/submitter/signature field: the only key material is `sealedKey`, the
 * crypto_box_seal of the fresh DEK to the ORG box public key (anonymous sender).
 * `ciphertext`+`nonce` are the AEAD payload (JSON of the form) under that DEK.
 */
export interface CirsSubmission {
  alg: AeadAlg;
  nonce: string; // base64
  ciphertext: string; // base64 — AEAD over canonical JSON of the CIRS form
  /** base64 crypto_box_seal(DEK, orgBoxPublicKey). The ONLY recipient. */
  sealedKey: string;
}

/**
 * One CIRS report as QM fetches it to decrypt with the org key. Carries the
 * org-sealed DEK + AEAD payload + workflow status. NO reporter attribution.
 * `createdAt` is a coarse calendar DATE (YYYY-MM-DD) to blunt timing correlation.
 */
export interface CirsReport {
  id: string; // uuid
  createdAt: string; // YYYY-MM-DD (coarsened; date precision only)
  status: CirsStatus;
  alg: AeadAlg;
  nonce: string; // base64
  ciphertext: string; // base64
  /** base64 crypto_box_seal(DEK, orgBoxPublicKey). */
  sealedKey: string;
}

/** GET ROUTES.cirs — all CIRS reports for the caller's org (admin), newest first. */
export interface CirsListResponse {
  reports: CirsReport[];
}

/** PUT ROUTES.cirsStatus — set a report's QM workflow status (admin). */
export interface SetCirsStatusRequest {
  status: CirsStatus;
}
