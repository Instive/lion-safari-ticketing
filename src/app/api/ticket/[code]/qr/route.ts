import { eq } from "drizzle-orm";
import QRCode from "qrcode";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { clientIpFrom } from "@/lib/auth/session";
import { limitTicketLookup } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The ticket QR as a standalone image, for the ticket email's <img src>.
 *
 * The switch away from Resend (see mail.ts) dropped `cid:` inline-attachment
 * support, so the QR has to be fetchable by URL instead of embedded in the
 * message. This is not a new exposure: `/ticket/[code]` already renders this
 * same token to anyone holding the booking code — that page's TicketView is
 * the credential boundary, not a session. This route sits behind the exact
 * same rate limiter for the exact same reason (spec §12: booking codes are the
 * enumeration surface).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;

  const ip = clientIpFrom(req.headers) ?? "unknown";
  const limit = await limitTicketLookup(ip);
  if (!limit.allowed) {
    return new Response("Too many requests", { status: 429 });
  }

  const [row] = await db
    .select({ token: tickets.token })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(eq(bookings.bookingCode, code.toUpperCase()))
    .limit(1);

  if (!row) {
    return new Response("Not found", { status: 404 });
  }

  const png = await QRCode.toBuffer(row.token, {
    errorCorrectionLevel: "Q",
    margin: 1,
    width: 320,
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // Never cache: a shared/proxy cache serving one customer's QR to
      // another on a coalesced request would be a real problem, not a
      // performance bug.
      "cache-control": "no-store",
    },
  });
}
