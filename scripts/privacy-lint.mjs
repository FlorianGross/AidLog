#!/usr/bin/env node
/**
 * privacy-lint.mjs — Aidlog PII / secret-leakage & data-protection gate.
 *
 * Aidlog handles GDPR Art. 9 special-category health data with a zero-knowledge
 * server. This linter fails the build on the most common ways that guarantee
 * gets quietly broken:
 *
 *   1. LEAKY LOGGING (apps/api): console/logger calls that appear to log request
 *      bodies or sensitive identifiers (password, secretKey, dek, payload,
 *      plaintext, token, req.body, wrappedSecret).
 *   2. THIRD-PARTY TRACKERS (apps/web): analytics / tracking SDKs in deps or code
 *      (google-analytics, gtag, segment, sentry-without-scrubbing, fbq/pixel,
 *      hotjar, mixpanel, posthog, amplitude).
 *   3. MISSING PINO REDACTION (apps/api): the server must configure a redact list.
 *   4. SENSITIVE localStorage WRITES (apps/web): plaintext key/password/dek/token
 *      written to localStorage (must stay in memory / IndexedDB-ciphertext only).
 *
 * Pure Node, zero deps, cross-platform. Heuristics favour precision and each
 * finding is explained so a false positive is easy to allowlist with a pragma:
 *
 *   doSomething(token); // privacy-lint-allow: <reason>   (reviewer sign-off required)
 *
 * USAGE:
 *   node scripts/privacy-lint.mjs            # human report, exit 1 on findings
 *   node scripts/privacy-lint.mjs --json     # machine output for CI annotations
 *   node scripts/privacy-lint.mjs --help
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// CONFIG — tunable. All heuristics documented inline.
// ---------------------------------------------------------------------------
const CONFIG = {
  root: fileURLToPath(new URL('..', import.meta.url)),

  apiDir: posix.join('apps', 'api'),
  webDir: posix.join('apps', 'web'),

  extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.svelte'],

  ignoreDirs: new Set([
    'node_modules',
    'dist',
    'build',
    '.svelte-kit',
    '.git',
    'coverage',
    '.pnpm-store',
    '.turbo',
    // Generated Capacitor native projects: they bundle a COPY of the built web
    // assets (minified Svelte runtime etc.), so scanning them only yields
    // false positives on third-party minified code. Regenerated via `cap add` /
    // `cap sync`; gitignored. The real source is linted in apps/web/src.
    'android',
    'ios',
  ]),

  /** Inline allowlist pragma; reason after the colon is required. */
  allowPragma: /\/\/\s*privacy-lint-allow:\s*(.+)\s*$/,

  /** Sensitive identifier names that must never be logged / persisted plaintext. */
  sensitiveIdents: [
    'password',
    'passphrase',
    'secretkey',
    'secret',
    'dek',
    'payload',
    'plaintext',
    'token',
    'wrappedsecret',
    'privatekey',
    'mnemonic',
    'seed',
  ],

  /** Logger call sinks we inspect for sensitive arguments. */
  logSinks:
    /\b(?:console\.(?:log|info|warn|error|debug)|(?:req\.|request\.|app\.|fastify\.|this\.)?log\.(?:info|warn|error|debug|trace|fatal)|logger\.(?:info|warn|error|debug|trace|fatal))\s*\(/,

  /** Request-body access patterns that should never reach a log sink. */
  reqBodyRe: /\b(?:req|request)\.body\b/,

  /** Tracker / analytics SDK package names (deps) — forbidden in web. */
  trackerPackages: [
    /google-analytics/i,
    /\bgtag\b/i,
    /react-ga\b/i,
    /@segment\//i,
    /\bsegment\b/i,
    /@sentry\//i,
    /\bmixpanel\b/i,
    /\bposthog\b/i,
    /\bamplitude\b/i,
    /\bhotjar\b/i,
    /\bheap\b/i,
    /\bfullstory\b/i,
    /facebook-pixel|react-facebook-pixel/i,
  ],

  /** Tracker globals / snippet patterns in code. */
  trackerCodeRe:
    /\b(?:gtag|ga|fbq|_fbq|hj|mixpanel|posthog|amplitude|analytics\.(?:track|page|identify)|dataLayer\.push)\s*\(/,

  /** Google Analytics / GTM script URLs embedded in markup. */
  trackerUrlRe:
    /(?:google-analytics\.com|googletagmanager\.com|connect\.facebook\.net|static\.hotjar\.com|cdn\.segment\.com|js\.sentry-cdn\.com)/i,

  /** localStorage/sessionStorage write APIs. */
  storageWriteRe: /\b(?:local|session)Storage(?:\.setItem\s*\(|\[)/,
};

function toPosix(p) {
  return p.split(sep).join(posix.sep);
}

const SELF = posix.normalize(toPosix(relative(CONFIG.root, fileURLToPath(import.meta.url))));

const RULES = {
  LOG_SENSITIVE: 'log-sensitive-identifier',
  LOG_REQ_BODY: 'log-request-body',
  TRACKER_DEP: 'third-party-tracker-dependency',
  TRACKER_CODE: 'third-party-tracker-in-code',
  MISSING_REDACT: 'missing-pino-redaction',
  STORAGE_SENSITIVE: 'sensitive-localstorage-write',
};

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

function lineAllow(line) {
  const m = line.match(CONFIG.allowPragma);
  return m ? m[1].trim() : null;
}

/** Does the log-call argument region reference a sensitive identifier as a value? */
function mentionsSensitive(line) {
  const lower = line.toLowerCase();
  for (const id of CONFIG.sensitiveIdents) {
    // Match the identifier as a whole word used like a variable/property:
    //   log.info({ token })           -> property shorthand
    //   log.info({ x: password })     -> value
    //   console.log(payload)          -> bare arg
    //   log.info(`...${dek}...`)      -> template interpolation
    const re = new RegExp(
      `[\\{\\(,]\\s*${id}\\b|:\\s*[a-z0-9_.]*\\b${id}\\b|\\$\\{[^}]*\\b${id}\\b|\\(\\s*${id}\\b|\\b${id}\\s*\\)`,
      'i',
    );
    if (re.test(lower)) return id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-file scans
// ---------------------------------------------------------------------------
function scanCodeFile(absPath, findings) {
  const relPath = toPosix(relative(CONFIG.root, absPath));
  if (relPath === SELF) return;
  let text;
  try {
    text = readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  const inApi = relPath.startsWith(CONFIG.apiDir + posix.sep);
  const inWeb = relPath.startsWith(CONFIG.webDir + posix.sep);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    if (lineAllow(line)) continue;

    // --- 1+2. leaky logging (api only) ---
    if (inApi && CONFIG.logSinks.test(line)) {
      // Strip the leading sink so an identifier in the call name isn't matched.
      const argRegion = line.replace(CONFIG.logSinks, '(');
      if (CONFIG.reqBodyRe.test(argRegion)) {
        push(
          findings,
          mk(
            relPath,
            lineNo,
            line,
            RULES.LOG_REQ_BODY,
            'error',
            'Request body passed to a log sink — may contain plaintext / wrapped secrets.',
            'Never log req.body. Log only method+url and error metadata. The server must stay blind to content.',
          ),
        );
      }
      const hit = mentionsSensitive(argRegion);
      if (hit) {
        push(
          findings,
          mk(
            relPath,
            lineNo,
            line,
            RULES.LOG_SENSITIVE,
            'error',
            `Sensitive identifier "${hit}" appears in a log call.`,
            `Do not log ${hit}. If this is a false positive (e.g. logging a boolean "hasToken" flag) add "// privacy-lint-allow: <reason>".`,
          ),
        );
      }
    }

    // --- 3. trackers in web code ---
    if (inWeb) {
      if (CONFIG.trackerCodeRe.test(line)) {
        push(
          findings,
          mk(
            relPath,
            lineNo,
            line,
            RULES.TRACKER_CODE,
            'error',
            'Analytics/tracker call detected in client code.',
            'Aidlog ships no third-party telemetry. Remove the tracker. Self-hosted, vendor-neutral, no PII exfiltration.',
          ),
        );
      }
      if (CONFIG.trackerUrlRe.test(line)) {
        push(
          findings,
          mk(
            relPath,
            lineNo,
            line,
            RULES.TRACKER_CODE,
            'error',
            'Tracker script URL embedded in client markup.',
            'Remove the third-party analytics/tracking script. No external beacons are permitted.',
          ),
        );
      }
      // --- 4. sensitive localStorage writes ---
      if (CONFIG.storageWriteRe.test(line)) {
        const hit = mentionsSensitive(line) || sensitiveStringKey(line);
        if (hit) {
          push(
            findings,
            mk(
              relPath,
              lineNo,
              line,
              RULES.STORAGE_SENSITIVE,
              'error',
              `Possible plaintext write of "${hit}" to web storage.`,
              'Secret keys / passwords / DEKs / tokens must never touch localStorage. Keep them in memory (crypto session); persist only ciphertext in IndexedDB.',
            ),
          );
        }
      }
    }
  }
}

/** Catch localStorage.setItem('authToken', ...) where the KEY string is sensitive. */
function sensitiveStringKey(line) {
  const m = line.match(/setItem\s*\(\s*['"`]([^'"`]+)['"`]/);
  if (!m) return null;
  const key = m[1].toLowerCase();
  for (const id of CONFIG.sensitiveIdents) {
    if (key.includes(id)) return id;
  }
  return null;
}

function mk(file, line, raw, rule, severity, message, fix) {
  return { file, line, col: 1, rule, severity, message, fix, snippet: raw.trim() };
}

function push(findings, f) {
  findings.push(f);
}

// ---------------------------------------------------------------------------
// Whole-project checks (deps, redaction config)
// ---------------------------------------------------------------------------
function checkTrackerDeps(findings) {
  for (const pkgRel of ['apps/web/package.json', 'package.json']) {
    const abs = join(CONFIG.root, pkgRel);
    let json;
    try {
      json = JSON.parse(readFileSync(abs, 'utf8'));
    } catch {
      continue;
    }
    const deps = {
      ...(json.dependencies || {}),
      ...(json.devDependencies || {}),
      ...(json.optionalDependencies || {}),
    };
    for (const name of Object.keys(deps)) {
      if (CONFIG.trackerPackages.some((re) => re.test(name))) {
        push(findings, {
          file: pkgRel,
          line: 1,
          col: 1,
          rule: RULES.TRACKER_DEP,
          severity: 'error',
          message: `Third-party tracker/analytics package "${name}" present in dependencies.`,
          fix: 'Remove the analytics SDK. Aidlog is telemetry-free. If an error-reporter is truly needed it MUST scrub PII before send and be reviewed.',
          snippet: `"${name}": "${deps[name]}"`,
        });
      }
    }
  }
}

/**
 * Require a pino redaction config in the api server. We look for a `redact`
 * option in app wiring AND a non-empty REDACT_PATHS list. Missing => fail.
 */
function checkPinoRedaction(findings) {
  const appAbs = join(CONFIG.root, 'apps/api/src/app.ts');
  const redactAbs = join(CONFIG.root, 'apps/api/src/redact.ts');

  let appText = '';
  try {
    appText = readFileSync(appAbs, 'utf8');
  } catch {
    /* fall through to failure below */
  }
  const hasRedactOption = /\bredact\s*:/.test(appText) && /REDACT_PATHS|paths\s*:/.test(appText);

  let redactCount = 0;
  try {
    const redactText = readFileSync(redactAbs, 'utf8');
    const m = redactText.match(/REDACT_PATHS\s*=\s*\[([\s\S]*?)\]/);
    if (m) {
      redactCount = (m[1].match(/['"`][^'"`]+['"`]/g) || []).length;
    }
  } catch {
    /* missing redact module */
  }

  if (!hasRedactOption || redactCount === 0) {
    push(findings, {
      file: 'apps/api/src/app.ts',
      line: 1,
      col: 1,
      rule: RULES.MISSING_REDACT,
      severity: 'error',
      message:
        'pino logger redaction is not configured (no `redact: { paths: [...] }` wired to a non-empty REDACT_PATHS list).',
      fix: 'Configure Fastify/pino with redact.paths covering password, secretKey, dek, payload, token, wrappedSecret, ciphertext, authorization/cookie headers (see apps/api/src/redact.ts).',
      snippet: hasRedactOption ? 'REDACT_PATHS is empty' : 'no redact option found in app.ts',
    });
  }
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
  for (const file of walk(CONFIG.root)) scanCodeFile(file, findings);
  checkTrackerDeps(findings);
  checkPinoRedaction(findings);

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        { tool: 'privacy-lint', ok: findings.length === 0, count: findings.length, findings },
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
  console.log('privacy-lint — PII / secret-leakage & data-protection gate (GDPR Art. 9)\n');
  if (findings.length === 0) {
    console.log('PASS: no PII/secret-leakage or tracker violations found.');
    return;
  }
  for (const f of findings) {
    console.log(`FAIL ${f.file}:${f.line}:${f.col}  [${f.rule}]`);
    console.log(`     ${f.message}`);
    console.log(`     code: ${f.snippet}`);
    console.log(`     fix:  ${f.fix}\n`);
  }
  console.log(`privacy-lint: ${findings.length} violation(s). Build blocked.`);
  console.log(
    'Allowlist a verified false positive with a "// privacy-lint-allow: <reason>" comment (needs reviewer sign-off).',
  );
}

function printHelp() {
  console.log(`privacy-lint.mjs — Aidlog PII / secret-leakage linter

Usage:
  node scripts/privacy-lint.mjs           Human-readable report (exit 1 on findings)
  node scripts/privacy-lint.mjs --json    JSON output for CI annotations
  node scripts/privacy-lint.mjs --help    This help

Checks:
  - apps/api: log calls that include req.body or a sensitive identifier
    (password, secretKey, dek, payload, plaintext, token, wrappedSecret).
  - apps/web: third-party trackers/analytics in deps or code (GA, gtag, segment,
    sentry, fbq/pixel, hotjar, mixpanel, posthog, amplitude).
  - apps/api: pino redaction config must exist and be non-empty.
  - apps/web: plaintext writes of secrets to localStorage/sessionStorage.

Allowlist: add a "// privacy-lint-allow: <reason>" comment on the offending line (reviewer sign-off required).`);
}

main();
