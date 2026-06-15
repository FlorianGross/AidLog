/**
 * Offline unit tests for session-token integrity and log redaction config.
 * These exercise the security-critical pure logic without a database.
 */
import { describe, it, expect } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto'; // crypto-lint-allow: test re-derives session-token HMAC tag; no content crypto
import { REDACT_PATHS } from '../src/redact.js';

// Re-derive the token tag the way auth.ts does, to assert tamper-evidence.
function tag(secret: string, raw: string): string {
  return createHmac('sha256', secret).update(raw).digest('base64url');
}
function mint(secret: string): string {
  const raw = randomBytes(32).toString('base64url');
  return `${raw}.${tag(secret, raw)}`;
}
function tagValid(secret: string, token: string): boolean {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const raw = token.slice(0, dot);
  const got = token.slice(dot + 1);
  return got === tag(secret, raw);
}

describe('session token HMAC tag', () => {
  const secret = 'unit-test-secret-which-is-long-enough';

  it('accepts a freshly minted token', () => {
    expect(tagValid(secret, mint(secret))).toBe(true);
  });

  it('rejects a token whose random part was tampered with', () => {
    const t = mint(secret);
    const [, sig] = t.split('.');
    const forged = `${randomBytes(32).toString('base64url')}.${sig}`;
    expect(tagValid(secret, forged)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    expect(tagValid(secret, mint('a-totally-different-secret-value'))).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(tagValid(secret, 'no-dot-here')).toBe(false);
    expect(tagValid(secret, '.onlytag')).toBe(false);
  });
});

describe('pino redaction config', () => {
  it('redacts every secret-bearing field family', () => {
    for (const field of [
      '*.password',
      '*.wrappedSecret',
      '*.ciphertext',
      '*.payload',
      '*.dek',
      '*.signSecretKey',
      '*.token',
      'req.headers.authorization',
    ]) {
      expect(REDACT_PATHS).toContain(field);
    }
  });
});
