/**
 * Verifies the public/staff hostname split enforced by src/proxy.ts: staff
 * surfaces answer only on STAFF_BASE_URL, customer surfaces only on
 * APP_BASE_URL, and the two paths that must ignore the split — the Cashfree
 * webhook and Render's health check — stay reachable.
 *
 * The split is opt-in: with STAFF_BASE_URL unset the proxy gates nothing, so
 * this script asserts that single-host behaviour instead and exits clean.
 *
 * Requests are sent to the running server with an explicit Host header rather
 * than to two real hostnames, so this works against one local dev server
 * without any DNS setup.
 *
 * Usage: npm run verify:hosts   (dev server must be running)
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { env } from "@/lib/env";
import { assertNotProduction } from "./lib/guard";

const ORIGIN = env.APP_BASE_URL;
const PUBLIC_HOST = new URL(env.APP_BASE_URL).host;
const STAFF_HOST = env.STAFF_BASE_URL ? new URL(env.STAFF_BASE_URL).host : null;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Sends `path` to the running server while claiming to be `host`.
 *
 * This uses node:http rather than fetch on purpose: `Host` is a forbidden
 * header name, so undici silently drops it and every request would arrive
 * claiming the real connection host — making the split look broken in one
 * direction and absent in the other.
 */
function visit(host: string, path: string): Promise<number> {
  const target = new URL(path, ORIGIN);
  const secure = target.protocol === "https:";
  const send = secure ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (secure ? 443 : 80),
        path: target.pathname + target.search,
        method: "GET",
        headers: { host },
        // Over TLS the certificate is for the claimed host, not the dialled one.
        ...(secure ? { servername: host.split(":")[0] } : {}),
      },
      (res) => {
        // Drain the body so the socket is released between checks.
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const STAFF_PATHS = ["/login", "/staff", "/counter", "/admin", "/scanner"];
// "/" is deliberately absent: it is served on BOTH hosts — the customer home on
// the public one, the staff launcher on the staff one — and is checked on its own.
const PUBLIC_PATHS = ["/book", "/ticket"];

/** Like `visit`, but keeps the body and headers — the marking checks need both. */
function fetchFull(
  host: string,
  path: string,
): Promise<{ status: number; body: string; headers: Record<string, string | string[] | undefined> }> {
  const target = new URL(path, ORIGIN);
  const secure = target.protocol === "https:";
  const send = secure ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = send(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (secure ? 443 : 80),
        path: target.pathname + target.search,
        method: "GET",
        headers: { host },
        ...(secure ? { servername: host.split(":")[0] } : {}),
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  assertNotProduction("run the host-split checks");
  if (!STAFF_HOST) {
    console.log("STAFF_BASE_URL is not set — single-host mode.\n");
    console.log("1. Every path answers on the one host");
    for (const path of [...STAFF_PATHS, ...PUBLIC_PATHS]) {
      const status = await visit(PUBLIC_HOST, path);
      check(`${path} is not 404`, status !== 404, `${status}`);
    }
    console.log(
      failures === 0
        ? "\nSingle-host mode intact — proxy gates nothing.\n"
        : `\n${failures} check(s) FAILED.\n`,
    );
    if (failures > 0) process.exitCode = 1;
    return;
  }

  console.log(`Split hosts: public=${PUBLIC_HOST} staff=${STAFF_HOST}\n`);

  // ---------------------------------------------------------------------
  console.log("1. Staff paths are hidden from the public host");
  for (const path of STAFF_PATHS) {
    const status = await visit(PUBLIC_HOST, path);
    check(`${path} 404s on the public host`, status === 404, `${status}`);
  }

  // ---------------------------------------------------------------------
  console.log("\n2. Staff paths answer on the staff host");
  for (const path of STAFF_PATHS) {
    const status = await visit(STAFF_HOST, path);
    // Signed out, these redirect to /login rather than render — either way the
    // point is that the proxy did not swallow them.
    check(`${path} is not 404 on the staff host`, status !== 404, `${status}`);
  }

  // ---------------------------------------------------------------------
  console.log("\n3. Customer paths are absent from the staff host");
  for (const path of PUBLIC_PATHS) {
    const status = await visit(STAFF_HOST, path);
    check(`${path} 404s on the staff host`, status === 404, `${status}`);
  }

  // ---------------------------------------------------------------------
  console.log("\n4. Customer paths answer on the public host");
  for (const path of PUBLIC_PATHS) {
    const status = await visit(PUBLIC_HOST, path);
    check(`${path} is not 404 on the public host`, status !== 404, `${status}`);
  }

  // ---------------------------------------------------------------------
  console.log("\n5. The scanner API follows the scanner page onto the staff host");
  // The scanner fetches these with relative URLs and the app sets no CORS
  // headers, so they must share the scanner page's origin.
  check(
    "/api/scanner/sync 404s on the public host",
    (await visit(PUBLIC_HOST, "/api/scanner/sync")) === 404,
  );
  check(
    "/api/scanner/sync is not 404 on the staff host",
    (await visit(STAFF_HOST, "/api/scanner/sync")) !== 404,
  );

  // ---------------------------------------------------------------------
  console.log("\n6. The bare domain serves the right thing on each host");
  const staffRoot = await visit(STAFF_HOST, "/");
  check("/ is not 404 on the staff host", staffRoot !== 404, `${staffRoot}`);
  const publicRoot = await visit(PUBLIC_HOST, "/");
  check("/ is not 404 on the public host", publicRoot !== 404, `${publicRoot}`);
  // The launcher is reachable at its own path too, so the staff header can link
  // to it without depending on the rewrite.
  const staffPath = await visit(STAFF_HOST, "/staff");
  check("/staff is not 404 on the staff host", staffPath !== 404, `${staffPath}`);
  const staffPathPublic = await visit(PUBLIC_HOST, "/staff");
  check("/staff 404s on the public host", staffPathPublic === 404, `${staffPathPublic}`);

  // ---------------------------------------------------------------------
  console.log("\n7. The health check answers on every hostname");
  // Render health-checks the service through its own custom domain, which for
  // this app is the staff domain. Gating /api/health by host 404s that check
  // and the deploy hangs forever waiting for a 200 — this is a real failure
  // that reached Render, not a hypothetical.
  for (const [label, host] of [
    ["staff host", STAFF_HOST],
    ["public host", PUBLIC_HOST],
    ["Render internal host", "lion-safari-web.onrender.com"],
    // Render forwards to the app on an internal port, so the Host header can
    // carry one. A staff hostname with a port must still read as the staff host.
    ["staff host with a port", `${STAFF_HOST.split(":")[0]}:10000`],
  ] as const) {
    const status = await visit(host, "/api/health");
    check(`/api/health answers on the ${label}`, status === 200, `${status}`);
  }

  // ---------------------------------------------------------------------
  console.log("\n8. A forwarded port does not change how a host is classified");
  const staffPathPortedHost = await visit(`${STAFF_HOST.split(":")[0]}:10000`, "/login");
  check(
    "/login is not 404 on the staff hostname with a port",
    staffPathPortedHost !== 404,
    `${staffPathPortedHost}`,
  );

  // ---------------------------------------------------------------------
  console.log("\n9. Paths that must ignore the split still answer");
  // Cashfree posts to the public host; a 404 here would silently drop payment
  // confirmations, so this is the check that matters most in this file.
  const webhook = await visit(PUBLIC_HOST, "/api/payments/webhook/cashfree");
  check("Cashfree webhook is reachable on the public host", webhook !== 404, `${webhook}`);
  // ---------------------------------------------------------------------
  console.log("\nA non-production deployment says so, everywhere it can");
  // The dev site exists so staff can rehearse on it, which means someone will
  // eventually take a sale on it and hand over a ticket. Everything else about
  // that flow is identical to production on purpose — these markings are the
  // only thing distinguishing a rehearsal from a guest paying for nothing.
  const nonProd = env.APP_ENV !== "production";
  console.log(`  (APP_ENV=${env.APP_ENV})`);

  const login = await fetchFull(STAFF_HOST ?? PUBLIC_HOST, "/login");
  const marked = login.body.includes("not valid for entry");
  check(
    nonProd ? "the sign-in screen carries the test banner" : "production shows no test banner",
    marked === nonProd,
  );

  const publicHome = await fetchFull(PUBLIC_HOST, "/");
  check(
    nonProd
      ? "so does the public site, where a real visitor could land"
      : "and the public site stays clean",
    publicHome.body.includes("not valid for entry") === nonProd,
  );

  const robots = String(login.headers["x-robots-tag"] ?? "");
  check(
    nonProd ? "and it is served noindex" : "production is not marked noindex",
    robots.includes("noindex") === nonProd,
    robots || "(no header)",
  );

  // Static, and deliberately so: the mark on the ticket has to survive PRINTING,
  // and the easiest future mistake is tidying it into `no-print` to match the
  // status badge directly below it. Screen-only, it would protect nobody — the
  // paper is what walks to the gate.
  const card = readFileSync("src/components/ticket-card.tsx", "utf8");
  const markup = card.slice(card.indexOf("ticket.isTest"), card.indexOf("Test ticket"));
  check("the ticket's test mark is not screen-only", !markup.includes("no-print"));

  console.log(
    failures === 0
      ? "\nHost split held on every check.\n"
      : `\n${failures} check(s) FAILED.\n`,
  );
  if (failures > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
