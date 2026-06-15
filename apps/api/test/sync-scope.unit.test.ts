/**
 * Offline unit test for the sync query contract that backs the ORG ANALYTICS
 * read. The live role enforcement (admin/lead may use scope=org, helper gets
 * 403; org records carry only org-sealed keys) is exercised by the DB-backed
 * integration test when TEST_DATABASE_URL is set — here we pin the request
 * SHAPE the route relies on.
 */
import { describe, it, expect } from 'vitest';
import { syncQuerySchema } from '../src/validation.js';

describe('syncQuerySchema — scope=org analytics read', () => {
  it('defaults scope to undefined (the existing self-scoped behaviour)', () => {
    const parsed = syncQuerySchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.scope).toBeUndefined();
  });

  it("accepts scope 'self' and 'org'", () => {
    expect(syncQuerySchema.safeParse({ scope: 'self' }).success).toBe(true);
    expect(syncQuerySchema.safeParse({ scope: 'org' }).success).toBe(true);
  });

  it('rejects any other scope value', () => {
    expect(syncQuerySchema.safeParse({ scope: 'all' }).success).toBe(false);
    expect(syncQuerySchema.safeParse({ scope: 'helper' }).success).toBe(false);
  });

  it('still honours cursor/limit/deploymentId alongside scope', () => {
    const parsed = syncQuerySchema.safeParse({
      scope: 'org',
      limit: '250',
      cursor: 'abc',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.scope).toBe('org');
      expect(parsed.data.limit).toBe(250); // coerced to number
    }
  });

  it('rejects unknown query keys (strict) so a client cannot smuggle filters', () => {
    expect(syncQuerySchema.safeParse({ scope: 'org', orgId: 'x' }).success).toBe(false);
  });
});
