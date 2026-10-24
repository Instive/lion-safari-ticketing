import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  since: z.number().int().nonnegative().safe(),
  version: z.number().int().nonnegative().safe(),
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: z.iso.datetime(),
  overlapFrom: z.iso.datetime(),
  after: z.uuid(),
  fullSync: z.boolean(),
});
export type SyncCursor = z.infer<typeof schema>;
export class InvalidSyncCursor extends Error {}

export function encodeSyncCursor(cursor: SyncCursor, secret: string): string {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function decodeSyncCursor(value: string, secret: string, today: string, now: Date): SyncCursor {
  try {
    if (value.length > 2048) throw new Error();
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac("sha256", secret).update(payload).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
    const cursor = schema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    const age = now.getTime() - Date.parse(cursor.startedAt);
    if (cursor.visitDate !== today || age < 0 || age > 15 * 60_000) throw new Error();
    return cursor;
  } catch {
    throw new InvalidSyncCursor("Sync expired or cursor invalid; restart from the last completed sync.");
  }
}
