/**
 * Postgres connection + Drizzle client.
 *
 * The connection string should point at the least-privilege `aidlog_app` role
 * (see migrations/0001_init.sql) so the application physically cannot UPDATE or
 * DELETE rows in `records`.
 */
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close: () => Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  const sql = postgres(databaseUrl, {
    max: 10,
    // Never log query parameters: they can carry ciphertext/identity blobs.
    // (postgres-js does not log values by default; this is belt-and-braces.)
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

export { schema };
