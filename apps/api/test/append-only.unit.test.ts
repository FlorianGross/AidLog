/**
 * Offline contract test for the append-only enforcement SQL. We assert the
 * migration actually ships both defence layers required by ARCHITECTURE.md §4:
 *   (a) a BEFORE UPDATE OR DELETE trigger on `records` that RAISES EXCEPTION, and
 *   (b) a least-privilege role granted only INSERT/SELECT on `records`.
 *
 * The live behaviour (UPDATE/DELETE rejected at runtime) is verified by the
 * DB-backed integration test when TEST_DATABASE_URL is set.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, '..', 'src', 'db', 'migrations', '0001_init.sql'), 'utf8');

describe('append-only migration SQL', () => {
  it('defines a BEFORE UPDATE OR DELETE trigger on records', () => {
    expect(sql).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE\s+ON\s+records/i);
  });

  it('the trigger function raises an exception', () => {
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
    expect(sql).toMatch(/append-only/i);
  });

  it('grants the app role only SELECT/INSERT on records (no UPDATE/DELETE)', () => {
    const grantLine = sql.split('\n').find((l) => /GRANT.*ON\s+records\s+TO\s+aidlog_app/i.test(l));
    expect(grantLine, 'expected a GRANT ... ON records TO aidlog_app line').toBeTruthy();
    expect(grantLine!).toMatch(/SELECT/i);
    expect(grantLine!).toMatch(/INSERT/i);
    expect(grantLine!).not.toMatch(/UPDATE/i);
    expect(grantLine!).not.toMatch(/DELETE/i);
  });

  it('keeps DELETE on sealed_keys for shift-close soft revocation', () => {
    const grantLine = sql
      .split('\n')
      .find((l) => /GRANT.*ON\s+sealed_keys\s+TO\s+aidlog_app/i.test(l));
    expect(grantLine, 'expected a GRANT ... ON sealed_keys TO aidlog_app line').toBeTruthy();
    expect(grantLine!).toMatch(/DELETE/i);
  });
});
