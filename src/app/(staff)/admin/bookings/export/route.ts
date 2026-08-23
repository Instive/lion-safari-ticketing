import { requireStaff } from "@/lib/auth/guards";
import { ForbiddenError } from "@/domain/errors";
import { csvRow, CSV_BOM } from "@/lib/csv";
import { paiseToRupeeString } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { parseFilters, streamBookings, type BookingFilters } from "@/domain/reports/bookings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const COLUMNS = [
  "Booking code",
  "Channel",
  "Booking status",
  "Ticket status",
  "Visit date",
  "Booked at (IST)",
  "Visitors",
  "Boarded",
  "Rate",
  "Per visitor (INR)",
  "Amount (INR)",
  "Convenience fee (INR)",
  "Sold offline",
  "Guest name",
  "Phone",
  "Email",
  "Sold by",
  "Rate note",
];

/**
 * The same rows the admin screen is showing, as a spreadsheet.
 *
 * Filters come from the query string, parsed by the same function the page
 * uses, so "export" always means "what I am looking at". Rows are streamed in
 * batches rather than assembled in memory — a full month is tens of thousands
 * of rows and this runs on a small instance.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    await requireStaff(["ADMIN"]);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return Response.json({ error: "unauthorized" }, { status: 403 });
    }
    throw err;
  }

  const url = new URL(req.url);
  const filters = parseFilters(Object.fromEntries(url.searchParams.entries()));
  // An export is a whole-range document; paging it would silently truncate.
  const unpaged: BookingFilters = { ...filters, page: 1 };

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(CSV_BOM + csvRow(COLUMNS)));

        for await (const batch of streamBookings(unpaged)) {
          let chunk = "";
          for (const row of batch) {
            chunk += csvRow([
              row.bookingCode,
              row.channel,
              row.status,
              row.ticketStatus ?? "",
              row.visitDate,
              formatDateTime(row.createdAt),
              row.visitorCount,
              row.boardedCount,
              row.rateName ?? "Standard",
              Number(paiseToRupeeString(row.perVisitorPaise)),
              // Plain decimals, not "₹75.00" — the point of a spreadsheet is
              // that the amount column adds up.
              Number(paiseToRupeeString(row.amountTotal)),
              Number(paiseToRupeeString(row.convenienceFee)),
              row.soldOfflineAt ? formatDateTime(row.soldOfflineAt) : "",
              row.customerName ?? "",
              row.customerPhone ?? "",
              row.customerEmail ?? "",
              row.soldBy ?? "",
              row.rateNote ?? "",
            ]);
          }
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        console.error("[export] failed mid-stream", err);
        controller.error(err);
      }
    },
  });

  const filename = `bookings-${unpaged.dateField}-${unpaged.from}-to-${unpaged.to}.csv`;

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
