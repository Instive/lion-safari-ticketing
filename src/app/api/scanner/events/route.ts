import { z } from "zod";

import { confirmBoarding } from "@/domain/boarding/confirm";
import { authenticateDevice, deviceUnauthorized } from "@/lib/auth/device";
import { serverNow } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const eventSchema = z.object({
  /** Generated on the device before queueing — the idempotency key for boarding. */
  clientEventId: z.uuid(),
  ticketId: z.uuid(),
  boardedCount: z.number().int().min(1).max(100),
  createdOffline: z.boolean().default(false),
  /** Device clock. Recorded for audit; never used to decide validity. */
  deviceReportedAt: z.iso.datetime().optional(),
});

const bodySchema = z.object({ events: z.array(eventSchema).min(1).max(100) });

export type ScannerEventResult = {
  clientEventId: string;
  accepted: boolean;
  duplicate: boolean;
  reason?: string;
  message?: string;
};

/**
 * Receives boarding events from the gate scanner, including ones queued while
 * it was offline.
 *
 * Every event is re-validated server-side and applied idempotently by
 * `clientEventId`, so the scanner can safely resend its whole queue after a
 * reconnect, a crash or a battery swap without double-boarding anyone.
 */
export async function POST(req: Request): Promise<Response> {
  const device = await authenticateDevice(req.headers);
  if (!device || device.type !== "SCANNER") return deviceUnauthorized();

  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const results: ScannerEventResult[] = [];

  for (const event of parsed.data.events) {
    try {
      const outcome = await confirmBoarding({
        ticketId: event.ticketId,
        boardedCount: event.boardedCount,
        clientEventId: event.clientEventId,
        deviceId: device.id,
        createdOffline: event.createdOffline,
        deviceReportedAt: event.deviceReportedAt ? new Date(event.deviceReportedAt) : null,
        actor: { type: "DEVICE", id: device.id, name: device.name },
      });

      results.push(
        outcome.ok
          ? { clientEventId: event.clientEventId, accepted: true, duplicate: outcome.duplicate }
          : {
              clientEventId: event.clientEventId,
              accepted: false,
              duplicate: false,
              reason: outcome.reason,
              message: outcome.message,
            },
      );
    } catch (err) {
      console.error("[scanner] event failed", event.clientEventId, err);
      // Reported as not accepted WITHOUT a reason, which tells the scanner to
      // keep it queued and retry rather than drop it.
      results.push({ clientEventId: event.clientEventId, accepted: false, duplicate: false });
    }
  }

  return Response.json(
    { serverTime: serverNow().toISOString(), results },
    { headers: { "cache-control": "no-store" } },
  );
}
