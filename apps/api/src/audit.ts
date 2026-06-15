/**
 * Administrative audit log helper.
 *
 * Writes a single non-sensitive administrative event (WHO/WHAT/WHEN) to
 * `audit_log`. Used by the offboarding / user-management / recovery / shift
 * paths. NEVER records patient data, ciphertext, DEKs, secret keys, passwords,
 * or invitation codes — `detail` is intended for short, safe annotations like
 * "helper -> lead".
 *
 * Audit writes are best-effort and MUST NOT break the action they describe:
 * `writeAudit` swallows (logs) insert failures so e.g. disabling a user still
 * succeeds even if the audit insert hiccups. The audit row is operational
 * evidence, not part of the action's correctness contract.
 */
import type { AuditAction } from '@aidlog/contracts';
import type { Db } from './db/client.js';
import { auditLog } from './db/schema.js';

export interface AuditWrite {
  orgId: string;
  actorKeyId: string;
  action: AuditAction;
  targetKeyId?: string;
  detail?: string;
}

/** Insert one audit entry. Best-effort: never throws on DB failure. */
export async function writeAudit(
  db: Db,
  entry: AuditWrite,
  log?: { error: (obj: unknown, msg?: string) => void },
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      orgId: entry.orgId,
      actorKeyId: entry.actorKeyId,
      action: entry.action,
      targetKeyId: entry.targetKeyId ?? null,
      detail: entry.detail ?? null,
    });
  } catch (err) {
    // Audit must not mask the underlying operation. Log metadata only.
    log?.error(
      {
        err: { name: (err as Error)?.name, message: (err as Error)?.message },
        action: entry.action,
      },
      'audit write failed',
    );
  }
}
