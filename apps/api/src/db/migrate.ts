/**
 * Minimal forward-only SQL migration runner.
 *
 * Applies every `migrations/*.sql` file (sorted by name) that has not yet been
 * recorded in `_aidlog_migrations`. Each file runs inside a single transaction.
 *
 * Run as a PRIVILEGED Postgres role (the database owner) — the migrations
 * create the least-privilege `aidlog_app` role and GRANT it INSERT/SELECT on
 * `records`. The application itself connects as `aidlog_app` (DATABASE_URL) and
 * must NOT be used to run migrations.
 *
 * Usage: `tsx src/db/migrate.ts` with MIGRATION_DATABASE_URL (preferred) or
 * DATABASE_URL set.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, 'migrations');

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const applied: string[] = [];
  try {
    // Serialize concurrent migration runs (e.g. parallel test suites pointed at
    // the same DB) with a session-level advisory lock so two connections don't
    // race the `CREATE TABLE IF NOT EXISTS` DDL below (which Postgres can abort
    // with a duplicate pg_type/pg_class error under concurrency).
    await sql`SELECT pg_advisory_lock(hashtext('aidlog_migrations'))`;
    await sql`
      CREATE TABLE IF NOT EXISTS _aidlog_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    for (const name of files) {
      const done = await sql`SELECT 1 FROM _aidlog_migrations WHERE name = ${name}`;
      if (done.length > 0) continue;

      const text = await readFile(join(migrationsDir, name), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`INSERT INTO _aidlog_migrations (name) VALUES (${name})`;
      });
      applied.push(name);
    }
    return applied;
  } finally {
    // Release the advisory lock (best-effort) before closing the pool.
    try {
      await sql`SELECT pg_advisory_unlock(hashtext('aidlog_migrations'))`;
    } catch {
      // ignore — closing the session releases session-level locks anyway.
    }
    await sql.end({ timeout: 5 });
  }
}

// Execute when run directly.
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('MIGRATION_DATABASE_URL or DATABASE_URL must be set');
    process.exit(1);
  }
  runMigrations(url)
    .then((applied) => {
      if (applied.length === 0) console.log('No pending migrations.');
      else console.log(`Applied migrations:\n${applied.map((m) => `  - ${m}`).join('\n')}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
