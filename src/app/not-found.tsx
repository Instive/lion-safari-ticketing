export const metadata = { title: "Page not found — Chhatbir Zoo" };

/**
 * Rendered both for genuinely missing routes and, via `src/proxy.ts`, for a path
 * requested on the wrong hostname.
 *
 * It lives at the root so it inherits no section chrome — a staff path requested
 * on the public host must not render staff navigation. It also links nowhere on
 * purpose: the two hosts serve disjoint paths, so no single link is valid from
 * both, and reading the origin from `env` here would force `next build` to have
 * real configuration present.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16 text-center">
      <h1 className="font-display text-5xl tracking-wide text-brand">Not Found</h1>
      <p className="text-muted mt-3 text-sm">
        This page does not exist at this address. Check the link and try again.
      </p>
    </main>
  );
}
