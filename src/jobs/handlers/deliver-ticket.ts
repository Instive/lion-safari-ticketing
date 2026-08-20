import { eq } from "drizzle-orm";
import QRCode from "qrcode";

import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { writeAudit } from "@/domain/audit";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { formatPaise } from "@/lib/money";
import { formatDateTime, formatVisitDate } from "@/lib/time";
import type { DeliverTicketJob } from "../queue";

/**
 * Emails the ticket for a confirmed booking.
 *
 * Retryable and idempotent: it only ever reads the ticket that already exists,
 * so a retry re-sends the same QR rather than issuing a second one (spec §5).
 */
export async function deliverTicket(job: DeliverTicketJob): Promise<void> {
  const [row] = await db
    .select({
      bookingId: bookings.id,
      bookingCode: bookings.bookingCode,
      status: bookings.status,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      visitDate: bookings.visitDate,
      customerName: bookings.customerName,
      customerEmail: bookings.customerEmail,
      token: tickets.token,
      ticketStatus: tickets.status,
      issuedAt: tickets.issuedAt,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(eq(bookings.id, job.bookingId))
    .limit(1);

  if (!row) {
    console.warn(`[deliver-ticket] no ticket yet for booking ${job.bookingId}`);
    return;
  }
  if (row.status !== "PAID" && row.status !== "CASH_CONFIRMED") {
    console.warn(`[deliver-ticket] booking ${row.bookingCode} is ${row.status}; not delivering`);
    return;
  }
  if (!row.customerEmail) {
    // Counter sales usually have no email; the printed ticket is the delivery.
    return;
  }

  const ticketUrl = `${env.APP_BASE_URL}/ticket/${row.bookingCode}`;
  const qrPng = await QRCode.toBuffer(row.token, {
    errorCorrectionLevel: "Q",
    margin: 1,
    width: 320,
  });

  await sendMail({
    to: row.customerEmail,
    subject: `Your Lion Safari ticket — ${row.bookingCode}`,
    html: ticketEmailHtml({
      bookingCode: row.bookingCode,
      visitorCount: row.visitorCount,
      visitDate: row.visitDate,
      amountTotal: row.amountTotal,
      issuedAt: row.issuedAt,
      customerName: row.customerName,
      ticketUrl,
    }),
    attachments: [
      {
        filename: `lion-safari-${row.bookingCode}.png`,
        content: qrPng.toString("base64"),
        contentId: "ticket-qr",
      },
    ],
  });

  await writeAudit(db, {
    actor: { type: "SYSTEM", id: "deliver-ticket" },
    action: "ticket.delivered",
    entity: "booking",
    entityId: row.bookingId,
    context: { channel: "email" },
  });
}

function ticketEmailHtml(t: {
  bookingCode: string;
  visitorCount: number;
  visitDate: string;
  amountTotal: number;
  issuedAt: Date;
  customerName: string | null;
  ticketUrl: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#14201a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #d9e0da;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 4px;font-size:18px;color:#14603c">Lion Safari</h1>
    <p style="margin:0 0 20px;font-size:12px;color:#5c6b63;text-transform:uppercase;letter-spacing:.05em">Entry ticket</p>

    <p style="margin:0 0 16px">${t.customerName ? `Hello ${escapeHtml(t.customerName)},` : "Hello,"} your booking is confirmed.</p>

    <div style="text-align:center;margin:24px 0">
      <img src="cid:ticket-qr" alt="Ticket QR code" width="220" height="220" style="display:block;margin:0 auto" />
      <p style="margin:12px 0 0;font-family:ui-monospace,monospace;font-size:20px;font-weight:700;letter-spacing:.15em">${t.bookingCode}</p>
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:14px;border-top:1px solid #d9e0da;padding-top:12px">
      <tr><td style="padding:6px 0;color:#5c6b63">Visit date</td><td style="text-align:right;font-weight:600">${formatVisitDate(t.visitDate)}</td></tr>
      <tr><td style="padding:6px 0;color:#5c6b63">Visitors</td><td style="text-align:right;font-weight:700;font-size:16px">${t.visitorCount}</td></tr>
      <tr><td style="padding:6px 0;color:#5c6b63">Amount paid</td><td style="text-align:right;font-weight:600">${formatPaise(t.amountTotal)}</td></tr>
      <tr><td style="padding:6px 0;color:#5c6b63">Issued</td><td style="text-align:right;font-weight:600">${formatDateTime(t.issuedAt)}</td></tr>
    </table>

    <p style="margin:24px 0 0;text-align:center">
      <a href="${t.ticketUrl}" style="display:inline-block;background:#14603c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View your ticket</a>
    </p>

    <p style="margin:20px 0 0;font-size:12px;color:#5c6b63;text-align:center;line-height:1.6">
      Show the QR code at the safari boarding gate. The whole group must board together.
      ${env.SUPPORT_PHONE ? `<br/>Need help? Call ${escapeHtml(env.SUPPORT_PHONE)}` : ""}
    </p>
  </div>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
