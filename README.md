# Lion Safari Ticketing

One unified ticketing system for online and counter bookings, with a QR scanner at the boarding gate that keeps working when the internet does not.

Built to the requirements in [Lion_Safari_Ticketing_Production_Requirements.txt](Lion_Safari_Ticketing_Production_Requirements.txt).

## What exists

| Surface | Route | Who |
|---|---|---|
| Customer booking | `/`, `/book` | Public, no account |
| Ticket & recovery | `/ticket/[code]`, `/ticket` | Public, rate limited |
| Cash counter | `/counter` | COUNTER staff |
| Gate scanner | `/scanner` | Device key + SCANNER staff |
| Admin | `/admin` | ADMIN only |

## Environments

There are three, and each one says which it is through `APP_ENV`:

| `APP_ENV` | Where | Notes |
|---|---|---|
| `local` | your laptop | |
| `dev` | the `dev` branch, deployed | free Render stack, own database |
| `production` | the `main` branch, deployed | the real park |

**`APP_ENV` defaults to `production` when unset, deliberately.** `db:seed`,
`db:seed:demo` and every `verify:*` script rewrite data and refuse to run unless
it says otherwise, so forgetting the variable can never be the reason the live
database is overwritten. A fresh clone therefore needs `APP_ENV=local` in
`.env.local` before the seed will run — the error message says so.

Anything that is not production announces itself: a red banner on every screen
including the public site, `X-Robots-Tag: noindex`, and **`TEST TICKET — NOT
VALID FOR ENTRY` printed on the ticket itself**. That last one is not decorative.
The dev site exists so staff can rehearse, which means someone will eventually
take a sale on it and hand a guest a piece of paper.

### Promoting dev to production

```
push to `dev`  →  Render deploys the dev stack  →  staff test it
      →  open a PR from `dev` to `main`  →  Merge   ← the deploy
      →  Render rebuilds production, running db:migrate:prod at boot
```

One caveat worth knowing rather than discovering: a migration that is instant on
a small dev database can lock a populated production table. Migration `0002`
here already needed hand-editing into add-nullable → backfill → `SET NOT NULL`
for exactly that reason. Dev proves a migration *runs*; it does not prove it runs
*quickly* against real data.

## Running it locally

```bash
# 1. Postgres — either Docker (one command, disposable) …
docker compose up -d
#    … or a local install:
#    brew install postgresql@16 && brew services start postgresql@16 && createdb lion_safari

# 2. Configure
cp .env.example .env.local
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"  # → SESSION_SECRET
#    Make sure .env.local has APP_ENV=local, or the seed will refuse to run.

# 3. Schema and data
npm install
npm run db:reset         # migrate + seed accounts + a fortnight of demo trading
#    (db:reset prints the gate device API key ONCE — copy it)

# 4. Two processes
npm run dev              # web
npm run worker           # ticket email + payment reconciliation
```

Seeded logins: `admin` / `counter` / `gate` (dev passwords are printed by the seed).
Enter the device key at `/scanner` to enrol the gate terminal.

`db:seed:demo` fills the database with about 300 bookings across two weeks —
online and counter, cash and UPI, concessions, cancellations and boardings — so
the admin screens, the day-end slip and the CSV export have something real to
show. Empty screens all look fine, which is how a broken report reaches the
counter unnoticed. It builds everything through the domain functions, so the data
obeys the same invariants production data does.

To debug against the deployed dev database from your laptop, point `DATABASE_URL`
at its external connection string and set `APP_ENV=dev`.

## Testing the online payment flow locally

Everything except online payment works with no third-party accounts at all: the counter sells tickets, the scanner boards them, admin manages them. Only `/book` needs Cashfree.

**1. Get sandbox keys.** Sign up at [merchant.cashfree.com](https://merchant.cashfree.com), switch the dashboard to **Sandbox / Test mode**, then Developers → API Keys. Put them in `.env.local`:

```bash
CASHFREE_APP_ID=<sandbox app id>
CASHFREE_SECRET_KEY=<sandbox secret key>
CASHFREE_WEBHOOK_SECRET=<same secret key — Cashfree signs with it>
```

**2. Check they work before you click anything:**

```bash
npm run verify:cashfree
```

This is the answer to "why did booking fail" — it reports missing keys, placeholder keys, keys rejected by Cashfree, and whether webhooks can reach you.

**3. Restart `npm run dev`.** Env changes are only read at startup.

### Webhooks cannot reach localhost

Cashfree calls our webhook server-to-server, so it cannot reach `http://localhost:3000`. Two options:

- **No tunnel (simplest).** Pay in sandbox, then wait: the reconciliation job polls Cashfree directly and confirms the booking. Set `RECONCILE_MIN_AGE_MINUTES=1` in `.env.local` so this takes about a minute, and **keep `npm run worker` running** — without the worker nothing confirms. The ticket page polls, so it appears on its own.
- **With a tunnel (realistic).** `cloudflared tunnel --url http://localhost:3000` (or ngrok), set `APP_BASE_URL` to the public URL, restart dev, and register `<public-url>/api/payments/webhook/cashfree` in the Cashfree dashboard under Developers → Webhooks. Bookings then confirm in seconds, exactly as in production.

Either way the booking is confirmed by verified server-side evidence — the fallback is slower, never weaker.

## Verifying it works

These scripts exercise the failure scenarios from spec §14 against a running dev server. They print what they did, so you can read the guarantees rather than trust them.

```bash
npm run verify:guards    # the production guard: dev tooling cannot touch the live database
npm run verify:domain    # idempotency: double booking, double boarding, all-or-nothing
npm run verify:webhook   # duplicate / tampered / forged / unsigned / underpaid webhooks
npm run verify:scanner   # sync, offline replay, used-ticket rejection, device lockout
npm run verify:auth      # role boundaries, forged cookie, instant revocation
npm run verify:all       # all of the above
npm run verify:cashfree  # preflight: are the payment credentials actually valid?
```

`verify:webhook` proves the payment logic without Cashfree credentials — it signs its own payloads with `CASHFREE_WEBHOOK_SECRET`. Only a real end-to-end payment needs live sandbox keys.

## How the critical paths work

**A booking is never confirmed by the browser.** The customer's return from checkout only polls our own database. A booking becomes `PAID` in exactly one place — [process.ts](src/domain/payment/process.ts) — after a signature-verified webhook whose amount matches what we recorded when the order was created.

**Nothing can happen twice.** Every idempotency rule is a database constraint, not just application logic:

| Retry that could duplicate | Constraint that prevents it |
|---|---|
| Double-submitted booking form | `bookings.idempotency_key` unique |
| Replayed payment webhook | `payment_events.provider_event_id` unique |
| Re-run ticket issuance | `tickets.booking_id` unique |
| Re-sent offline boarding event | `boarding_events.client_event_id` unique |
| Duplicate order creation | `payments.provider_order_id` unique |

**A lost webhook cannot strand a customer.** [reconcile-payments.ts](src/jobs/handlers/reconcile-payments.ts) sweeps every two minutes, asks the provider directly about stale `PENDING` orders, and feeds the answer through the same processing path as a webhook — so the amount check, idempotency and audit trail all still apply.

**The gate scanner stores no credentials.** Its offline cache holds a SHA-256 *hash* of each ticket token, never the token, and no customer name, phone or email. A stolen terminal yields nothing usable, and deactivating it in `/admin/devices` locks it out on its next sync.

**Stale data is never presented as live.** The scanner shows "synced Xs ago" continuously and switches to a full-width warning past `SYNC_STALE_THRESHOLD_SECONDS`. An unrecognised QR while offline is refused with instructions, never assumed valid.

## Swapping the payment provider

Cashfree lives entirely in [src/domain/payment/cashfree/](src/domain/payment/cashfree/). Everything else speaks only the normalized types in [provider.ts](src/domain/payment/provider.ts). To add Razorpay: implement `PaymentProvider` in a sibling folder and add it to the registry in [index.ts](src/domain/payment/index.ts). No booking, ticket or webhook logic changes.

## Layout

```
src/
├── domain/          framework-free core — the rules live here
│   ├── booking/     lifecycle, pricing, state machine, refunds
│   ├── ticket/      issuance (idempotent), invalidation
│   ├── boarding/    validation + all-or-nothing boarding
│   ├── payment/     provider interface, Cashfree adapter, webhook processing
│   ├── scanner/     incremental sync feed
│   └── audit/       append-only audit + scanner change log
├── app/
│   ├── (customer)/  public booking and ticket pages
│   ├── (staff)/     admin + counter (session + role guarded)
│   ├── scanner/     gate PWA (device-key auth, IndexedDB cache)
│   └── api/         payment webhook, scanner sync/events/lookup
├── jobs/            pg-boss handlers (delivery, reconciliation)
├── db/              Drizzle schema + migrations
└── lib/             auth, rate limiting, money, time, QR, mail
worker.ts            background worker entrypoint
```

Money is stored as integer **paise** everywhere. Dates use the park's timezone (`APP_TIMEZONE`), and server time is authoritative — the scanner's clock is recorded for audit but never trusted for validity.

## Deploying

The architecture dictates the shape: **two long-running Node processes plus managed Postgres.**

| Needs | Why |
|---|---|
| A persistent web process | The webhook needs `node:crypto` and the raw request body |
| A persistent worker process | pg-boss polls and holds a scheduler; it is not a serverless function |
| Managed Postgres with automatic backups | Spec §12 requires automated backup and tested restore |
| A region near the park | The gate scanner syncs every 20s over 4G |

This rules out a serverless-only host: `next start` and `npm run worker:prod` both need to stay running.

**Recommended: DigitalOcean App Platform + Managed Postgres, Bangalore (`blr1`).** It is the cheapest option that puts both the app and the database in India, with automated daily backups and point-in-time recovery included. Configure two components from this one repo:

| Component | Build | Run |
|---|---|---|
| Web service | `npm ci && npm run build` | `npm start` |
| Worker | `npm ci` | `npm run worker:prod` |

Give both components the same environment variables, and run `npm run db:migrate` once per release (App Platform pre-deploy job, or manually).

Alternatives, in order: **Railway** if you want the simplest setup and can accept Singapore latency; **Fly.io** for a Mumbai region, but pair it with managed Postgres from Neon or Supabase rather than Fly's unmanaged Postgres, or you own the backups yourself.

Deployment notes specific to this codebase:

- **The build needs no secrets.** Environment access is lazy, so `next build` runs in CI without a database or payment keys. Configuration is validated on first request instead — a bad value fails loudly at runtime, not silently.
- **`tsx` is a runtime dependency**, because the worker executes `worker.ts` directly. Do not move it to devDependencies or `npm ci --omit=dev` will break the worker.
- **`npm run worker:prod`** is the production worker command — unlike `npm run worker`, it does not look for `.env.local` and takes configuration from the platform.
- Set `APP_BASE_URL` to the public HTTPS URL and register `<APP_BASE_URL>/api/payments/webhook/cashfree` in the Cashfree dashboard.
- Keep `RECONCILE_MIN_AGE_MINUTES=5` in production so the webhook gets first chance.

## Before going live

- [ ] Real Cashfree credentials in `.env.local`; register the webhook URL `POST /api/payments/webhook/cashfree` in the Cashfree dashboard
- [ ] `RESEND_API_KEY` + verified sending domain, and a real `SUPPORT_PHONE`
- [ ] Change every seeded password; create per-person staff accounts
- [ ] HTTPS in front of the app; `APP_BASE_URL` set to the public URL
- [ ] Automated database backups **and a tested restore**
- [ ] Run `npm run verify:all` against staging, then one live pilot: a real payment and a real scan at the gate

### Deliberately deferred (v1 scope)

Automated test suites, Docker packaging, error monitoring, WhatsApp/SMS delivery, PDF ticket attachments, cash shift reconciliation, and multi-scanner support. Multi-scanner in particular needs server-side consumption coordination before a second gate device is deployed — two offline scanners can otherwise both approve the same ticket.
