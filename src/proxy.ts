import { NextResponse, type NextRequest } from "next/server";

/**
 * Splits the app across two hostnames: the public site (APP_BASE_URL) and staff
 * operations (STAFF_BASE_URL). A path served on the wrong host 404s — there are
 * deliberately no cross-host redirects, so the public site never advertises that
 * a staff host exists and the staff host stays strictly operational.
 *
 * In Next.js 16 this file convention is `proxy.ts`; `middleware.ts` is the
 * deprecated name for the same thing.
 *
 * Note this is a routing boundary, not an authorization one. Every staff page
 * and action still enforces its own role check (`src/lib/auth/guards.ts`), and
 * the scanner APIs still require a device key — this only decides which surface
 * is reachable from which hostname.
 */

/**
 * Paths that belong to staff operations. `/api/scanner` and `/api/counter` are
 * included because those pages fetch them with relative URLs and the app sets no
 * CORS headers, so page and API must be served from the same origin.
 *
 * `/api/payments/webhook/cashfree` is deliberately absent: Cashfree posts to the
 * public host. `/api/health` is not listed here either — it is host-agnostic
 * infrastructure, see NEUTRAL_PREFIXES below.
 */
const STAFF_PREFIXES = [
  "/login",
  "/staff",
  "/counter",
  "/admin",
  "/scanner",
  "/api/scanner",
  "/api/counter",
];

/**
 * Infrastructure paths that must answer on EVERY hostname, whatever the split
 * says.
 *
 * `/api/health`: Render health-checks the service through its own custom domain
 * — for this app that is the staff domain — so gating it by host makes the
 * health check 404 and the deploy hangs forever waiting for a 200.
 *
 * `/sw.js` and `/manifest.webmanifest`: the offline service worker and the
 * install manifest are static files in `public/`, so they look like ordinary
 * paths to the rules below and would be rewritten to `/__wrong-host` on the
 * staff domain. `navigator.serviceWorker.register()` then fails on the 404's
 * `text/html`, and the counter and scanner silently lose the ability to survive
 * a reload during an outage — the tab already open keeps working, so nothing
 * looks broken until the one moment it matters. The static assets they cache
 * (`.png`, `.svg`, `/_next/static`) are already exempt via `config.matcher`;
 * these two are the ones the pattern misses.
 */
const NEUTRAL_PREFIXES = ["/api/health", "/sw.js", "/manifest.webmanifest"];

/**
 * Read from `process.env` rather than `@/lib/env` on purpose — the proxy runs in
 * a constrained runtime, and pulling in the zod schema module would drag the
 * whole server-side config (including secrets) into it.
 *
 * An unset STAFF_BASE_URL means "single host": the proxy gates nothing and every
 * path stays reachable, which is how local development and the pre-split
 * deployment keep working.
 */
const STAFF_HOST = process.env.STAFF_BASE_URL
  ? new URL(process.env.STAFF_BASE_URL).hostname
  : null;

/**
 * Read straight from `process.env` for the same reason as above — the proxy
 * runtime must not pull in the zod schema and everything it validates.
 *
 * Anything that is not production gets `X-Robots-Tag: noindex`. A dev site
 * carries the park's name, its prices and a working booking form; indexed, it
 * would eventually put a search result in front of a real visitor that takes
 * their money for a ticket nobody will honour.
 */
const IS_PRODUCTION = (process.env.APP_ENV ?? "production") === "production";

/** Adds the noindex header to whatever response the routing rules produced. */
function marked(response: NextResponse): NextResponse {
  if (!IS_PRODUCTION) response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

/**
 * Hostname only, never host:port. Render terminates TLS and forwards the
 * request to the app on an internal port, so the Host header can arrive as
 * `staff.example.com:10000`; comparing with the port attached would classify
 * that as the public host and 404 every staff page in production.
 */
function hostnameOf(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0]!.toLowerCase();
}

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    // The `/` guard stops `/administrivia` from matching `/admin`.
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  if (!STAFF_HOST) return marked(NextResponse.next());

  const { pathname } = request.nextUrl;
  if (matches(pathname, NEUTRAL_PREFIXES)) return marked(NextResponse.next());

  const onStaffHost = hostnameOf(request) === STAFF_HOST;

  // The bare staff domain shows the staff launcher rather than 404ing. A
  // rewrite (not a redirect) keeps the address bar on the domain the person
  // typed, while `/` on the public host still serves the customer home.
  if (onStaffHost && pathname === "/") {
    return marked(NextResponse.rewrite(new URL("/staff", request.url)));
  }

  if (onStaffHost === matches(pathname, STAFF_PREFIXES)) return marked(NextResponse.next());

  // Rewriting to a path with no route renders `app/not-found.tsx` with a 404,
  // which is what a human typing the wrong hostname should see.
  return marked(NextResponse.rewrite(new URL("/__wrong-host", request.url)));
}

export const config = {
  // Without the exclusions the proxy would also gate CSS, JS and images, so a
  // customer page served on the public host would load without its assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|svg|ico)$).*)"],
};
