/**
 * Typed API errors mapped to the `ApiError` contract DTO. Messages are
 * deliberately generic and NEVER echo request bodies (which carry ciphertext).
 */
import type { FastifyReply } from 'fastify';
import type { ApiError } from '@aidlog/contracts';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new HttpError(400, 'bad_request', msg, details);
export const unauthorized = (msg = 'authentication required') =>
  new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'insufficient permissions') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'not found') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string, details?: unknown) =>
  new HttpError(409, 'conflict', msg, details);

export function toApiError(err: HttpError): ApiError {
  return err.details !== undefined
    ? { error: err.message, code: err.code, details: err.details }
    : { error: err.message, code: err.code };
}

export function sendError(reply: FastifyReply, err: HttpError): FastifyReply {
  return reply.code(err.statusCode).send(toApiError(err));
}
