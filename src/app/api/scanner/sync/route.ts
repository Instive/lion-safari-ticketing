import { z } from "zod";
import { InvalidSyncCursor } from "@/domain/scanner/cursor";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { devices } from "@/db/schema";
import { buildSync } from "@/domain/scanner/sync";
import { authenticateDevice, deviceUnauthorized } from "@/lib/auth/device";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  protocol: z.literal("2"),
  since: z.coerce.number().int().nonnegative().safe().default(0),
  cursor: z.string().max(2048).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  syncedAt: z.iso.datetime().optional(),
});

/** Bounded manifest pages. Old clients must reload, never accept a partial manifest. */
export async function GET(req: Request): Promise<Response> {
  const device = await authenticateDevice(req.headers);
  if (!device || device.type !== "SCANNER") return deviceUnauthorized();

  const url = new URL(req.url);
  if (url.searchParams.get("protocol") !== "2") {
    return Response.json({ error: "Reload the scanner to update its sync protocol." }, { status: 426, headers: { "cache-control": "no-store" } });
  }
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return Response.json({ error: "Invalid sync query" }, { status: 400 });

  try {
    const payload = await buildSync(query.data.since, env.SYNC_STALE_THRESHOLD_SECONDS, {
      cursor: query.data.cursor, visitDate: query.data.date, syncedAt: query.data.syncedAt,
    });
    // A partial manifest is not a successful device sync.
    if (!payload.nextCursor) {
      await db.update(devices)
        .set({ lastSyncAt: new Date(payload.serverTime), lastSyncVersion: payload.version })
        .where(eq(devices.id, device.id));
    }
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof InvalidSyncCursor) {
      return Response.json({ error: err.message }, { status: 409, headers: { "cache-control": "no-store" } });
    }
    throw err;
  }
}
