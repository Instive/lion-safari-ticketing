/**
 * Exists only so `scripts/verify-guards.ts` can observe the guard's real
 * behaviour.
 *
 * The guard's answer depends on `APP_ENV`, which `src/lib/env.ts` reads and
 * caches once per process — so the only honest way to test all four cases
 * (production / dev / local / unset) is four processes. This is what they run.
 *
 * It touches nothing. Exit 0 means the guard allowed the run, exit 1 means it
 * refused.
 */
import { assertNotProduction } from "./guard";

assertNotProduction("run the guard probe");
