/**
 * Verifies the one thing standing between the dev tooling and the live park.
 *
 * Everything under `scripts/` runs with `--env-file=.env.local`: a single file,
 * edited in place whenever you point at a different database. `db:seed` creates
 * staff logins with known passwords; the verify suite writes hundreds of
 * bookings, cancels them, allocates ticket books and boards tickets. Pointed at
 * production even once, that is not a test run, it is an incident.
 *
 * So this checks both halves of the guard: that it refuses when it should, and
 * that every script actually asks it.
 *
 * Usage: npm run verify:guards   (no dev server needed)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assertNotProduction } from "./lib/guard";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

const PROBE = "scripts/lib/guard-probe.ts";

/**
 * Runs the probe in its own process with `APP_ENV` set to `appEnv`, or with the
 * variable absent entirely when `appEnv` is null.
 *
 * The env file is rebuilt rather than reusing `.env.local` directly, because the
 * "unset" case has to be genuinely unset — not overridden — and that is the case
 * the whole default hinges on.
 */
function runProbe(appEnv: string | null): { code: number; output: string } {
  const base = readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((line) => !line.startsWith("APP_ENV"))
    .join("\n");

  const dir = mkdtempSync(join(tmpdir(), "ls-guard-"));
  const file = join(dir, "env");
  writeFileSync(file, appEnv === null ? base : `${base}\nAPP_ENV=${appEnv}\n`);

  const result = spawnSync("npx", ["tsx", `--env-file=${file}`, PROBE], {
    encoding: "utf8",
    env: { ...process.env, APP_ENV: undefined } as NodeJS.ProcessEnv,
  });

  return { code: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function main() {
  assertNotProduction("run the guard checks");
  console.log("Testing the production guard\n");

  // -----------------------------------------------------------------------
  console.log("1. The guard refuses production and allows everything else");
  const prod = runProbe("production");
  check("APP_ENV=production is refused", prod.code === 1, `exit ${prod.code}`);
  check(
    "and the refusal names the database it was about to touch",
    /Target database\s*:/.test(prod.output),
  );
  check(
    "without leaking the password from DATABASE_URL",
    !prod.output.includes("://") || !/:\/\/[^@\s]*:[^@\s]*@/.test(prod.output),
  );

  for (const allowed of ["dev", "local"]) {
    const run = runProbe(allowed);
    check(`APP_ENV=${allowed} is allowed`, run.code === 0, `exit ${run.code}`);
    check(
      `and it still says where ${allowed} pointed`,
      run.output.includes(`APP_ENV=${allowed}`),
    );
  }

  // -----------------------------------------------------------------------
  console.log("\n2. A missing APP_ENV fails safe");
  // The entire design rests on this: the variable defaults to `production`, so
  // a fresh clone, a forgotten dashboard entry or a typo all land on "refuse"
  // rather than on "rewrite the live database".
  const unset = runProbe(null);
  check("no APP_ENV at all is refused", unset.code === 1, `exit ${unset.code}`);
  check("and it is reported as production", /APP_ENV\s*:\s*production/.test(unset.output));

  // -----------------------------------------------------------------------
  console.log("\n3. Every destructive script actually asks the guard");
  // A guard one script forgot is not a guard, and the failure would be silent:
  // that script would simply work against production, exactly as before.
  const scripts = readdirSync("scripts")
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => name.startsWith("seed") || name.startsWith("verify-"));

  check("there are scripts to check", scripts.length >= 10, `${scripts.length} found`);

  const unguarded = scripts.filter(
    (name) => !readFileSync(join("scripts", name), "utf8").includes("assertNotProduction("),
  );
  check(
    "all of them call assertNotProduction",
    unguarded.length === 0,
    unguarded.length ? unguarded.join(", ") : `${scripts.length} scripts`,
  );

  console.log(
    failures === 0
      ? "\nThe production guard held.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
