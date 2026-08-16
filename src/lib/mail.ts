import { env } from "./env";

export type MailAttachment = {
  filename: string;
  /** Base64-encoded content. */
  content: string;
  contentId?: string;
};

/**
 * Transactional email via Resend's REST API — no SDK dependency needed.
 *
 * When no API key is configured (local development), the message is logged
 * instead of sent so the rest of the flow can still be exercised.
 */
export async function sendMail(input: {
  to: string;
  subject: string;
  html: string;
  attachments?: MailAttachment[];
}): Promise<{ delivered: boolean; id?: string }> {
  if (!env.RESEND_API_KEY) {
    console.info(
      `[mail] RESEND_API_KEY not set — would have sent "${input.subject}" to ${input.to}`,
    );
    return { delivered: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        content_id: a.contentId,
      })),
    }),
  });

  if (!res.ok) {
    // Thrown so pg-boss retries with backoff.
    throw new Error(`Resend failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  }

  const body = (await res.json()) as { id?: string };
  return { delivered: true, id: body.id };
}
