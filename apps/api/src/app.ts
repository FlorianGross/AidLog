/**
 * Fastify application factory.
 *
 * Wires security middleware, REDACTING structured logging, the health route,
 * auth pre-handlers, a raw octet-stream body parser (so opaque blob ciphertext
 * passes through untouched), a contract-shaped error handler, and all routes.
 *
 * Separated from server.ts so tests can build an app with injected db/blobs and
 * without binding a port.
 */
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ROUTES } from '@aidlog/contracts';
import type { AppContext } from './context.js';
import { verifySession, extractBearer } from './auth.js';
import { registerRoutes } from './routes/index.js';
import { HttpError, toApiError, unauthorized, forbidden } from './errors.js';
import { REDACT_PATHS } from './redact.js';

export { REDACT_PATHS };

export interface BuildAppOptions {
  ctx: AppContext;
}

export async function buildApp(opts: BuildAppOptions): Promise<FastifyInstance> {
  const { ctx } = opts;
  const { config } = ctx;

  const app = Fastify({
    // Trust no forwarded headers unless explicitly behind a proxy you control.
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
      // Minimal request serialization: method + url only, never the body.
      serializers: {
        req(req) {
          return { method: req.method, url: req.url };
        },
      },
    },
    bodyLimit: config.BLOB_MAX_BYTES,
    disableRequestLogging: false,
  });

  app.decorate('ctx', ctx);

  // --- security middleware ----
  await app.register(helmet, {
    // API only; no inline scripts served.
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization'],
  });
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW,
  });

  // --- raw octet-stream parser for direct blob upload (opaque ciphertext) ---
  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // --- auth pre-handlers (decorated for routes to opt into) ----
  app.decorate('requireAuth', async (req, reply) => {
    const token = extractBearer(req.headers.authorization);
    const session = await verifySession(ctx.db, config.SESSION_SECRET, token);
    if (!session) {
      reply.code(401).send(toApiError(unauthorized()));
      return;
    }
    req.session = session;
  });
  app.decorate('requireAdmin', async (req, reply) => {
    if (req.session?.role !== 'admin') {
      reply.code(403).send(toApiError(forbidden('admin role required')));
      return;
    }
  });
  app.decorate('requireRole', (...roles) => async (req, reply) => {
    const role = req.session?.role;
    if (!role || !roles.includes(role)) {
      reply.code(403).send(toApiError(forbidden(`requires role: ${roles.join(' or ')}`)));
      return;
    }
  });

  // --- health ----
  app.get(ROUTES.health, async () => ({ status: 'ok', time: new Date().toISOString() }));

  // --- contract-shaped error handler (never leaks request bodies) ----
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send(toApiError(err));
      return;
    }
    // Fastify validation / rate-limit / parser errors carry a statusCode.
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status >= 500) {
      // Log only the error metadata, never the request body.
      req.log.error(
        { err: { name: err.name, message: err.message }, statusCode: status },
        'request failed',
      );
    }
    reply.code(status).send({
      error: status >= 500 ? 'internal server error' : err.message,
      code: status >= 500 ? 'internal_error' : (err.code ?? 'error'),
    });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'not found', code: 'not_found' });
  });

  await registerRoutes(app);
  await app.ready();
  return app;
}
