/**
 * Exists only so `scripts/verify-guards.ts` can observe environment validation
 * actually running, in a real process.
 *
 * `src/lib/env.ts` validates lazily and caches once per process, so the only
 * honest way to test several configurations is several processes — the same
 * reason `guard-probe.ts` exists next door.
 *
 * Touches nothing but the environment. Exit 0 means the configuration was
 * accepted, exit 1 means it was refused; the refusal text goes to stderr so the
 * caller can assert on which variable was named.
 */
import { env } from "@/lib/env";

try {
  // Any property access triggers the whole schema, including the refinements.
  void env.CASHFREE_ENV;
  console.log("env: accepted");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
