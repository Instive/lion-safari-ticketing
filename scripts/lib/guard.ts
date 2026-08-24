import { env } from "@/lib/env";

/**
 * The line between "a script that rewrites a database" and the live one.
 *
 * Everything under `scripts/` runs with `--env-file=.env.local` — one file, one
 * name, edited in place whenever you point at a different database. That is a
 * fine way to work and a terrible thing to leave unguarded: `db:seed` creates
 * staff logins with default passwords, and the verify suite writes hundreds of
 * bookings, cancels them, allocates ticket books and boards tickets. Run either
 * against production once and the damage is real and immediate.
 *
 * So a destructive script refuses unless the environment has explicitly said it
 * is not production. `APP_ENV` defaults to `production`, which means a missing
 * or mistyped value fails closed.
 */
export function assertNotProduction(task: string): void {
  const target = describeDatabase(env.DATABASE_URL);

  if (env.APP_ENV === "production") {
    console.error(
      `\nRefusing to ${task}.\n\n` +
        `  Target database : ${target}\n` +
        `  APP_ENV         : production\n\n` +
        `This script rewrites data, so it only runs where APP_ENV says the\n` +
        `environment is not production. If this really is a laptop or the dev\n` +
        `site, set APP_ENV=local (or APP_ENV=dev) in .env.local and re-run.\n` +
        `\nIf APP_ENV is simply unset, it defaults to production — deliberately,\n` +
        `so that forgetting it can never be the reason the live database is\n` +
        `overwritten.\n`,
    );
    process.exit(1);
  }

  // Printed even when allowed. Most of the risk here is not "the guard failed",
  // it is "I did not notice which database that just went to".
  console.log(`${task} → ${target}  (APP_ENV=${env.APP_ENV})\n`);
}

/**
 * Host and database name only. The connection string carries a password, and
 * this gets printed to a terminal, pasted into issues and captured in CI logs.
 */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "") || "(default)";
    return `${name} on ${parsed.hostname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}
