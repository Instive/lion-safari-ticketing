import { eq } from "drizzle-orm";

import { isTestEnvironment } from "@/components/staff/env-banner";
import { db } from "@/db";
import { bookings, tickets } from "@/db/schema";
import { writeAudit } from "@/domain/audit";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { formatPaise } from "@/lib/money";
import { businessDate, formatClockTime, formatDateTime, formatVisitDate } from "@/lib/time";
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
  const qrUrl = `${env.APP_BASE_URL}/api/ticket/${row.bookingCode}/qr`;

  // Same rule as TicketCard: an advance booking keeps the visit date and the
  // purchase date as separate facts; a same-day one collapses them.
  const issuedOnVisitDay = businessDate(row.issuedAt) === row.visitDate;

  await sendMail({
    to: row.customerEmail,
    subject: `Your Lion Safari ticket — ${row.bookingCode}`,
    html: ticketEmailHtml({
      bookingCode: row.bookingCode,
      visitorCount: row.visitorCount,
      visitDate: row.visitDate,
      amountTotal: row.amountTotal,
      issuedAt: row.issuedAt,
      issuedTimeLabel: issuedOnVisitDay ? formatClockTime(row.issuedAt) : null,
      customerName: row.customerName,
      isTest: isTestEnvironment(),
      ticketUrl,
      qrUrl,
    }),
  });

  await writeAudit(db, {
    actor: { type: "SYSTEM", id: "deliver-ticket" },
    action: "ticket.delivered",
    entity: "booking",
    entityId: row.bookingId,
    context: { channel: "email" },
  });
}

/** Matches the TERMS list on the printed ticket (components/ticket-card.tsx). */
const TERMS = [
  "Ticket is valid only for the date and time mentioned.",
  "Non-transferable, non-refundable and valid for one-time entry only.",
  "Please follow the rules and instructions for a safe and enjoyable safari.",
];

/** One label/value line, styled to match TicketCard's dotted `Row`. */
function row(label: string, value: string, strong = false): string {
  return `<tr>
    <td style="padding:5px 0;border-bottom:1px dotted #d9e0da;color:#5c6b63;font-size:11px;letter-spacing:0.12em;text-transform:uppercase">${label}</td>
    <td style="padding:5px 0;border-bottom:1px dotted #d9e0da;text-align:right;font-size:${strong ? "16px" : "13px"};font-weight:${strong ? "700" : "500"}">${value}</td>
  </tr>`;
}

/**
 * The ticket email, laid out to match the printed/on-screen ticket
 * (components/ticket-card.tsx) as closely as email allows.
 *
 * Deliberately NOT sharing code with TicketCard: that is a React component
 * styled with Tailwind classes, and email clients strip <style> blocks and
 * external CSS entirely. Everything here is inline-styled and table-based so
 * it survives Outlook and Gmail. The two therefore have to be kept in step by
 * hand — the section order, the row set and the terms list are the parts that
 * matter if TicketCard changes.
 */
function ticketEmailHtml(t: {
  bookingCode: string;
  visitorCount: number;
  visitDate: string;
  amountTotal: number;
  issuedAt: Date;
  issuedTimeLabel: string | null;
  customerName: string | null;
  isTest: boolean;
  ticketUrl: string;
  qrUrl: string;
}): string {
  const dateValue = t.issuedTimeLabel
    ? `${formatVisitDate(t.visitDate)} · ${t.issuedTimeLabel}`
    : formatVisitDate(t.visitDate);

  return `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#f6f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#14201a">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="max-width:420px;margin:0 auto;width:100%;background:#fff;border:1px solid #d9e0da;border-radius:16px;overflow:hidden">

    ${
      t.isTest
        ? `<tr><td style="background:#000;color:#fff;padding:6px 12px;text-align:center;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase">Test ticket — not valid for entry</td></tr>`
        : ""
    }

    <tr><td style="padding:16px 12px 10px;text-align:center">
      <div style="font-size:24px;font-weight:700;letter-spacing:0.04em;color:#14603c">M.C.Z.P Chhatbir</div>
      <div style="margin-top:2px;font-size:9px;letter-spacing:0.3em;text-transform:uppercase;color:#5c6b63">Wildlife Safari</div>
    </td></tr>

    <tr><td style="border-top:1px dashed #d9e0da"></td></tr>

    <tr><td style="padding:14px 16px 12px;text-align:center">
      <div style="display:inline-block;background:#14603c;color:#fff;border-radius:999px;padding:4px 12px;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase">Scan at the gate</div>

      <div style="margin:12px auto 0;background:#fff;padding:8px;display:inline-block">
        <a href="${t.ticketUrl}"><img src="${t.qrUrl}" alt="Ticket QR code — tap to view your ticket" width="200" height="200" style="display:block;border:0" /></a>
      </div>

      <div style="margin-top:10px;font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:#5c6b63">
        Ticket no.
        <span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:600;letter-spacing:0.12em;color:#14201a">${t.bookingCode}</span>
      </div>

      <div style="margin-top:8px;font-size:11px;line-height:1.5;color:#5c6b63">Show this QR code at the safari boarding gate.</div>
    </td></tr>

    <tr><td style="border-top:1px dashed #d9e0da"></td></tr>

    <tr><td style="padding:10px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px">
        ${row("Date", dateValue)}
        ${row("Visitors", String(t.visitorCount), true)}
        ${t.issuedTimeLabel ? "" : row("Issued", formatDateTime(t.issuedAt))}
        ${t.customerName ? row("Name", escapeHtml(t.customerName)) : ""}
        <tr>
          <td style="padding-top:8px;border-top:2px double #d9e0da;font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase">Amount paid</td>
          <td style="padding-top:8px;border-top:2px double #d9e0da;text-align:right;font-size:18px;font-weight:700">${formatPaise(t.amountTotal)}</td>
        </tr>
      </table>
    </td></tr>

    <tr><td style="border-top:1px dashed #d9e0da"></td></tr>

    <tr><td style="padding:12px 16px 8px;text-align:center">
      <a href="${t.ticketUrl}" style="display:inline-block;background:#14603c;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px">View your ticket</a>
    </td></tr>

    <tr><td style="padding:4px 16px 14px">
      <div style="font-size:9px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase;color:#5c6b63">Terms &amp; conditions</div>
      <div style="margin-top:4px;font-size:10px;line-height:1.6;color:#5c6b63">
        ${TERMS.map((term) => `• ${term}`).join("<br/>")}
      </div>
      ${
        env.SUPPORT_PHONE
          ? `<div style="margin-top:10px;font-size:11px;text-align:center;color:#5c6b63">Need help? Call ${escapeHtml(env.SUPPORT_PHONE)}</div>`
          : ""
      }
      <div style="margin-top:10px;text-align:center;font-size:18px;color:#14603c">Thank You &amp; Visit Again!</div>
    </td></tr>

  </table>
</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
