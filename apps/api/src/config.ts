/**
 * Centralised, env-driven configuration.
 *
 * Every value the server needs comes from the environment so the same image can
 * be deployed anywhere. Nothing secret-bearing about *content* lives here — the
 * server only holds infrastructure credentials (DB, object storage) and a
 * SESSION_SECRET used to sign opaque-but-tamper-evident session tokens. It never
 * holds org/helper passwords, DEKs, or unwrapped secret keys.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  /** Postgres connection string. The app role must have only INSERT/SELECT on `records`. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /** Comma-separated allowlist, or '*' for any origin (dev only). */
  CORS_ORIGIN: z.string().default('*'),

  /** HMAC key for session tokens. Must be long and random in production. */
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  /** Session lifetime in seconds. */
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 8),
  /** Auth challenge lifetime in seconds. */
  CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(120),

  /** MinIO / S3-compatible object storage for opaque blob ciphertext. */
  S3_ENDPOINT: z.string().min(1, 'S3_ENDPOINT is required'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1, 'S3_ACCESS_KEY is required'),
  S3_SECRET_KEY: z.string().min(1, 'S3_SECRET_KEY is required'),
  S3_BUCKET: z.string().min(1, 'S3_BUCKET is required'),
  /** MinIO needs path-style addressing. */
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** Presigned upload URL lifetime in seconds. */
  BLOB_TICKET_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  /** Max direct-upload body size in bytes (fallback path). */
  BLOB_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),

  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  /**
   * STRICTER per-route limit for brute-forceable endpoints (auth
   * challenge/verify, invitation redeem). Throttles proof-of-possession and
   * invitation-code guessing independently of the permissive global limit.
   */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_WINDOW: z.string().default('1 minute'),

  /**
   * Web push (VAPID). All THREE must be present to enable push. If any is
   * missing, push is DISABLED gracefully — the endpoints return a clear
   * "not configured" and nothing else breaks. The keys are NOT secrets that can
   * decrypt content; they only authenticate the application server to the push
   * service (the private key signs the VAPID JWT). Generate a pair with:
   *   npx web-push generate-vapid-keys
   */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  /** `mailto:` or https contact for the push service (RFC 8292 `sub`). */
  VAPID_SUBJECT: z.string().optional(),

  /**
   * ARCHIVAL ANCHORING (tamper-evident Merkle anchor over the record hash-chain).
   *
   * ANCHOR_SECRET signs the Merkle root (HMAC-SHA256) so an anchor is provably
   * issued by THIS server. It is NOT a content key — it cannot decrypt anything.
   * If omitted, the server derives a dedicated key from SESSION_SECRET via a
   * domain-separated HMAC (see anchor.ts) so anchoring still works out of the box;
   * set a distinct ANCHOR_SECRET to decouple anchor-signing from session tokens.
   */
  ANCHOR_SECRET: z.string().min(16, 'ANCHOR_SECRET must be at least 16 chars').optional(),
  /**
   * OPTIONAL RFC 3161 Time-Stamping Authority URL. When set, a newly created
   * anchor ALSO obtains a trusted timestamp over its Merkle root and stores the
   * token. When unset (the default), anchoring degrades GRACEFULLY to the
   * baseline server-signed anchor. A TSA failure NEVER blocks anchoring.
   */
  TSA_URL: z.string().url().optional(),
  /** RFC 3161 request timeout in ms; the anchor proceeds without a token on timeout. */
  TSA_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = Readonly<z.infer<typeof EnvSchema>> & {
  readonly corsOrigins: string[] | true;
};

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const data = parsed.data;
  const corsOrigins: string[] | true =
    data.CORS_ORIGIN.trim() === '*'
      ? true
      : data.CORS_ORIGIN.split(',')
          .map((s) => s.trim())
          .filter(Boolean);

  cached = Object.freeze({ ...data, corsOrigins });
  return cached;
}

/** Test helper: reset the memoised config. */
export function resetConfigCache(): void {
  cached = null;
}
