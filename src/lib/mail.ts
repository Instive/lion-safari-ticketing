import { env } from "./env";

export type MailAttachment = {
  filename: string;
  /** Base64-encoded content. */
  content: string;
};

/**
 * Splits `MAIL_FROM`'s "Name <email>" shape into Brevo's separate fields.
 * Falls back to treating the whole value as the email if there's no "<...>".
 */
function parseMailFrom(value: string): { email: string; name?: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (!match) return { email: value.trim() };
  const [, name, email] = match;
  return { email: email!, name: name || undefined };
}

/**
 * Transactional email via Brevo's REST API — no SDK dependency needed.
 *
 * When no API key is configured (local development), the message is logged
 * instead of sent so the rest of the flow can still be exercised.
 *
 * Brevo's transactional API does not support inline `cid:` image attachments
 * (unlike Resend, which this replaced). The ticket email works around this by
 * linking to `/api/ticket/[code]/qr` instead of attaching the QR — see
 * jobs/handlers/deliver-ticket.ts.
 */
export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}): Promise<{ delivered: boolean; id?: string }> {
  if (!env.BREVO_API_KEY) {
    console.info(
      `[mail] BREVO_API_KEY not set — would have sent "${input.subject}" to ${input.to}`,
    );
    return { delivered: false };
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: parseMailFrom(env.MAIL_FROM),
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
      attachment: input.attachments?.map((a) => ({
        name: a.filename,
        content: a.content,
      })),
    }),
  });

  if (!res.ok) {
    // Thrown so pg-boss retries with backoff.
    throw new Error(`Brevo failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as { messageId?: string };
  return { delivered: true, id: body.messageId };
}
