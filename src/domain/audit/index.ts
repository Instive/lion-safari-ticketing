import type { DbOrTx } from "@/db";
import { auditLog, changeLog } from "@/db/schema";

export type Actor =
  | { type: "STAFF"; id: string; name?: string }
  | { type: "DEVICE"; id: string; name?: string }
  | { type: "SYSTEM"; id?: string }
  | { type: "WEBHOOK"; id?: string }
  | { type: "CUSTOMER"; id?: string };

/**
 * Append-only audit trail. Every state change that touches money or ticket
 * validity must write one of these, inside the same transaction as the change
 * itself — so an audit entry can never go missing for a change that committed.
 */
export async function writeAudit(
  tx: DbOrTx,
  entry: {
    actor: Actor;
    action: string;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    context?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(auditLog).values({
    actorType: entry.actor.type,
    actorId: entry.actor.id ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    context: entry.context ?? null,
  });
}

/**
 * Publishes a change onto the scanner sync feed. Must be called in the same
 * transaction as the change it describes, otherwise a scanner could sync past a
 * change that has not committed yet.
 */
export async function writeChange(
  tx: DbOrTx,
  entry: {
    entity: "ticket" | "booking";
    entityId: string;
    operation: "INSERT" | "UPDATE" | "DELETE";
    payload?: unknown;
  },
): Promise<void> {
  await tx.insert(changeLog).values({
    entity: entry.entity,
    entityId: entry.entityId,
    operation: entry.operation,
    payload: entry.payload ?? null,
  });
}
