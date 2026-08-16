import { z } from "zod";

/**
 * Server-side environment. Never import this from a Client Component —
 * it holds payment and session secrets.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.url(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  SESSION_SECRET: z.string().min(32),

  TICKET_PRICE_PAISE: z.coerce.number().int().positive(),
  CONVENIENCE_FEE_PAISE: z.coerce.number().int().min(0).default(0),

  APP_TIMEZONE: z.string().default("Asia/Kolkata"),
  SYNC_STALE_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * How long a PENDING online booking must sit before reconciliation asks the
   * provider about it. Production wants a few minutes so the webhook gets a
   * fair chance; local development without a tunnel wants 1 so testing is quick.
   */
  RECONCILE_MIN_AGE_MINUTES: z.coerce.number().int().positive().default(5),

  CASHFREE_ENV: z.enum(["SANDBOX", "PRODUCTION"]).default("SANDBOX"),
  CASHFREE_APP_ID: z.string().default(""),
  CASHFREE_SECRET_KEY: z.string().default(""),
  CASHFREE_WEBHOOK_SECRET: z.string().default(""),

  RESEND_API_KEY: z.string().default(""),
  MAIL_FROM: z.string().default("Lion Safari <tickets@example.com>"),
  SUPPORT_PHONE: z.string().default(""),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

/** Online payments cannot be accepted until Cashfree credentials are present. */
export const paymentsConfigured =
  env.CASHFREE_APP_ID !== "" && env.CASHFREE_SECRET_KEY !== "";
