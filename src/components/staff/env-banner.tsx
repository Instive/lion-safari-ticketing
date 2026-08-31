import { appEnv } from "@/lib/env";

/**
 * Says, permanently and unmissably, that this is not the real system.
 *
 * The dev site exists so staff can try things, which means a member of staff
 * will at some point stand at a counter, take a sale on it, and hand over a
 * ticket. Everything else about that flow is deliberately identical to
 * production — that is the entire point of a test environment — so the only
 * thing standing between a rehearsal and a guest being sold nothing is this.
 *
 * Renders nothing in production, so it costs the real system a single
 * comparison and no markup.
 */
export function EnvBanner() {
  // `appEnv()` rather than `env.APP_ENV`: this renders inside layouts that wrap
  // statically prerendered pages, and reading the validated env there would
  // demand production secrets during `next build` (see lib/env.ts).
  const current = appEnv();
  if (current === "production") return null;

  return (
    <div
      role="status"
      className="no-print bg-danger px-4 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white"
    >
      Test system{current === "local" ? " (local)" : ""} — tickets issued here are not valid
      for entry
    </div>
  );
}

/**
 * Whether tickets printed by this deployment must be marked as tests.
 *
 * Exported as a function rather than the raw flag so Client Components cannot
 * be tempted to import it: `@/lib/env` validates server secrets the moment it
 * loads and throws in the browser. Server code reads this and passes the result
 * down as a prop.
 */
export function isTestEnvironment(): boolean {
  return appEnv() !== "production";
}
