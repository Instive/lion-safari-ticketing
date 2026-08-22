import { csvRow, CSV_BOM } from "@/lib/csv";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { formatPaise, paiseToRupeeString } from "@/lib/money";
import { businessDate, formatDateTime, formatVisitDate } from "@/lib/time";
import {
  bookingTotals,
  rangeFor,
  streamBookings,
  type BookingFilters,
} from "@/domain/reports/bookings";

export type DailyReportJob = { businessDate?: string };

const COLUMNS = [
  "Booking code",
  "Channel",
  "Booking status",
  "Ticket status",
  "Visit date",
  "Booked at (IST)",
  "Visitors",
  "Boarded",
  "Amount (INR)",
  "Convenience fee (INR)",
  "Guest name",
  "Phone",
  "Email",
  "Sold by",
];

function recipients(): string[] {
  return env.REPORT_EMAIL_TO.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

/**
 * The day's bookings, emailed out as a CSV every evening.
 *
 * This is deliberately an *email*, not a file written to disk: the web service
 * has no persistent volume, and a copy that lives on the same machine as the
 * database is not a copy of anything. Landing in an inbox puts a daily snapshot
 * somewhere the application cannot reach, on infrastructure that is already
 * paid for.
 *
 * It is a business record, not a backup — it carries no ticket tokens, no audit
 * trail and no payment events, so it can be forwarded safely but cannot rebuild
 * the system. Managed Postgres backups remain the thing that restores service.
 */
export async function sendDailyReport(job: DailyReportJob = {}): Promise<{
  sent: boolean;
  rows: number;
  date: string;
}> {
  const date = job.businessDate ?? businessDate();
  const { from, to } = rangeFor("custom", date, date);

  const filters: BookingFilters = {
    preset: "custom",
    from,
    to,
    // The operating day: everyone whose visit was today, whenever they booked.
    dateField: "visit",
    channel: "ALL",
    status: "ALL",
    q: "",
    page: 1,
  };

  const totals = await bookingTotals(filters);

  let csv = CSV_BOM + csvRow(COLUMNS);
  let rows = 0;
  for await (const batch of streamBookings(filters)) {
    for (const row of batch) {
      rows += 1;
      csv += csvRow([
        row.bookingCode,
        row.channel,
        row.status,
        row.ticketStatus ?? "",
        row.visitDate,
        formatDateTime(row.createdAt),
        row.visitorCount,
        row.boardedCount,
        Number(paiseToRupeeString(row.amountTotal)),
        Number(paiseToRupeeString(row.convenienceFee)),
        row.customerName ?? "",
        row.customerPhone ?? "",
        row.customerEmail ?? "",
        row.soldBy ?? "",
      ]);
    }
  }

  const to_ = recipients();
  if (to_.length === 0) {
    console.info(`[daily-report] REPORT_EMAIL_TO not set — ${rows} row(s) for ${date} not sent`);
    return { sent: false, rows, date };
  }

  const label = formatVisitDate(date);
  const html = reportHtml({ label, totals, rows });
  const attachment = {
    filename: `lion-safari-bookings-${date}.csv`,
    content: Buffer.from(csv, "utf8").toString("base64"),
  };

  // One message per recipient: sendMail takes a single address, and a failure
  // for one inbox must not stop the others from getting the day's numbers.
  let delivered = 0;
  for (const address of to_) {
    try {
      await sendMail({
        to: address,
        subject: `Chhatbir Safari — bookings for ${label} (${totals.confirmedBookings} confirmed, ${formatPaise(totals.collectedPaise)})`,
        html,
        attachments: [attachment],
      });
      delivered += 1;
    } catch (err) {
      console.error(`[daily-report] could not send to ${address}`, err);
    }
  }

  if (delivered === 0 && to_.length > 0) {
    // Nobody got it — throw so pg-boss retries rather than logging a silent loss.
    throw new Error(`daily report for ${date} reached none of ${to_.length} recipient(s)`);
  }

  console.info(`[daily-report] ${date}: ${rows} row(s) sent to ${delivered} recipient(s)`);
  return { sent: true, rows, date };
}

function reportHtml(input: {
  label: string;
  totals: Awaited<ReturnType<typeof bookingTotals>>;
  rows: number;
}): string {
  const { label, totals, rows } = input;
  const cell = "padding:6px 0;color:#5c6b63";
  const value = "text-align:right;font-weight:600";

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#14201a">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #d9e0da;border-radius:12px;padding:24px">
    <h1 style="margin:0 0 4px;font-size:18px;color:#1b3624">Daily bookings report</h1>
    <p style="margin:0 0 20px;font-size:13px;color:#5c6b63">${label}</p>

    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="${cell}">Confirmed bookings</td><td style="${value}">${totals.confirmedBookings}</td></tr>
      <tr><td style="${cell}">Visitors</td><td style="${value}">${totals.visitors}</td></tr>
      <tr><td style="${cell}">Boarded at the gate</td><td style="${value}">${totals.boarded}</td></tr>
      <tr><td style="${cell}">Online / counter</td><td style="${value}">${totals.online} / ${totals.counter}</td></tr>
      <tr><td style="${cell}">Collected</td><td style="${value}">${formatPaise(totals.collectedPaise)}</td></tr>
      ${totals.refundedPaise > 0 ? `<tr><td style="${cell}">Refunded</td><td style="${value}">${formatPaise(totals.refundedPaise)}</td></tr>` : ""}
      ${totals.pending > 0 ? `<tr><td style="${cell}">Still awaiting payment</td><td style="${value}">${totals.pending}</td></tr>` : ""}
    </table>

    <p style="margin:20px 0 0;font-size:13px;color:#5c6b63;line-height:1.6">
      The attached CSV lists all ${rows} booking${rows === 1 ? "" : "s"} for this date, including
      cancelled and unpaid ones. Amount columns are plain numbers so they add up in a spreadsheet.
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#5c6b63;line-height:1.6">
      Keep these emails: together they are an off-site copy of the booking record. They are not a
      database backup — restoring the system itself uses the managed Postgres backups.
    </p>
  </div>
</body></html>`;
}
