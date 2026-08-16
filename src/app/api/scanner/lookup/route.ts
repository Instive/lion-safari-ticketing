import { z } from "zod";

import { validateToken } from "@/domain/boarding/confirm";
import { authenticateDevice, deviceUnauthorized } from "@/lib/auth/device";
import { serverNow } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ token: z.string().min(8).max(200) });

/**
 * Authoritative lookup for a QR the local cache does not recognise.
 *
 * This is the controlled fallback for a guest who booked online moments ago,
 * between two syncs (spec §7.2). It is only reachable with a valid device key,
 * and it is only consulted when the device is online — when offline, an unknown
 * QR stays unknown rather than being assumed valid.
 */
export async function POST(req: Request): Promise<Response> {
  const device = await authenticateDevice(req.headers);
  if (!device || device.type !== "SCANNER") return deviceUnauthorized();

  let parsed;
  try {
    parsed = schema.safeParse(await req.json());
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const result = await validateToken(parsed.data.token);

  return Response.json(
    {
      serverTime: serverNow().toISOString(),
      valid: result.valid,
      reason: result.valid ? null : result.reason,
      message: result.valid ? null : result.message,
      ticket: result.ticket
        ? {
            ticketId: result.ticket.ticketId,
            bookingCode: result.ticket.bookingCode,
            status: result.ticket.status,
            visitorCount: result.ticket.visitorCount,
            visitDate: result.ticket.visitDate,
            usedAt: result.ticket.usedAt,
          }
        : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
