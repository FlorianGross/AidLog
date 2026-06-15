/**
 * Public surface of the CIRS (anonymous critical-incident reporting) helpers.
 *
 * `submit` builds + POSTs an ANONYMOUS encrypted report (fresh DEK → AEAD →
 * seal-to-org-ONLY → wipe DEK); `decrypt` is the QM-side org-key path that opens
 * the org-sealed DEK and decrypts the content. Neither involves a signature or
 * any reporter attribution.
 */
export { submitCirsReport, type CirsFormPayload } from './submit';
export { decryptCirsReports, type DecryptedCirsReport } from './decrypt';
