import { z } from "zod";

import { BOOK_HORIZON_DAYS, allocateBook, loadBook } from "@/domain/booking/reserve";
import { authenticateDevice, deviceUnauthorized } from "@/lib/auth/device";
import { businessDate, serverNow } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const querySchema = z.object({
  /** Skip topping up — used by the admin stock view, which only reads. */
  readOnly: z.enum(["0", "1"]).default("0"),
});

/**
 * The counter device's ticket book: blanks it can sell while the internet is
 * down.
 *
 * Unlike the scanner's manifest — which carries only token hashes, because a
 * stolen gate device must leak nothing — this necessarily returns the raw
 * tokens: the counter has to print them onto tickets. That is why a book is
 * bound to one enrolled device, kept small, dated, and reconciled daily.
 *
 * Called on every counter load. It tops the book up to target for today and the
 * next couple of days, so an outage that begins overnight still finds stock.
 */
export async function GET(req: Request): Promise<Response> {
  const device = await authenticateDevice(req.headers);
  if (!device || device.type !== "COUNTER") return deviceUnauthorized();

  const url = new URL(req.url);
  const query = querySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!query.success) return Response.json({ error: "invalid query" }, { status: 400 });

  // Server-decided dates, never the device's: an outage is exactly when a
  // device clock is least trustworthy (spec §6).
  const today = businessDate();
  const dates = [today, ...upcoming(today, BOOK_HORIZON_DAYS)];

  let allocated = 0;
  if (query.data.readOnly === "0") {
    for (const visitDate of dates) {
      const { created } = await allocateBook({
        deviceId: device.id,
        visitDate,
        actor: { type: "DEVICE", id: device.id, name: device.name },
      });
      allocated += created;
    }
  }

  const blanks = await loadBook(device.id, dates);

  return Response.json(
    {
      serverTime: serverNow().toISOString(),
      visitDate: today,
      allocated,
      blanks,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/** The next `days` business dates after `from`, as yyyy-MM-dd. */
function upcoming(from: string, days: number): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  for (let i = 1; i <= days; i++) {
    // UTC arithmetic on a bare calendar date — no timezone shift can occur
    // because this never touches a clock, only the date parts.
    const next = new Date(Date.UTC(y!, m! - 1, d! + i));
    out.push(next.toISOString().slice(0, 10));
  }
  return out;
}
