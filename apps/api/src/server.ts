/**
 * Server entrypoint: load config, open the DB + blob store, build the Fastify
 * app, listen, and shut down gracefully on SIGINT/SIGTERM.
 */
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { createBlobStore } from './blobs.js';
import { buildApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const dbHandle = createDb(config.DATABASE_URL);
  const blobs = createBlobStore(config);

  const app = await buildApp({ ctx: { config, db: dbHandle.db, blobs } });

  // Best-effort: ensure the bucket exists (no-op if MinIO already provisioned).
  try {
    await blobs.ensureBucket();
  } catch (err) {
    app.log.warn(
      { err: { message: (err as Error).message } },
      'could not ensure blob bucket on startup',
    );
  }

  // Periodic cleanup of expired sessions/challenges.
  const cleanup = setInterval(
    () => {
      purgeExpiredSessions(dbHandle.db).catch((err) =>
        app.log.warn({ err: { message: (err as Error).message } }, 'session purge failed'),
      );
    },
    10 * 60 * 1000,
  );
  cleanup.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    clearInterval(cleanup);
    try {
      await app.close();
      await dbHandle.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err: { message: (err as Error).message } }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.PORT, host: config.HOST });
  app.log.info({ port: config.PORT }, 'aidlog api listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal: failed to start server:', err instanceof Error ? err.message : err);
  process.exit(1);
});
