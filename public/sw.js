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

const VERSION = "ls-v2";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

/** The paths worth keeping usable offline. Admin deliberately is not one. */
const OFFLINE_PATHS = ["/counter", "/scanner"];

/**
 * Fetched up front rather than on demand, because these are only ever needed at
 * the exact moment there is no network: they are the artwork on a ticket being
 * printed during an outage. Everything else here can be cached lazily, but a
 * ticket has to be right the first time it is ever printed.
 */
const PRECACHE = ["/ticket-lion.png", "/ticket-deer.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSET_CACHE);
      // Never let one missing file abort the install and leave the gate
      // without a worker at all.
      await Promise.allSettled(PRECACHE.map((path) => cache.add(path)));
      // Take over as soon as possible: a half-updated worker on a gate device
      // is worse than a brief double-install.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
      await warmShell();
    })(),
  );
});

/**
 * Fetch the offline screens, and everything they load, now — while there is
 * still a connection.
 *
 * A worker only sees requests it controls, and it controls nothing on the visit
 * that installs it: the HTML and every chunk for that first load were fetched
 * before this file existed. So without warming, a freshly set-up till caches
 * nothing, and the first reload during an outage — the exact moment the worker
 * exists for — finds an empty cache. The alternative is asking staff to reload
 * once, while online, before the offline shell is real. Nobody would ever know
 * to do that, and there would be no sign anything was wrong until a queue was
 * already forming.
 */
async function warmShell() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);

  await Promise.allSettled(
    OFFLINE_PATHS.map(async (path) => {
      // `same-origin` credentials so the staff session cookie rides along —
      // both screens are behind a login, and an anonymous fetch would only ever
      // get the redirect that `isCacheableShell` throws away.
      const response = await fetch(path, { credentials: "same-origin", cache: "reload" });
      if (!isCacheableShell(response)) return;

      const html = await response.clone().text();
      await shell.put(path, response);
      await Promise.allSettled(assetUrlsIn(html).map((url) => addIfMissing(assets, url)));
    }),
  );
}

/**
 * The fingerprinted chunks, stylesheets and fonts a page pulls in, read out of
 * its own HTML.
 *
 * Next.js renames these on every build, so a hand-maintained precache list would
 * be silently wrong after the next deploy — cached under names nothing asks for
 * any more. The page as served is the only manifest that is always accurate.
 */
function assetUrlsIn(html) {
  // Trailing backslashes and quotes appear because these URLs also occur inside
  // the escaped JSON of the streamed RSC payload.
  return [...new Set(html.match(/\/_next\/static\/[^"'\\\s)]+/g) ?? [])];
}

async function addIfMissing(cache, url) {
  if (await cache.match(url)) return;
  await cache.add(url);
}

/**
 * Whether a response is genuinely the page that was asked for.
 *
 * A redirect is not. An expired staff session turns `/counter` into the login
 * screen — a perfectly successful 200 — and a counter device warming `/scanner`
 * gets bounced the same way. Caching either would leave a till showing a login
 * form during an outage, with no network to log in against and no way past it.
 */
function isCacheableShell(response) {
  return (
    response.ok &&
    !response.redirected &&
    (response.headers.get("content-type") ?? "").includes("text/html")
  );
}

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

/**
 * `ignoreVary` throughout, on purpose. Next.js serves pages with
 * `Vary: rsc, next-router-state-tree, …` and assets with `Vary: Accept-Encoding`,
 * and the Cache API honours those by default — so an entry stored by a warm
 * fetch can fail to match the byte-identical request a real navigation makes.
 * Safe here because each cache is keyed by URL and only ever holds one kind of
 * thing: whole HTML pages in the shell, fingerprinted files in the assets.
 */
const MATCH = { ignoreVary: true };

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, MATCH);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
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
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (isCacheableShell(response)) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, MATCH);
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
