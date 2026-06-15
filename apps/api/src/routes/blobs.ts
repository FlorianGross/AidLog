/**
 * Blob upload routes:
 *   POST /api/blobs/ticket   blob upload ticket (presigned PUT to MinIO)
 *   PUT  /api/blobs/ticket/:blobId  direct-upload fallback (streams opaque
 *                                   ciphertext through the API to MinIO)
 *
 * The body is OPAQUE ciphertext (client-side streaming AEAD output). The server
 * stores it byte-for-byte and never decrypts or inspects it.
 */
import { randomUUID } from 'node:crypto'; // crypto-lint-allow: random non-secret blob id (routing metadata only, not key material)
import { Buffer } from 'node:buffer';
import type { FastifyInstance } from 'fastify';
import { ROUTES } from '@aidlog/contracts';
import type { BlobUploadTicket } from '@aidlog/contracts';
import { blobTicketSchema } from '../validation.js';
import { badRequest, sendError } from '../errors.js';

const DIRECT_UPLOAD_PATH = `${ROUTES.blobTicket}/:blobId`;

export async function blobRoutes(app: FastifyInstance): Promise<void> {
  const { blobs, config } = app.ctx;

  // --- presigned upload ticket -------------------------------------------
  app.post(ROUTES.blobTicket, { preHandler: app.requireAuth }, async (req, reply) => {
    const parsed = blobTicketSchema.safeParse(req.body ?? {});
    if (!parsed.success)
      return sendError(reply, badRequest('invalid ticket request', parsed.error.issues));
    const { blobId: proposed, size } = parsed.data;
    const blobId = proposed ?? randomUUID();

    try {
      const { uploadUrl, expiresAt } = await blobs.presignUpload(blobId, size);
      const ticket: BlobUploadTicket = {
        blobId,
        uploadUrl,
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        expiresAt: expiresAt.toISOString(),
      };
      return reply.code(201).send(ticket);
    } catch (err) {
      req.log.error({ err: redactErr(err) }, 'failed to presign blob upload');
      // Fall back to advertising the direct-upload endpoint.
      const expiresAt = new Date(Date.now() + config.BLOB_TICKET_TTL_SECONDS * 1000);
      const ticket: BlobUploadTicket = {
        blobId,
        uploadUrl: `${DIRECT_UPLOAD_PATH.replace(':blobId', blobId)}`,
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        expiresAt: expiresAt.toISOString(),
      };
      return reply.code(201).send(ticket);
    }
  });

  // --- direct-upload fallback --------------------------------------------
  // Registered with a raw octet-stream parser so the ciphertext passes through
  // untouched (see server.ts content-type parser).
  app.put<{ Params: { blobId: string } }>(
    DIRECT_UPLOAD_PATH,
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const blobId = req.params.blobId;
      if (!/^[A-Za-z0-9._-]{1,200}$/.test(blobId)) {
        return sendError(reply, badRequest('invalid blobId'));
      }
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return sendError(reply, badRequest('empty or non-binary body'));
      }
      if (body.length > config.BLOB_MAX_BYTES) {
        return sendError(reply, badRequest('blob exceeds maximum size'));
      }
      await blobs.directUpload(blobId, body, 'application/octet-stream');
      return reply.code(201).send({ blobId });
    },
  );

  // --- download (opaque ciphertext) --------------------------------------
  // GET /api/blobs/:blobId — returns the stored ciphertext byte-for-byte.
  // Auth-gated, but the bytes are useless without the per-record DEK, so this
  // does not weaken the zero-knowledge model. Used to render encrypted
  // signature images during record/co-signature review.
  app.get<{ Params: { blobId: string } }>(
    '/api/blobs/:blobId',
    { preHandler: app.requireAuth },
    async (req, reply) => {
      const blobId = req.params.blobId;
      // `ticket` is the upload sub-path, never a real object key.
      if (blobId === 'ticket' || !/^[A-Za-z0-9._-]{1,200}$/.test(blobId)) {
        return sendError(reply, badRequest('invalid blobId'));
      }
      try {
        const data = await blobs.download(blobId);
        reply.header('content-type', 'application/octet-stream');
        reply.header('cache-control', 'private, max-age=31536000, immutable');
        return reply.send(data);
      } catch (err) {
        req.log.error({ err: redactErr(err) }, 'blob download failed');
        return reply.code(404).send({ error: 'blob not found', code: 'not_found' });
      }
    },
  );
}

function redactErr(err: unknown): { name?: string; message?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: 'unknown error' };
}
