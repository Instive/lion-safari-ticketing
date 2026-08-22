"use server";

import { enqueueDailyReport } from "@/jobs/queue";
import { requireStaff } from "@/lib/auth/guards";
import { businessDate } from "@/lib/time";

export type ReportActionState = { error?: string; success?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Sends the bookings report for a date on demand — the same job the 8pm
 * schedule runs, so a report re-sent by hand is byte-identical to the automatic
 * one. Used when mail was down, or when someone wants yesterday's figures again.
 */
export async function emailReportAction(
  _prev: ReportActionState,
  formData: FormData,
): Promise<ReportActionState> {
  await requireStaff(["ADMIN"]);

  const requested = String(formData.get("businessDate") ?? "").trim();
  const date = ISO_DATE.test(requested) ? requested : businessDate();

  try {
    await enqueueDailyReport(date);
    return { success: `Report for ${date} queued — it will arrive in a few moments.` };
  } catch (err) {
    console.error("[admin] could not queue daily report", err);
    return { error: "Could not queue the report. Is the worker running?" };
  }
}
