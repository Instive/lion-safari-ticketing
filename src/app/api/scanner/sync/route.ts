import { eq } from "drizzle-orm";

import { db } from "@/db";
import { devices } from "@/db/schema";
import { buildSync } from "@/domain/scanner/sync";
import { authenticateDevice, deviceUnauthorized } from "@/lib/auth/device";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Incremental manifest pull for the gate scanner.
 *
 * `?since=<version>` returns only what changed, so a scan-every-15-seconds loop
 * stays cheap. `since=0` returns today's full manifest — used on first start and
 * after a device reset.
 */
export async function GET(req: Request): Promise<Response> {
  const device = await authenticateDevice(req.headers);
  if (!device || device.type !== "SCANNER") return deviceUnauthorized();

  const url = new URL(req.url);
  const sinceRaw = Number(url.searchParams.get("since") ?? "0");
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0;

  const payload = await buildSync(since, env.SYNC_STALE_THRESHOLD_SECONDS);

  await db
    .update(devices)
    .set({ lastSyncAt: new Date(), lastSyncVersion: payload.version })
    .where(eq(devices.id, device.id));

  return Response.json(payload, {
    headers: { "cache-control": "no-store" },
  });
}
