/**
 * Preflight check for Cashfree credentials.
 *
 * Run this before trying an online booking — it tells you in one line whether
 * the keys in .env.local actually work, instead of leaving you to guess from
 * the customer-facing "could not start your booking" message.
 *
 * Usage: npm run verify:cashfree
 */
import { randomUUID } from "node:crypto";

import { env, paymentsConfigured } from "@/lib/env";
import { pool } from "@/db";

const PLACEHOLDERS = [/^$/, /TEST_APP_ID/i, /test_secret_key/i, /replace|changeme|dummy/i];

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDERS.some((p) => p.test(value));
}

function line(ok: boolean, text: string) {
  console.log(`  [${ok ? "OK " : "!! "}] ${text}`);
}

async function main() {
  console.log(`\nCashfree preflight (${env.CASHFREE_ENV})\n`);

  let blocked = false;

  // --- 1. Are the values even present and real-looking? --------------------
  if (!paymentsConfigured()) {
    line(false, "CASHFREE_APP_ID / CASHFREE_SECRET_KEY are empty in .env.local");
    blocked = true;
  } else if (
    looksLikePlaceholder(env.CASHFREE_APP_ID) ||
    looksLikePlaceholder(env.CASHFREE_SECRET_KEY)
  ) {
    line(false, "Credentials still look like placeholders, not real Cashfree keys");
    blocked = true;
  } else {
    line(true, `App ID ${env.CASHFREE_APP_ID.slice(0, 6)}… present`);
  }

  if (looksLikePlaceholder(env.CASHFREE_WEBHOOK_SECRET)) {
    line(
      false,
      "CASHFREE_WEBHOOK_SECRET is a placeholder — real webhooks will be rejected as unsigned",
    );
  } else {
    line(true, "Webhook secret present");
  }

  if (blocked) {
    console.log(
      "\nGet sandbox keys from https://merchant.cashfree.com → Developers → API Keys" +
        "\n(switch the dashboard to Sandbox/Test mode first), then put them in .env.local.\n",
    );
    process.exitCode = 1;
    return;
  }

  // --- 2. Do the credentials authenticate? ---------------------------------
  // Fetching an order id that cannot exist: a 401 means the keys are wrong,
  // anything else means Cashfree accepted them.
  const base =
    env.CASHFREE_ENV === "PRODUCTION"
      ? "https://api.cashfree.com/pg"
      : "https://sandbox.cashfree.com/pg";

  const res = await fetch(`${base}/orders/preflight-${randomUUID()}`, {
    headers: {
      "x-api-version": "2026-01-01",
      "x-client-id": env.CASHFREE_APP_ID,
      "x-client-secret": env.CASHFREE_SECRET_KEY,
    },
  });

  const body = await res.text();

  if (res.status === 401 || res.status === 403) {
    line(false, `Cashfree rejected the credentials (${res.status})`);
    console.log(`\n  ${body.slice(0, 200)}`);
    console.log(
      `\nCheck that the keys are for the ${env.CASHFREE_ENV} environment — sandbox keys do not work against production, or vice versa.\n`,
    );
    process.exitCode = 1;
    return;
  }

  line(true, `Cashfree accepted the credentials (responded ${res.status} to an unknown order)`);

  // --- 3. Can Cashfree reach us for webhooks? ------------------------------
  const isLocal = /localhost|127\.0\.0\.1/.test(env.APP_BASE_URL);
  if (isLocal) {
    console.log(
      `\n  Note: APP_BASE_URL is ${env.APP_BASE_URL}, which Cashfree cannot reach.` +
        `\n  Payments will still confirm locally — the reconciliation job polls Cashfree` +
        `\n  directly — but only after RECONCILE_MIN_AGE_MINUTES (currently ${env.RECONCILE_MIN_AGE_MINUTES}m)` +
        `\n  and only while 'npm run worker' is running.` +
        `\n  For instant webhook confirmation, expose the app with a tunnel and set` +
        `\n  APP_BASE_URL to the public URL.\n`,
    );
  } else {
    console.log(
      `\n  Register this webhook URL in the Cashfree dashboard:` +
        `\n    ${env.APP_BASE_URL}/api/payments/webhook/cashfree\n`,
    );
  }

  console.log("Ready to take an online booking.\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
