/**
 * Test helpers. Integration tests run against a real Postgres ONLY when
 * TEST_DATABASE_URL is set (e.g. a testcontainer or local docker). Otherwise the
 * suites that need a DB are skipped with a clear message, so the offline build
 * still passes while the logic remains exercised wherever a DB is available.
 *
 * MIGRATION note: TEST_DATABASE_URL should point at a privileged role so the
 * migration can create the `aidlog_app` role + grants.
 */
import { it } from 'vitest';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

/** `itDb` runs only when a test database is configured; otherwise skips loudly. */
export const itDb = hasDb ? it : it.skip;

export const SKIP_REASON =
  'set TEST_DATABASE_URL (privileged Postgres) to run DB integration tests';
