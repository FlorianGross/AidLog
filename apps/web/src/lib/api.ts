/**
 * api.ts — typed fetch client for the Aidlog blind sync server.
 *
 * Uses `ROUTES` + DTOs from `@aidlog/contracts`. Auth is proof-of-possession of
 * the Ed25519 signing key (ARCHITECTURE §7): GET a challenge, SIGN it with the
 * in-memory secret key via crypto-core, POST the signature, receive a
 * short-lived session token.
 *
 * Token storage: in-memory primarily; sessionStorage at most (cleared on tab
 * close). NEVER localStorage, and never any secret key / password / DEK.
 */
import { crypto } from '@aidlog/crypto-core';
import type { IdentityKeyPair } from '@aidlog/crypto-core';
import {
  ROUTES,
  type AnchorListResponse,
  type ApiError,
  type AppendRecordRequest,
  type AppendRecordResponse,
  type AuditListResponse,
  type CreateAnchorResponse,
  type AuthChallenge,
  type AuthSession,
  type AuthVerifyRequest,
  type BlobUploadTicket,
  type CirsListResponse,
  type CirsSubmission,
  type SetCirsStatusRequest,
  type CloseShiftRequest,
  type ConsumptionListResponse,
  type ConsumptionEntry,
  type CosignatureRequest,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type DeletionLogResponse,
  type Invitation,
  type LogConsumptionRequest,
  type MaterialItem,
  type MaterialListResponse,
  type PurgeRequest,
  type PurgeResponse,
  type RetentionPolicy,
  type SetRetentionRequest,
  type OrgKeyset,
  type OrgPublicInfo,
  type OwnAccountResponse,
  type ProtocolRecord,
  type PublicIdentity,
  type PushVapidKeyResponse,
  type Qualification,
  type RegisterPushRequest,
  type RecoveryConfig,
  type RedeemInvitationRequest,
  type RedeemInvitationResponse,
  type RegisterHelperRequest,
  type RegisterOrgRequest,
  type RosterListResponse,
  type RosterUpsertRequest,
  type UpsertMaterialItemRequest,
  type SetQualificationRequest,
  type SetRecoveryConfigRequest,
  type SyncResponse,
  type UpdateOrgKeysetRequest,
  type UpdateUserRequest,
  type UserListResponse,
  type WrappedSecretKey,
} from '@aidlog/contracts';

const TOKEN_KEY = 'aidlog.session-token';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public body: ApiError | string,
  ) {
    super(typeof body === 'string' ? body : body.error);
    this.name = 'ApiClientError';
  }
}

export class ApiClient {
  private token: string | null = null;

  constructor(private baseUrl = '') {
    // Rehydrate a non-secret session token from sessionStorage (tab-scoped).
    if (typeof sessionStorage !== 'undefined') {
      this.token = sessionStorage.getItem(TOKEN_KEY);
    }
  }

  setToken(token: string | null): void {
    this.token = token;
    if (typeof sessionStorage !== 'undefined') {
      if (token)
        sessionStorage.setItem(TOKEN_KEY, token); // privacy-lint-allow: opaque short-lived session token (no secret-key/DEK/password content; ARCHITECTURE.md §7), tab-scoped sessionStorage not localStorage
      else sessionStorage.removeItem(TOKEN_KEY);
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (this.token) headers.set('authorization', `Bearer ${this.token}`);

    const res = await fetch(this.baseUrl + path, { ...init, headers });
    const text = await res.text();
    const body = text ? JSON.parse(text) : undefined;
    if (!res.ok) {
      throw new ApiClientError(res.status, (body as ApiError) ?? res.statusText);
    }
    return body as T;
  }

  // --- health -------------------------------------------------------------
  health(): Promise<{ ok: boolean }> {
    return this.request(ROUTES.health, { method: 'GET' });
  }

  // --- registration -------------------------------------------------------
  registerOrg(req: RegisterOrgRequest): Promise<{ orgId: string }> {
    return this.request(ROUTES.registerOrg, { method: 'POST', body: JSON.stringify(req) });
  }
  registerHelper(req: RegisterHelperRequest): Promise<{ helperId: string }> {
    return this.request(ROUTES.registerHelper, { method: 'POST', body: JSON.stringify(req) });
  }

  // --- auth (challenge/response) -----------------------------------------
  /**
   * Full proof-of-possession handshake: fetch a challenge, sign it with the
   * unlocked identity's Ed25519 secret key, verify, and store the token.
   * The password/secret key never leaves the device — only a signature does.
   */
  async authenticate(identity: IdentityKeyPair): Promise<AuthSession> {
    await crypto.ready();
    const pub: PublicIdentity = crypto.toPublicIdentity(identity);

    const challenge = await this.request<AuthChallenge>(ROUTES.authChallenge, {
      method: 'POST',
      body: JSON.stringify({ keyId: pub.keyId }),
    });

    const sig = crypto.sign(crypto.fromBase64(challenge.challenge), identity.sign.secretKey);
    const verifyReq: AuthVerifyRequest = {
      keyId: pub.keyId,
      challenge: challenge.challenge,
      signature: crypto.toBase64(sig),
    };
    const session = await this.request<AuthSession>(ROUTES.authVerify, {
      method: 'POST',
      body: JSON.stringify(verifyReq),
    });
    this.setToken(session.token);
    return session;
  }

  // --- records & sync -----------------------------------------------------
  appendRecord(record: ProtocolRecord): Promise<AppendRecordResponse> {
    const req: AppendRecordRequest = { record };
    return this.request(ROUTES.records, { method: 'POST', body: JSON.stringify(req) });
  }

  sync(cursor?: string): Promise<SyncResponse> {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return this.request(ROUTES.sync + qs, { method: 'GET' });
  }

  /**
   * ORG-WIDE analytics read (admin/lead only): every record in the org, each
   * carrying ONLY its org-type sealedKey. The org-sealed DEK is opaque without
   * the org secret, so this stays zero-knowledge: the caller decrypts locally
   * after unlocking the org key. The server rejects this for helpers (403).
   * Paginates exactly like {@link sync}; pass the previous `cursor` to continue.
   */
  syncOrg(cursor?: string, limit?: number): Promise<SyncResponse> {
    const params = new URLSearchParams({ scope: 'org' });
    if (cursor) params.set('cursor', cursor);
    if (limit) params.set('limit', String(limit));
    return this.request(`${ROUTES.sync}?${params.toString()}`, { method: 'GET' });
  }

  // --- blobs --------------------------------------------------------------
  blobTicket(blobId: string, size: number): Promise<BlobUploadTicket> {
    return this.request(ROUTES.blobTicket, {
      method: 'POST',
      body: JSON.stringify({ blobId, size }),
    });
  }

  /** Upload an already-encrypted blob body to the pre-authorised storage URL. */
  async uploadBlob(ticket: BlobUploadTicket, ciphertext: Uint8Array): Promise<void> {
    const res = await fetch(ticket.uploadUrl, {
      method: ticket.method,
      headers: ticket.headers,
      // Copy into a fresh ArrayBuffer so the body is a clean BlobPart.
      body: ciphertext.slice(),
    });
    if (!res.ok) throw new ApiClientError(res.status, `blob upload failed: ${res.statusText}`);
  }

  // --- shift close (soft revocation) -------------------------------------
  closeShift(req: CloseShiftRequest): Promise<{ ok: boolean }> {
    return this.request(ROUTES.closeShift, { method: 'POST', body: JSON.stringify(req) });
  }

  // --- org public info ----------------------------------------------------
  /**
   * GET the organisation's PUBLIC identity (public keys only). Cached client-
   * side so the documentation editor can seal per-record DEKs to the org.
   */
  orgInfo(): Promise<OrgPublicInfo> {
    return this.request(ROUTES.orgInfo, { method: 'GET' });
  }

  // --- own account (any auth user) ----------------------------------------
  /**
   * GET the caller's OWN account incl. its qualification, so a helper can gate
   * documentation sections client-side without the admin-only user list.
   */
  getOwnAccount(): Promise<OwnAccountResponse> {
    return this.request(ROUTES.account, { method: 'GET' });
  }

  // --- user management (admin; lead may read) -----------------------------
  listUsers(): Promise<UserListResponse> {
    return this.request(ROUTES.users, { method: 'GET' });
  }

  /** PATCH /api/users/:id — change a user's role and/or active status. */
  updateUser(req: UpdateUserRequest): Promise<{ ok: boolean }> {
    return this.request(`${ROUTES.users}/${encodeURIComponent(req.helperId)}`, {
      method: 'PATCH',
      body: JSON.stringify(req),
    });
  }

  /**
   * PATCH /api/users/:keyId/qualification — admin sets (or clears, with null) a
   * user's Sanitätsdienst qualification. Operational metadata only.
   */
  setUserQualification(keyId: string, qualification: Qualification | null): Promise<unknown> {
    const body: SetQualificationRequest = { qualification };
    return this.request(ROUTES.userQualification.replace(':keyId', encodeURIComponent(keyId)), {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  // --- Anwesenheit/Dienst roster (per deployment) -------------------------
  /** GET the roster for a deployment (any auth user in the org). */
  getRoster(deploymentId: string): Promise<RosterListResponse> {
    return this.request(ROUTES.deploymentRoster.replace(':id', encodeURIComponent(deploymentId)), {
      method: 'GET',
    });
  }

  /**
   * Upsert a roster entry: self check-in/out (omit helperKeyId), or admin/lead
   * managing another helper. `action: 'in' | 'out'` stamps the time server-side.
   */
  upsertRoster(deploymentId: string, req: RosterUpsertRequest): Promise<unknown> {
    return this.request(ROUTES.deploymentRoster.replace(':id', encodeURIComponent(deploymentId)), {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  // --- invitations (admin creates; admin/lead list) -----------------------
  createInvitation(req: CreateInvitationRequest): Promise<CreateInvitationResponse> {
    return this.request(ROUTES.invitations, { method: 'POST', body: JSON.stringify(req) });
  }

  listInvitations(): Promise<{ invitations: Invitation[] }> {
    return this.request(ROUTES.invitations, { method: 'GET' });
  }

  /**
   * Redeem a single-use invitation code: the redeemer generates an identity and
   * wraps their secret under a chosen password, then POSTs the PUBLIC identity +
   * wrapped secret. The server returns the new account plus the org public info.
   */
  redeemInvitation(req: RedeemInvitationRequest): Promise<RedeemInvitationResponse> {
    return this.request(ROUTES.redeemInvitation, { method: 'POST', body: JSON.stringify(req) });
  }

  // --- co-signature (read-only counts here; submit/create owned elsewhere) -
  /** GET the co-signature requests awaiting MY signature (pending). */
  myCosignRequests(): Promise<CosignatureRequest[]> {
    return this.request(ROUTES.cosignRequests, { method: 'GET' });
  }

  // --- org key recovery (Shamir) & audit (admin) --------------------------
  /**
   * GET the org keyset: PUBLIC identity + the password-wrapped secret (still
   * ciphertext). The wrappedSecret is decryptable only with the ORG password
   * inside crypto-core; the server never sees the secret.
   */
  getOrgKeyset(): Promise<OrgKeyset> {
    return this.request(ROUTES.orgKeyset, { method: 'GET' });
  }

  /**
   * PUT a re-wrapped org secret (e.g. after a Shamir recovery under a NEW org
   * password). The body carries ONLY ciphertext; no secret/share leaves here.
   */
  updateOrgKeyset(body: UpdateOrgKeysetRequest): Promise<{ ok: boolean }> {
    return this.request(ROUTES.orgKeyset, { method: 'PUT', body: JSON.stringify(body) });
  }

  /** GET the recovery METADATA (T/N, trustee labels, orgKeyCheck) — never shares. */
  getRecoveryConfig(): Promise<RecoveryConfig | null> {
    return this.request<RecoveryConfig | null>(ROUTES.orgRecovery, { method: 'GET' }).catch(
      (err: unknown) => {
        // Recovery not yet configured → treat a 404 as "no config".
        if (err instanceof ApiClientError && err.status === 404) return null;
        throw err;
      },
    );
  }

  /** POST recovery METADATA only (T/N, trustee labels, orgKeyCheck) — never shares. */
  setRecoveryConfig(body: SetRecoveryConfigRequest): Promise<RecoveryConfig> {
    return this.request(ROUTES.orgRecovery, { method: 'POST', body: JSON.stringify(body) });
  }

  /** GET the org audit log (admin): non-sensitive administrative events. */
  listAudit(): Promise<AuditListResponse> {
    return this.request(ROUTES.audit, { method: 'GET' });
  }

  // --- archival anchoring (admin/lead) ------------------------------------
  /**
   * Create a new tamper-evident Merkle anchor over the org's record hash-chain.
   * The server builds the root from PUBLIC recordHashes only (no decryption),
   * signs it, and optionally obtains an RFC 3161 timestamp.
   */
  createAnchor(): Promise<CreateAnchorResponse> {
    return this.request(ROUTES.notarize, { method: 'POST' });
  }

  /** List existing anchors for the org (newest first). */
  listAnchors(): Promise<AnchorListResponse> {
    return this.request(ROUTES.notarize, { method: 'GET' });
  }

  // --- GDPR retention / erasure (admin) -----------------------------------
  /**
   * GET the org-wide retention policy (admin). Returns null when no policy has
   * been configured yet, so the UI can show an explicit "not configured" state.
   * Non-secret: a single integer + audit metadata.
   */
  getRetentionPolicy(): Promise<RetentionPolicy | null> {
    return this.request<RetentionPolicy | null>(ROUTES.orgRetention, { method: 'GET' });
  }

  /** PUT (upsert) the org-wide retention period in days (admin). */
  setRetentionPolicy(body: SetRetentionRequest): Promise<RetentionPolicy> {
    return this.request(ROUTES.orgRetention, { method: 'PUT', body: JSON.stringify(body) });
  }

  /**
   * POST a crypto-shredding purge (admin). With `dryRun: true` it only COUNTS
   * the records/keys that WOULD be shredded (nothing changes). Without it, the
   * matching sealed_keys (DEK wrappers) are deleted, permanently making the
   * affected records' ciphertext undecryptable. Returns non-secret counts only.
   */
  purgeRetention(body: PurgeRequest): Promise<PurgeResponse> {
    return this.request(ROUTES.orgRetentionPurge, { method: 'POST', body: JSON.stringify(body) });
  }

  /** GET the tamper-evident erasure audit (admin), newest first. */
  listDeletionLog(): Promise<DeletionLogResponse> {
    return this.request(ROUTES.deletionLog, { method: 'GET' });
  }

  // --- Material-/Verbrauchsmaterial-Verwaltung (inventory) ----------------
  // OPERATIONAL logistics only — NEVER patient/health data. Consumption is a
  // per-deployment AGGREGATE, never linked to a patient/record.

  /** GET the org's material catalog (any auth user in the org). */
  listMaterial(): Promise<MaterialListResponse> {
    return this.request(ROUTES.orgMaterial, { method: 'GET' });
  }

  /** Create a catalog item (admin/lead). */
  createMaterialItem(req: UpsertMaterialItemRequest): Promise<MaterialItem> {
    return this.request(ROUTES.orgMaterial, { method: 'POST', body: JSON.stringify(req) });
  }

  /** Update a catalog item (admin/lead). */
  updateMaterialItem(id: string, req: UpsertMaterialItemRequest): Promise<MaterialItem> {
    return this.request(ROUTES.orgMaterialItem.replace(':id', encodeURIComponent(id)), {
      method: 'PUT',
      body: JSON.stringify(req),
    });
  }

  /** Delete (or soft-delete if referenced) a catalog item (admin/lead). */
  deleteMaterialItem(id: string): Promise<{ ok: boolean; deleted: boolean; item?: MaterialItem }> {
    return this.request(ROUTES.orgMaterialItem.replace(':id', encodeURIComponent(id)), {
      method: 'DELETE',
    });
  }

  /** GET the consumption log for a deployment (any auth user in the org). */
  listConsumption(deploymentId: string): Promise<ConsumptionListResponse> {
    return this.request(
      ROUTES.deploymentConsumption.replace(':id', encodeURIComponent(deploymentId)),
      { method: 'GET' },
    );
  }

  /**
   * Log consumption for a deployment (any auth user). The server decrements the
   * item's stock transactionally (clamped at 0). No patient/record linkage.
   */
  logConsumption(deploymentId: string, req: LogConsumptionRequest): Promise<ConsumptionEntry> {
    return this.request(
      ROUTES.deploymentConsumption.replace(':id', encodeURIComponent(deploymentId)),
      { method: 'POST', body: JSON.stringify(req) },
    );
  }

  /** Delete a consumption entry and restore its stock (admin/lead). */
  deleteConsumption(deploymentId: string, entryId: string): Promise<{ ok: boolean }> {
    const base = ROUTES.deploymentConsumption.replace(':id', encodeURIComponent(deploymentId));
    return this.request(`${base}?entryId=${encodeURIComponent(entryId)}`, { method: 'DELETE' });
  }

  // --- CIRS (anonymous critical-incident reporting) ----------------------
  // ANONYMITY: the submission carries ONLY { alg, nonce, ciphertext, sealedKey }
  // — no author/submitter/signature field. The server stores no submitter id and
  // logs nothing identifying. Only QM/admin can decrypt, with the org key.

  /**
   * Submit an ANONYMOUS CIRS report. Auth proves org membership + rate-limits;
   * the server discards the identity at storage time. Returns only the new id.
   */
  submitCirs(submission: CirsSubmission): Promise<{ id: string }> {
    return this.request(ROUTES.cirs, { method: 'POST', body: JSON.stringify(submission) });
  }

  /** GET all CIRS reports for the org (admin) — ciphertext + org-sealed DEK to decrypt locally. */
  listCirs(): Promise<CirsListResponse> {
    return this.request(ROUTES.cirs, { method: 'GET' });
  }

  /** PUT a report's QM workflow status (admin). The reviewer is recorded server-side. */
  setCirsStatus(id: string, body: SetCirsStatusRequest): Promise<{ ok: boolean; status: string }> {
    return this.request(ROUTES.cirsStatus.replace(':id', encodeURIComponent(id)), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // --- web push (operational notifications only) --------------------------
  /** GET the server's public VAPID key (publicKey is null when push is off). */
  pushVapidKey(): Promise<PushVapidKeyResponse> {
    return this.request(ROUTES.pushVapidKey, { method: 'GET' });
  }

  /** Register this browser's push subscription (operational metadata only). */
  pushSubscribe(req: RegisterPushRequest): Promise<{ ok: boolean }> {
    return this.request(ROUTES.pushSubscribe, { method: 'POST', body: JSON.stringify(req) });
  }

  /** Remove this browser's push subscription by endpoint. */
  pushUnsubscribe(endpoint: string): Promise<{ ok: boolean }> {
    return this.request(ROUTES.pushUnsubscribe, {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    });
  }
}

/** Convenience helper used by registration flows that only need a wrapped key. */
export type { WrappedSecretKey };

/** Default singleton bound to same-origin (the PWA is served by/with the API). */
export const api = new ApiClient(import.meta.env?.VITE_API_BASE_URL ?? '');
