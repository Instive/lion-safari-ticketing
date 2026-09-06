import { eq } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

import { isTestEnvironment } from "@/components/staff/env-banner";
import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { clientIpFrom } from "@/lib/auth/session";
import { formatPaise } from "@/lib/money";
import { FREE_ENTRY_NOTE, PARK_ADDRESS, PARK_RULES, PARK_TIMINGS } from "@/lib/park-info";
import { limitTicketLookup } from "@/lib/rate-limit";
import { formatDateTime, formatVisitDate } from "@/lib/time";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Brand colours, matching the ticket card. */
const BRAND = rgb(0.078, 0.376, 0.235);
const INK = rgb(0.078, 0.126, 0.102);
const MUTED = rgb(0.361, 0.42, 0.388);
const LINE = rgb(0.851, 0.878, 0.855);

/**
 * A4 portrait, in points — the standard page size in India, so a guest
 * printing at home gets a full page rather than a scaled-down one.
 *
 * A5 was tried first and the rules section ran off the bottom; the content
 * here is a ticket plus the full visitor briefing, which needs the room.
 */
const PAGE = { width: 595, height: 842 };
const M = 48;

/**
 * The ticket as a downloadable PDF.
 *
 * Exists because "Download" should produce a file, not open a print dialog and
 * ask the guest to find "Save as PDF" — which is several taps on desktop and a
 * different menu entirely on iOS.
 *
 * Laid out here rather than by printing the React ticket, because rendering
 * HTML to PDF server-side needs a headless browser, which is a heavy thing to
 * run on a free web instance for one document. The tradeoff is that this
 * layout is maintained separately from `components/ticket-card.tsx` — the
 * content is the same and comes from the same helpers, but the two have to be
 * changed together.
 *
 * Access is the booking code, and rate limiting is shared with the ticket page
 * and QR route (spec §12).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const { code } = await params;

  const ip = clientIpFrom(req.headers) ?? "unknown";
  const limit = await limitTicketLookup(ip);
  if (!limit.allowed) return new Response("Too many requests", { status: 429 });

  const [row] = await db
    .select({
      bookingCode: bookings.bookingCode,
      status: bookings.status,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      visitDate: bookings.visitDate,
      customerName: bookings.customerName,
      token: tickets.token,
      ticketStatus: tickets.status,
      issuedAt: tickets.issuedAt,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(eq(bookings.bookingCode, code.toUpperCase()))
    .limit(1);

  if (!row) return new Response("Not found", { status: 404 });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const body = await pdf.embedFont(StandardFonts.Helvetica);

  let y = PAGE.height - M;

  // A test ticket must be unmistakable once it is off the screen — the same
  // reason TicketCard prints this band rather than hiding it (spec §16).
  if (isTestEnvironment()) {
    page.drawRectangle({ x: 0, y: y - 6, width: PAGE.width, height: 24, color: rgb(0, 0, 0) });
    page.drawText("TEST TICKET - NOT VALID FOR ENTRY", {
      x: M,
      y: y + 2,
      size: 10,
      font: bold,
      color: rgb(1, 1, 1),
    });
    y -= 34;
  }

  page.drawText("M.C.Z.P Chhatbir", { x: M, y: y - 18, size: 20, font: bold, color: BRAND });
  page.drawText("WILDLIFE SAFARI", { x: M, y: y - 32, size: 8, font: body, color: MUTED });
  y -= 52;

  page.drawLine({
    start: { x: M, y },
    end: { x: PAGE.width - M, y },
    thickness: 1,
    color: LINE,
  });
  y -= 24;

  // The QR, centred — the only thing on the page that has to survive a scan.
  const qrPng = await QRCode.toBuffer(row.token, {
    errorCorrectionLevel: "Q",
    margin: 1,
    width: 600,
  });
  const qr = await pdf.embedPng(new Uint8Array(qrPng));
  const qrSize = 170;
  page.drawImage(qr, { x: (PAGE.width - qrSize) / 2, y: y - qrSize, width: qrSize, height: qrSize });
  y -= qrSize + 18;

  const codeWidth = bold.widthOfTextAtSize(row.bookingCode, 16);
  page.drawText(row.bookingCode, {
    x: (PAGE.width - codeWidth) / 2,
    y,
    size: 16,
    font: bold,
    color: INK,
  });
  y -= 14;

  const scanNote = "Show this QR code at the safari boarding gate";
  const scanWidth = body.widthOfTextAtSize(scanNote, 9);
  page.drawText(scanNote, {
    x: (PAGE.width - scanWidth) / 2,
    y,
    size: 9,
    font: body,
    color: MUTED,
  });
  y -= 26;

  // Details
  const rows: [string, string][] = [
    ["Visit date", formatVisitDate(row.visitDate)],
    ["Visitors", String(row.visitorCount)],
    ["Issued", formatDateTime(row.issuedAt)],
  ];
  if (row.customerName) rows.push(["Name", row.customerName]);
  rows.push(["Amount paid", formatPaise(row.amountTotal).replace("₹", "Rs ")]);

  for (const [label, value] of rows) {
    page.drawLine({
      start: { x: M, y: y + 13 },
      end: { x: PAGE.width - M, y: y + 13 },
      thickness: 0.5,
      color: LINE,
    });
    page.drawText(label.toUpperCase(), { x: M, y, size: 8, font: body, color: MUTED });
    const vw = bold.widthOfTextAtSize(value, 11);
    page.drawText(value, { x: PAGE.width - M - vw, y: y - 1, size: 11, font: bold, color: INK });
    y -= 22;
  }

  y -= 10;
  page.drawLine({
    start: { x: M, y },
    end: { x: PAGE.width - M, y },
    thickness: 1,
    color: LINE,
  });
  y -= 20;

  // Visit information, matching the email's "Before you visit" block.
  const info: [string, string[]][] = [
    ["Timings", [PARK_TIMINGS.open, PARK_TIMINGS.closed, PARK_TIMINGS.lastEntry]],
    ["Tickets", [FREE_ENTRY_NOTE]],
    ["Location", [...PARK_ADDRESS.lines]],
    ["Rules & guidelines", [...PARK_RULES]],
  ];

  for (const [title, lines] of info) {
    page.drawText(title.toUpperCase(), { x: M, y, size: 8, font: bold, color: BRAND });
    y -= 13;
    for (const line of lines) {
      for (const piece of wrap(line, body, 8.5, PAGE.width - M * 2 - 8)) {
        page.drawText(piece, { x: M + 8, y, size: 8.5, font: body, color: MUTED });
        y -= 11;
      }
    }
    y -= 8;
  }

  const bytes = await pdf.save();

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      // `attachment` is what makes the browser download rather than preview.
      "content-disposition": `attachment; filename="lion-safari-${row.bookingCode}.pdf"`,
      "cache-control": "no-store",
    },
  });
}

/** Greedy word wrap — pdf-lib draws single lines only. */
function wrap(
  text: string,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}
