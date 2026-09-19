"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { MAX_VISITORS_PER_BOOKING } from "@/domain/booking/pricing";
import { createGroupEnquiry } from "@/domain/enquiry";
import { DomainError } from "@/domain/errors";
import { clientIpFrom } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { limitGroupEnquiry } from "@/lib/rate-limit";

const schema = z.object({
  organisation: z.string().trim().min(2, "organisation required").max(160),
  contactName: z.string().trim().min(1, "name required").max(120),
  contactEmail: z.email().max(200),
  contactPhone: z
    .string()
    .trim()
    .regex(/^[0-9]{10}$/, "10-digit phone required"),
  visitorCount: z.coerce.number().int().min(1).max(MAX_VISITORS_PER_BOOKING),
  /**
   * Optional: a school often enquires before a date is fixed. An empty string
   * from the form means "not decided yet", which is stored as NULL rather than
   * being rejected — chasing a date they do not have would lose the lead.
   */
  visitDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
});

export type EnquiryState = { error?: string; sent?: boolean };

/**
 * Records a group enquiry and notifies staff.
 *
 * Note what this does NOT do: it does not price anything, hold a date, or
 * create a booking. Group rates are agreed by a person and the sale is made
 * at the counter — see `domain/enquiry` for why that separation is deliberate
 * rather than a missing feature.
 */
export async function submitGroupEnquiryAction(
  _prev: EnquiryState,
  formData: FormData,
): Promise<EnquiryState> {
  const ip = clientIpFrom(await headers()) ?? "unknown";
  const limit = await limitGroupEnquiry(ip);
  if (!limit.allowed) {
    return { error: "We have already received a few enquiries from here. Please try again later." };
  }

  const parsed = schema.safeParse({
    organisation: formData.get("organisation"),
    contactName: formData.get("contactName"),
    contactEmail: formData.get("contactEmail"),
    contactPhone: formData.get("contactPhone"),
    visitorCount: formData.get("visitorCount"),
    visitDate: formData.get("visitDate"),
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return { error: friendlyFieldError(parsed.error.issues[0]?.path[0]) };
  }

  try {
    const enquiry = await createGroupEnquiry({
      organisation: parsed.data.organisation,
      contactName: parsed.data.contactName,
      contactEmail: parsed.data.contactEmail,
      contactPhone: parsed.data.contactPhone,
      visitorCount: parsed.data.visitorCount,
      visitDate: parsed.data.visitDate ? parsed.data.visitDate : null,
      message: parsed.data.message ? parsed.data.message : null,
    });

    // Best effort, and deliberately after the row is committed: the enquiry is
    // already safe in the admin list, so a mail outage must not turn into a
    // lost lead or an error shown to someone who did nothing wrong.
    //
    // Reuses REPORT_EMAIL_TO rather than adding a near-identical setting —
    // it already means "the address that receives operational mail", and one
    // fewer env var is one fewer thing to get wrong on a deployment.
    for (const to of notifyAddresses()) {
      try {
        await sendMail({
          to,
          subject: `Group enquiry — ${enquiry.organisation} (${enquiry.visitorCount} visitors)`,
          html: notificationHtml(enquiry),
        });
      } catch (err) {
        console.error("[enquiry] could not send staff notification", err);
      }
    }

    return { sent: true };
  } catch (err) {
    if (err instanceof DomainError) return { error: err.userMessage };
    console.error("[enquiry] could not record group enquiry", err);
    return { error: "We could not send your enquiry. Please try again, or call the park." };
  }
}

/** Same list the nightly report uses; empty simply means nobody is notified. */
function notifyAddresses(): string[] {
  return env.REPORT_EMAIL_TO.split(",")
    .map((address) => address.trim())
    .filter(Boolean);
}

function notificationHtml(enquiry: {
  organisation: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  visitorCount: number;
  visitDate: string | null;
  message: string | null;
}): string {
  const rows: Array<[string, string]> = [
    ["Organisation", enquiry.organisation],
    ["Contact", enquiry.contactName],
    ["Email", enquiry.contactEmail],
    ["Phone", enquiry.contactPhone],
    ["Group size", String(enquiry.visitorCount)],
    ["Preferred date", enquiry.visitDate ?? "Not decided"],
  ];
  if (enquiry.message) rows.push(["Message", enquiry.message]);

  return `
    <h2 style="font-family:system-ui,sans-serif">New group enquiry</h2>
    <table style="font-family:system-ui,sans-serif;border-collapse:collapse">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`,
        )
        .join("")}
    </table>
    <p style="font-family:system-ui,sans-serif;color:#666">
      Agree a price with them, then sell it at the counter — group rates are not
      available through online checkout.
    </p>
  `;
}

/** The enquirer's own words end up in an email, so they are escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function friendlyFieldError(field: unknown): string {
  switch (field) {
    case "organisation":
      return "Please enter the name of your school or organisation.";
    case "contactName":
      return "Please enter the name of the person we should speak to.";
    case "contactEmail":
      return "Please enter a valid email address so we can reply.";
    case "contactPhone":
      return "Please enter a valid 10-digit mobile number.";
    case "visitorCount":
      return "Please tell us roughly how many people are coming.";
    default:
      return "Please check the details and try again.";
  }
}
