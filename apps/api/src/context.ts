/**
 * Shared application context passed to route registrars and the auth
 * pre-handler. Decorated onto the Fastify instance so routes never reach for
 * module-level singletons (keeps tests able to inject fakes).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Role } from '@aidlog/contracts';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import type { BlobStore } from './blobs.js';
import type { SessionContext } from './auth.js';

export interface AppContext {
  config: AppConfig;
  db: Db;
  blobs: BlobStore;
}

// Augment Fastify types with our decorations.
declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext;
    /** preHandler: requires a valid bearer session; sets request.session. */
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler: requires role 'admin'; must run after requireAuth. */
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Build a preHandler that requires the session role to be one of `roles`.
     * Must run after requireAuth. Roles are unordered membership checks (no
     * implicit hierarchy) — pass every role that is allowed.
     */
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    session?: SessionContext;
  }
}

export type { Db, BlobStore, AppConfig, SessionContext };
