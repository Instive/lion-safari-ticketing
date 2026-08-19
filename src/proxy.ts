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
 * Paths that belong to staff operations. `/api/scanner` is included because the
 * scanner page fetches it with relative URLs and the app sets no CORS headers,
 * so page and API must be served from the same origin.
 *
 * `/api/payments/webhook/cashfree` is deliberately absent: Cashfree posts to the
 * public host, and `/api/health` must answer on Render's internal hostname.
 */
const STAFF_PREFIXES = ["/login", "/counter", "/admin", "/scanner", "/api/scanner"];

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
  ? new URL(process.env.STAFF_BASE_URL).host
  : null;

function isStaffPath(pathname: string): boolean {
  return STAFF_PREFIXES.some(
    // The `/` guard stops `/administrivia` from matching `/admin`.
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  if (!STAFF_HOST) return NextResponse.next();

  // Both are compared including any port, so `staff.localhost:3000` works locally.
  const onStaffHost = (request.headers.get("host") ?? "") === STAFF_HOST;
  if (onStaffHost === isStaffPath(request.nextUrl.pathname)) return NextResponse.next();

  // Rewriting to a path with no route renders `app/not-found.tsx` with a 404,
  // which is what a human typing the wrong hostname should see.
  return NextResponse.rewrite(new URL("/__wrong-host", request.url));
}

export const config = {
  // Without the exclusions the proxy would also gate CSS, JS and images, so a
  // customer page served on the public host would load without its assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|svg|ico)$).*)"],
};
