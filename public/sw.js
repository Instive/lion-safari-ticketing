/*
 * Service worker for the two screens that must survive an outage: the ticket
 * counter and the gate scanner.
 *
 * Without this, "offline" only means "the tab that is already open keeps
 * working". One accidental reload, one tablet sleeping and waking, and staff
 * are looking at the browser's dinosaur while a queue forms.
 *
 * Deliberately hand-written and small rather than a generated Workbox bundle:
 * this file decides what a gate can and cannot do during an outage, and that is
 * worth being able to read in one sitting.
 */

const VERSION = "ls-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/** The paths worth keeping usable offline. Admin deliberately is not one. */
const OFFLINE_PATHS = ["/counter", "/scanner"];

self.addEventListener("install", (event) => {
  // Take over as soon as possible: a half-updated worker on a gate device is
  // worse than a brief double-install.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

function isOfflinePath(url) {
  return OFFLINE_PATHS.some((path) => url.pathname === path || url.pathname.startsWith(`${path}/`));
}

/**
 * Next.js fingerprints everything under /_next/static, so a hit is always the
 * right build and can be served from cache without checking.
 */
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".jpeg") ||
    url.pathname.endsWith(".jpg") ||
    url.pathname.endsWith(".svg")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /*
   * Never cache the API. Every one of these endpoints is either money moving or
   * a ticket being judged, and a stale answer is worse than an honest failure —
   * the counter and scanner both have their own offline queues for exactly this.
   */
  if (url.pathname.startsWith("/api/")) return;

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (request.mode === "navigate" && isOfflinePath(url)) {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Fresh when we can, last-known-good when we cannot.
 *
 * The cached page is server-rendered HTML from an earlier load, so anything on
 * it that came from the database — shift totals, rate buttons — may be stale.
 * That is acceptable because the offline sale path does not trust any of it:
 * tickets come from the local book and the price is recomputed on the server at
 * reconciliation. The counter also refreshes itself once the link returns.
 */
async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
       <title>Offline</title>
       <body style="font-family:system-ui;background:#0a0a0a;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">
         <div>
           <h1 style="font-size:1.25rem">No connection</h1>
           <p style="color:#a3a3a3;max-width:22rem;line-height:1.6">
             This screen has not been opened on this device yet, so there is nothing saved to work
             from. Reconnect once, and it will keep working offline after that.
           </p>
         </div>
       </body>`,
      { headers: { "content-type": "text/html; charset=utf-8" }, status: 503 },
    );
  }
}
