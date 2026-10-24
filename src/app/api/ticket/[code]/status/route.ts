import { eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema";
import { clientIpFrom } from "@/lib/auth/session";
import { limitTicketLookup } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Status only: polling doesn't render a page, generate a QR, or expose guest data. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }): Promise<Response> {
  const headers = { "cache-control": "no-store" };
  const limit = await limitTicketLookup(clientIpFrom(req.headers) ?? "unknown");
  if (!limit.allowed) {
    return Response.json({ error: "Too many requests" }, {
      status: 429, headers: { ...headers, "retry-after": String(limit.retryAfterSeconds) },
    });
  }
  const { code } = await params;
  const [row] = await db.select({ status: bookings.status }).from(bookings)
    .where(eq(bookings.bookingCode, code.toUpperCase())).limit(1);
  if (!row || row.status === "RESERVED") {
    return Response.json({ error: "Not found" }, { status: 404, headers });
  }
  return Response.json({ status: row.status }, { headers });
}
