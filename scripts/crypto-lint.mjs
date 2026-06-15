#!/usr/bin/env node
/**
 * crypto-lint.mjs — Aidlog crypto boundary & weak-primitive gate.
 *
 * Enforces ARCHITECTURE.md §8: "Only `crypto-core` may import a crypto primitive
 * library." Everything that does content encryption must go through
 * `@aidlog/crypto-core`; `api`/`web` must never import libsodium / node:crypto /
 * crypto-js / tweetnacl / bcrypt for content crypto.
 *
 * It ALSO fails on weak/foot-gun primitives anywhere in the tree (md5, sha1,
 * createCipher, AES-ECB, Math.random() used to make keys/tokens/ids, and
 * hardcoded key/IV-looking literals near crypto calls).
 *
 * Pure Node, zero deps, cross-platform (Windows + Linux). Own file walker.
 *
 * USAGE:
 *   node scripts/crypto-lint.mjs            # human report, exit 1 on findings
 *   node scripts/crypto-lint.mjs --json     # machine output for CI annotations
 *   node scripts/crypto-lint.mjs --help
 *
 * ALLOWLISTING (requires reviewer sign-off, see docs/CI_AND_COMPLIANCE.md):
 *   Put an inline pragma on the SAME line as the flagged code:
 *       import { createHmac } from 'node:crypto'; // crypto-lint-allow: session HMAC, not content crypto
 *   The reason after the colon is mandatory and printed in audits.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// CONFIG — tune here. Heuristics favour precision; allowlist with a pragma.
// ---------------------------------------------------------------------------
const CONFIG = {
  /** Repo root = parent of this scripts/ dir. */
  root: fileURLToPath(new URL('..', import.meta.url)),

  /** The ONE package allowed to import crypto-primitive libraries directly. */
  cryptoCoreDir: posix.join('packages', 'crypto-core'),

  /** Extensions we scan. */
  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte'],

  /** Directories never scanned (build output, deps, vcs, generated). */
  ignoreDirs: new Set([
    'node_modules',
    'dist',
    'build',
    '.svelte-kit',
    '.git',
    'coverage',
    '.pnpm-store',
    '.turbo',
  ]),

  /** Pragma that allowlists a single line (reason after the colon is required). */
  allowPragma: /\/\/\s*crypto-lint-allow:\s*(.+)\s*$/,

  /**
   * Crypto-primitive libraries that may ONLY be imported inside crypto-core.
   * `node:crypto`/`crypto` are special-cased (allowed for non-content use via
   * pragma) — see nodeCryptoModules below.
   */
  primitiveModules: [
    /\blibsodium(-wrappers(-sumo)?)?\b/,
    /\btweetnacl\b/,
    /\bcrypto-js\b/,
    /\bbcrypt(js)?\b/,
    /\bnode-forge\b/,
    /\bsjcl\b/,
    /\b@noble\/(ciphers|hashes|curves|secp256k1|ed25519)\b/,
    /\bscryptsy?\b/,
    /\bargon2\b/,
  ],

  /** Node's built-in crypto: allowed in api for HMAC/randomness WITH a pragma. */
  nodeCryptoModules: [/^node:crypto$/, /^crypto$/],
};

const SELF = posix.normalize(toPosix(relative(CONFIG.root, fileURLToPath(import.meta.url))));

// ---------------------------------------------------------------------------
// Rules. Each finding = { file, line, col, rule, message, fix, snippet }.
// ---------------------------------------------------------------------------
const RULES = {
  PRIMITIVE_OUTSIDE_CORE: 'primitive-import-outside-crypto-core',
  NODE_CRYPTO_NO_PRAGMA: 'node-crypto-without-allow-pragma',
  WEAK_HASH: 'weak-hash-primitive',
  LEGACY_CIPHER: 'legacy-keyless-cipher',
  AES_ECB: 'aes-ecb-mode',
  INSECURE_RANDOM: 'math-random-for-secret',
  HARDCODED_KEY: 'hardcoded-key-or-iv',
};

function toPosix(p) {
  return p.split(sep).join(posix.sep);
}

function isCryptoCoreFile(relPath) {
  return relPath.startsWith(CONFIG.cryptoCoreDir + posix.sep);
}

/** Detect an import/require of a module matching any pattern. Returns module string or null. */
const IMPORT_RE =
  /(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*|require\s*\(\s*)['"]([^'"]+)['"]/;

function moduleOf(line) {
  const m = line.match(IMPORT_RE);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------
function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (CONFIG.ignoreDirs.has(ent.name)) continue;
      yield* walk(full);
    } else if (ent.isFile()) {
      const dot = ent.name.lastIndexOf('.');
      const ext = dot >= 0 ? ent.name.slice(dot) : '';
      if (CONFIG.extensions.includes(ext)) yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------
const WEAK_HASH_RE = /\b(?:createHash\s*\(\s*['"](md5|sha1)['"]|['"](md5|sha-?1)['"])/i;
const LEGACY_CIPHER_RE = /\bcreateCipher\s*\(/; // keyless legacy API (not createCipheriv)
const AES_ECB_RE = /aes-\d{3}-ecb/i;
const MATH_RANDOM_RE = /Math\.random\s*\(\s*\)/;
const SECRET_CONTEXT_RE = /\b(key|token|secret|nonce|iv|salt|dek|password|seed|otp|id)\b/i;
// long base64 / hex literal — heuristic for a hardcoded key/IV
const LONG_B64_RE = /['"`][A-Za-z0-9+/]{32,}={0,2}['"`]/;
const LONG_HEX_RE = /['"`](?:0x)?[0-9a-fA-F]{32,}['"`]/;
const CRYPTO_CALL_NEARBY_RE =
  /\b(createCipheriv|createDecipheriv|createSecretKey|importKey|subtle|encrypt|decrypt|seal|deriveKey|IV|iv|nonce|key)\b/;

function lineHasAllowPragma(line) {
  const m = line.match(CONFIG.allowPragma);
  return m ? m[1].trim() : null;
}

function scanFile(absPath, findings) {
  const relPath = toPosix(relative(CONFIG.root, absPath));
  if (relPath === SELF) return; // never lint ourselves (we contain rule strings)
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  const inCore = isCryptoCoreFile(relPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const allow = lineHasAllowPragma(line);

    // --- 1. crypto-primitive imports outside crypto-core ---
    const mod = moduleOf(line);
    if (mod && !inCore) {
      const isPrimitive = CONFIG.primitiveModules.some((re) => re.test(mod));
      const isNodeCrypto = CONFIG.nodeCryptoModules.some((re) => re.test(mod));
      if (isPrimitive) {
        // libsodium/tweetnacl/etc are content-crypto libs: NEVER allowed outside core,
        // even with a pragma. (A pragma can't override the architectural boundary.)
        push(findings, {
          file: relPath,
          line: lineNo,
          col: line.indexOf(mod) + 1,
          rule: RULES.PRIMITIVE_OUTSIDE_CORE,
          severity: 'error',
          message: `Crypto-primitive library "${mod}" imported outside packages/crypto-core.`,
          fix: 'Move this crypto operation into @aidlog/crypto-core and call it from here. Only crypto-core may import primitives (ARCHITECTURE.md §8).',
          snippet: line.trim(),
        });
      } else if (isNodeCrypto) {
        // node:crypto is allowed in non-content roles (HMAC, random ids/challenges)
        // ONLY with an explicit allow pragma stating the reason.
        if (!allow) {
          push(findings, {
            file: relPath,
            line: lineNo,
            col: line.indexOf(mod) + 1,
            rule: RULES.NODE_CRYPTO_NO_PRAGMA,
            severity: 'error',
            message: `"${mod}" imported outside crypto-core without an allow pragma.`,
            fix: 'If this is NON-content crypto (session HMAC, random ids/challenges) add `// crypto-lint-allow: <reason>` on the import line. If it does content encryption, move it into crypto-core.',
            snippet: line.trim(),
          });
        }
      }
    }

    // --- 2. weak / foot-gun primitives (anywhere; skip lines with pragma) ---
    if (allow) continue;

    if (WEAK_HASH_RE.test(line) && !isAlgIdContext(line)) {
      push(
        findings,
        mk(
          relPath,
          lineNo,
          line,
          RULES.WEAK_HASH,
          'error',
          'Use of a weak hash (md5/sha1).',
          'Use BLAKE2b-256 / SHA-256 via @aidlog/crypto-core. md5 and sha1 are broken for security use.',
        ),
      );
    }
    if (LEGACY_CIPHER_RE.test(line)) {
      push(
        findings,
        mk(
          relPath,
          lineNo,
          line,
          RULES.LEGACY_CIPHER,
          'error',
          'Use of the keyless legacy createCipher() API.',
          'Never use createCipher (password-derived, no IV control). Use crypto-core AEAD, or createCipheriv with a random IV if you truly need node crypto.',
        ),
      );
    }
    if (AES_ECB_RE.test(line)) {
      push(
        findings,
        mk(
          relPath,
          lineNo,
          line,
          RULES.AES_ECB,
          'error',
          'AES-ECB mode requested.',
          'ECB leaks plaintext structure. Use an AEAD mode (XChaCha20-Poly1305 via crypto-core).',
        ),
      );
    }
    if (MATH_RANDOM_RE.test(line) && SECRET_CONTEXT_RE.test(line)) {
      push(
        findings,
        mk(
          relPath,
          lineNo,
          line,
          RULES.INSECURE_RANDOM,
          'error',
          'Math.random() used to produce a key/token/id/nonce.',
          'Math.random is NOT cryptographically secure. Use crypto-core randomDek()/randomUUID, or crypto.getRandomValues / node:crypto randomBytes (with an allow pragma).',
        ),
      );
    }
    if ((LONG_B64_RE.test(line) || LONG_HEX_RE.test(line)) && CRYPTO_CALL_NEARBY_RE.test(line)) {
      push(
        findings,
        mk(
          relPath,
          lineNo,
          line,
          RULES.HARDCODED_KEY,
          'error',
          'Possible hardcoded key/IV/nonce literal near a crypto call.',
          'Never hardcode keys/IVs. Generate them at runtime (crypto-core) or load from secret config. If this is test data or a public constant, add `// crypto-lint-allow: <reason>`.',
        ),
      );
    }
  }
}

/** Avoid flagging algorithm-identifier strings like 'blake2b-256' / type unions. */
function isAlgIdContext(line) {
  // sha1/md5 only matched the alg-id branch; ensure it is not part of "sha-256" etc.
  return /sha-?256|sha-?512|sha-?384|blake2/i.test(line) && !/\b(md5|createHash)\b/i.test(line);
}

function mk(file, line, raw, rule, severity, message, fix) {
  return {
    file,
    line,
    col: 1,
    rule,
    severity,
    message,
    fix,
    snippet: raw.trim(),
  };
}

function push(findings, f) {
  findings.push(f);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  const asJson = args.includes('--json');

  const findings = [];
  for (const file of walk(CONFIG.root)) scanFile(file, findings);

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        { tool: 'crypto-lint', ok: findings.length === 0, count: findings.length, findings },
        null,
        2,
      ) + '\n',
    );
  } else {
    report(findings);
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

function report(findings) {
  console.log('crypto-lint — crypto boundary & weak-primitive gate (ARCHITECTURE.md §8)\n');
  if (findings.length === 0) {
    console.log('PASS: no crypto-boundary or weak-primitive violations found.');
    return;
  }
  for (const f of findings) {
    console.log(`FAIL ${f.file}:${f.line}:${f.col}  [${f.rule}]`);
    console.log(`     ${f.message}`);
    console.log(`     code: ${f.snippet}`);
    console.log(`     fix:  ${f.fix}\n`);
  }
  console.log(`crypto-lint: ${findings.length} violation(s). Build blocked.`);
  console.log(
    'Allowlist a legitimate non-content use with `// crypto-lint-allow: <reason>` (needs reviewer sign-off).',
  );
}

function printHelp() {
  console.log(`crypto-lint.mjs — Aidlog crypto boundary linter

Usage:
  node scripts/crypto-lint.mjs           Human-readable report (exit 1 on findings)
  node scripts/crypto-lint.mjs --json    JSON output for CI annotations
  node scripts/crypto-lint.mjs --help    This help

Checks:
  - Crypto-primitive libraries (libsodium, tweetnacl, crypto-js, bcrypt, @noble/*,
    node-forge, sjcl, argon2, scrypt) imported OUTSIDE packages/crypto-core.
  - node:crypto/crypto imported outside crypto-core without a // crypto-lint-allow pragma.
  - Weak hashes (md5, sha1), legacy createCipher(), AES-ECB.
  - Math.random() used to make keys/tokens/ids/nonces.
  - Hardcoded long base64/hex key/IV literals near crypto calls.

Allowlist: add a "// crypto-lint-allow: <reason>" comment on the offending line (reviewer sign-off required).`);
}

main();
