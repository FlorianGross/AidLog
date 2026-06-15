/**
 * pino redaction paths. Defence-in-depth: request bodies are NOT logged at all
 * (we never attach `body` to the log context), but if any of these ever appear
 * in a logged object they are replaced with [REDACTED]. Covers every field that
 * could carry plaintext, a DEK, a password, or an (un)wrapped secret key.
 *
 * Kept in its own dependency-free module so security tests can assert it without
 * importing the whole app (and its crypto stack).
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  '*.password',
  '*.passphrase',
  '*.secret',
  '*.secretKey',
  '*.boxSecretKey',
  '*.signSecretKey',
  '*.dek',
  '*.plaintext',
  '*.payload',
  '*.wrappedSecret',
  '*.ciphertext',
  '*.signature',
  '*.token',
  '*.sealedKeys',
  // user-system / invitation / cosign sensitive fields:
  '*.code', // single-use invitation code (returned once, never logged)
  '*.codeHash',
  '*.signatureImage',
  'password',
  'wrappedSecret',
  'ciphertext',
  'token',
  'code',
] as const;
