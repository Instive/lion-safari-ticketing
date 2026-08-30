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

  /**
   * Which deployment this is — a laptop, the shared dev site, or the real one.
   *
   * Separate from NODE_ENV because NODE_ENV cannot answer this question: the dev
   * site is a genuine HTTPS deployment and needs `NODE_ENV=production` for
   * secure session cookies (`src/lib/auth/session.ts`) and for the offline
   * service worker to register at all (`src/components/staff/service-worker.tsx`).
   * Both deployments are "production" to Node; only one of them is production to
   * the park.
   *
   * Defaults to `production` on purpose, which is the opposite of convenient. An
   * environment that forgets to declare itself is treated as the one where
   * seeding and the verify suite are refused, so the failure mode of a missing
   * variable is a script that will not run — never a script that quietly
   * rewrites the live database.
   */
  APP_ENV: z.enum(["local", "dev", "production"]).default("production"),

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

  /**
   * Run the background jobs INSIDE the web process instead of as a separate
   * service.
   *
   * The separate `lion-safari-worker` service exists for a real reason, stated
   * at the top of worker.ts: a slow email or an unresponsive payment API can
   * never delay a web request when it lives in its own process. That is the
   * right shape at scale, and it is what this defaults to.
   *
   * It is also a whole paid instance for a park that sells a few hundred
   * tickets a day, where the jobs are almost entirely `await`ed network calls
   * that yield the event loop rather than block it. Setting this to `true` on
   * the web service and deleting the worker service trades that isolation for
   * roughly half the hosting bill.
   *
   * Only safe because the web plan does not sleep — a free/sleeping instance
   * would stop reconciling payments the moment traffic stopped, which is
   * exactly when a lost webhook needs catching. pg-boss locks each job row, so
   * even if the web service is later scaled to several instances they
   * cooperate rather than double-send.
   */
  RUN_WORKER_IN_WEB: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function load(): Env {
  /*
   * A Client Component that imports this — usually indirectly, through a
   * helper that reaches for APP_TIMEZONE — pulls the server's environment
   * validation into the browser, where `process.env` is empty and this throws
   * on the first render, taking the React tree with it. The zod failure that
   * results names DATABASE_URL and SESSION_SECRET, which sends you looking for
   * a config problem that does not exist. Say what actually happened instead.
   */
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/env was imported by client code. Server configuration must never " +
        "reach the browser — check the import chain of the component that just " +
        "rendered (`@/lib/time` is the usual route in) and pass the value as a " +
        "prop, or use a client-safe helper such as @/lib/format-date.",
    );
  }

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
