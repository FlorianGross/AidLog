/**
 * CIRS — Critical Incident Reporting System (ANONYMOUS quality management).
 *
 *   POST /api/cirs            submit an ANONYMOUS report   (auth: membership + rate-limit ONLY)
 *   GET  /api/cirs            list reports to decrypt      (admin)
 *   PUT  /api/cirs/:id/status set the QM workflow status   (admin)
 *
 * ANONYMITY IS THE CORE PROPERTY — enforced at EVERY layer:
 *   - CLIENT: the payload is encrypted under a fresh random DEK; the DEK is sealed
 *     to the ORG box public key ONLY (crypto_box_seal — anonymous sender). The
 *     report is NEVER signed and NEVER sealed to the reporter.
 *   - WIRE: CirsSubmission carries NO author/submitter/keyId/signature field; the
 *     zod schema is `.strict()` so none can be smuggled in.
 *   - SERVER (this file): the POST requires auth ONLY to verify org membership and
 *     to rate-limit. We take `org_id` from the session and then DISCARD the
 *     identity: we insert NO submitter / session / IP column (there is none), and
 *     we do NOT log the keyId / session / IP. The stored `created_at` is COARSENED
 *     to date precision by the DB default (migration 0012) to blunt timing
 *     correlation — we never set a finer timestamp.
 *   - DB: `cirs_reports` is append-only (trigger + SELECT/INSERT-only grant) and
 *     has no reporter column. The mutable QM workflow lives in `cirs_status`,
 *     where only the REVIEWER is identified (that is fine; only the REPORTER is
 *     anonymous).
 *
 * RESIDUAL LIMIT (documented honestly to the reporter in the UI): a malicious
 * server operator could still correlate the authenticated request / IP / timing
 * of the live submit. True network-level anonymity is out of scope.
 *
 * Only QM/admin can READ a report: GET returns ciphertext + the org-sealed DEK so
 * the client can decrypt LOCALLY after unlocking the org key (org password),
 * exactly like the admin "Auswertung" path. The server decrypts NOTHING.
 *
 * Everything is scoped to req.session.orgId.
 */
import type { FastifyInstance } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { ROUTES } from '@aidlog/contracts';
import type { CirsListResponse, CirsReport, CirsStatus } from '@aidlog/contracts';
import { cirsSubmissionSchema, setCirsStatusSchema } from '../validation.js';
import { cirsReports, cirsStatus } from '../db/schema.js';
import type { CirsReportRow, CirsStatusRow } from '../db/schema.js';
import { badRequest, notFound, sendError } from '../errors.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function rowToReport(report: CirsReportRow, status: CirsStatusRow | undefined): CirsReport {
  return {
    id: report.id,
    // Already a coarse YYYY-MM-DD string (column type `date`). No time component
    // ever existed, so nothing finer can leak here.
    createdAt: report.createdAt,
    status: (status?.status as CirsStatus) ?? 'neu',
    alg: (report.alg as { aead: string }).aead as CirsReport['alg'],
    nonce: report.nonce,
    ciphertext: report.ciphertext,
    sealedKey: report.sealedKey,
  };
}

export async function cirsRoutes(app: FastifyInstance): Promise<void> {
  const { db, config } = app.ctx;

  // Per-route rate limit (reuses the AUTH limit knobs): deters spam/flooding
  // WITHOUT deanonymizing. We never persist or log the limiter key (IP).
  const cirsRateLimit = {
    config: {
      rateLimit: {
        max: config.AUTH_RATE_LIMIT_MAX,
        timeWindow: config.AUTH_RATE_LIMIT_WINDOW,
      },
    },
  };

  // --- POST submit an ANONYMOUS report (any authenticated org member) -------
  // Auth is used ONLY to (a) confirm the caller belongs to an org (org_id) and
  // (b) apply the rate limit. The reporter's identity is DISCARDED at storage:
  // no submitter column is written, and nothing identifying is logged.
  app.post(ROUTES.cirs, { ...cirsRateLimit, preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = cirsSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendError(reply, badRequest('invalid cirs submission', parsed.error.issues));
    }
    const body = parsed.data;
    // org_id (and ONLY org_id) is taken from the session; the keyId is never used.
    const orgId = req.session!.orgId;

    const id = await db.transaction(async (tx) => {
      // INSERT only the ciphertext + org-sealed DEK. NO submitter/session/IP, and
      // we deliberately do NOT set created_at — the DB default (CURRENT_DATE)
      // supplies a COARSE date so no finer timestamp is ever recorded.
      const inserted = await tx
        .insert(cirsReports)
        .values({
          orgId,
          alg: { aead: body.alg },
          nonce: body.nonce,
          ciphertext: body.ciphertext,
          sealedKey: body.sealedKey,
        })
        .returning({ id: cirsReports.id });
      const reportId = inserted[0]!.id;
      // Seed the mutable workflow row at 'neu' (no reviewer yet).
      await tx.insert(cirsStatus).values({ reportId, orgId, status: 'neu' });
      return reportId;
    });

    // Return only the new id. We intentionally log NOTHING about who submitted.
    return reply.code(201).send({ id });
  });

  // --- GET list reports for the org (admin) --------------------------------
  // Returns ciphertext + the org-sealed DEK + status so QM decrypts LOCALLY with
  // the org key. The server reads no plaintext.
  app.get(ROUTES.cirs, { preHandler: [app.requireAuth, app.requireAdmin] }, async (req, reply) => {
    const orgId = req.session!.orgId;
    const rows = await db
      .select({ report: cirsReports, status: cirsStatus })
      .from(cirsReports)
      .leftJoin(cirsStatus, eq(cirsStatus.reportId, cirsReports.id))
      .where(eq(cirsReports.orgId, orgId))
      .orderBy(desc(cirsReports.createdAt), desc(cirsReports.id));
    const result: CirsListResponse = {
      reports: rows.map((r) => rowToReport(r.report, r.status ?? undefined)),
    };
    return reply.send(result);
  });

  // --- PUT set a report's QM workflow status (admin) -----------------------
  // The REVIEWER is recorded (reviewer_key_id) — non-anonymous by design. Scoped
  // to the caller's org so one org can never touch another's report.
  app.put(
    ROUTES.cirsStatus,
    { preHandler: [app.requireAuth, app.requireAdmin] },
    async (req, reply) => {
      const id = (req.params as { id: string }).id;
      if (!UUID_RE.test(id)) return sendError(reply, badRequest('invalid report id'));

      const parsed = setCirsStatusSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(reply, badRequest('invalid status', parsed.error.issues));
      }
      const session = req.session!;

      // Confirm the report belongs to the caller's org before mutating status.
      const existing = await db
        .select({ id: cirsReports.id })
        .from(cirsReports)
        .where(and(eq(cirsReports.id, id), eq(cirsReports.orgId, session.orgId)))
        .limit(1);
      if (!existing[0]) return sendError(reply, notFound('cirs report not found'));

      const updated = await db
        .update(cirsStatus)
        .set({
          status: parsed.data.status,
          reviewerKeyId: session.keyId,
          updatedAt: new Date(),
        })
        .where(and(eq(cirsStatus.reportId, id), eq(cirsStatus.orgId, session.orgId)))
        .returning({ status: cirsStatus.status });
      if (!updated[0]) return sendError(reply, notFound('cirs report not found'));

      return reply.send({ ok: true, status: updated[0].status });
    },
  );
}
