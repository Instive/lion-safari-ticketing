import { z } from "zod";

/**
 * Server-side environment. Never import this from a Client Component —
 * it holds payment and session secrets.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** The public, customer-facing origin. Cashfree return URLs and ticket email links use it. */
  APP_BASE_URL: z.url(),
  /**
   * The staff operations origin, when staff runs on its own hostname.
   *
   * Leave unset to serve everything from APP_BASE_URL as before — `src/proxy.ts`
   * treats an absent value as "single host" and gates nothing. Setting it splits
   * the app: staff paths serve only here, customer paths only on APP_BASE_URL.
   */
  STAFF_BASE_URL: z.url().optional(),
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

  /**
   * Who receives the nightly bookings CSV — comma-separated. Leave unset and
   * the report simply doesn't send, the same way mail is a no-op without an API
   * key: an unconfigured deployment must never fail a job it cannot deliver.
   */
  REPORT_EMAIL_TO: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function load(): Env {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return parsed.data;
}

/**
 * Validated lazily, on first property access rather than at import.
 *
 * This matters for deployment: `next build` imports every module to collect
 * page data, so eager validation would force real production secrets to be
 * present in the build environment. Every page here is dynamic, so nothing
 * actually reads config at build time — and the first request still fails loudly
 * if configuration is wrong.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, property: string) {
    cached ??= load();
    return cached[property as keyof Env];
  },
});

/** Online payments cannot be accepted until Cashfree credentials are present. */
export function paymentsConfigured(): boolean {
  return env.CASHFREE_APP_ID !== "" && env.CASHFREE_SECRET_KEY !== "";
}

/**
 * Where staff pages live. Falls back to the public origin when the hosts are
 * not split, so callers work unchanged in single-host mode.
 */
export function staffBaseUrl(): string {
  return env.STAFF_BASE_URL ?? env.APP_BASE_URL;
}
