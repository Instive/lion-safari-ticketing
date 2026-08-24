"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";

import { formatPaise } from "@/lib/money";
import { createCashSaleAction, type CashSaleState } from "./actions";
import { OfflineStatus } from "./offline-status";
import { OfflineTicket, type OfflineTicketData } from "./offline-ticket";
import { useOfflineCounter } from "./use-offline-counter";

const DRAFT_KEY_STORAGE = "ls_counter_draft_key";

// sessionStorage is an external system read through useSyncExternalStore
// rather than copied into state during an effect — the same pattern already
// used for the scanner's device-key store. Nothing outside this component
// writes the key while it's mounted, so a no-op subscribe (never notifies) is
// correct: we only need a synchronous, hydration-safe read, not live updates.
function noopSubscribe(): () => void {
  return () => {};
}

export type CounterRate = {
  id: string;
  name: string;
  perVisitorPaise: number;
};

type Props = {
  perVisitorPaise: number;
  maxVisitors: number;
  /** Concession rates an admin has defined. Empty is fine — standard only. */
  rates: CounterRate[];
  /** Recorded against a sale made offline, so a shift still has an owner. */
  staffId: string;
  /**
   * Minted on the server when this screen was rendered. A double-tapped
   * "Cash received" sends the same key twice and yields one booking; starting
   * a new sale renders a new screen and therefore a new key.
   *
   * The narrower gap this doesn't cover on its own: if the network drops
   * between the server committing the sale and the redirect reaching the
   * browser, staff sees an ambiguous failure — and reloading `/counter` to
   * retry re-runs this Server Component, minting a genuinely NEW key, so the
   * retry would create a second booking for the same cash. `sessionStorage`
   * below closes that gap by surviving the reload; the ticket confirmation
   * page clears it once a sale actually succeeds (see clear-draft-sale-key).
   */
  idempotencyKey: string;
};

/** How long a sale is allowed to hang before offering an explicit way out. */
const STUCK_AFTER_MS = 10_000;

function clamp(count: number, maxVisitors: number): number {
  return Math.min(maxVisitors, Math.max(1, count));
}

/** Quick-pick counts. Anything larger is reached with the +/− stepper. */
const QUICK_COUNTS = Array.from({ length: 10 }, (_, i) => i + 1);

/**
 * On a genuinely degraded connection (packets trickling, not a hard
 * disconnect), the request to the server can hang far longer than a normal
 * failure would take to report itself — and while `pending` is true the
 * submit button is disabled by React itself, so staff would otherwise be
 * stuck staring at "Creating ticket…" with no error and no way to retry.
 * This is a real, on-brand risk here, not a hypothetical: the same patchy
 * 4G/Wi-Fi that motivated the scanner's offline design can just as easily
 * sit under the counter terminal.
 *
 * A full reload is the deliberate fix rather than trying to cancel and retry
 * the in-flight request: it's guaranteed to abandon whatever's hanging, and
 * the sessionStorage-persisted idempotency key above makes a reload-and-retry
 * safe rather than risking a duplicate sale.
 */
function ConfirmButtons({
  total,
  visitors,
  ready,
  countReady,
}: {
  total: string;
  visitors: number;
  ready: boolean;
  /** Distinguishes "no count yet" from "count fine, special price unfinished". */
  countReady: boolean;
}) {
  // `data` is the FormData of the submission in flight, which is how the
  // pressed button is known: both buttons submit the same form, and only the
  // one that was actually tapped contributes its name/value.
  const { pending, data } = useFormStatus();
  const submitting = pending ? (data?.get("tender") as string | null) : null;

  // Set only from the timeout callback below (an async, external-event
  // response — the pattern the purity rule itself calls out as correct), and
  // deliberately never reset elsewhere: a successful sale redirects away and
  // unmounts this component, so there's no realistic path where a stale
  // `true` from a finished submission is still visible for a fresh one — the
  // render condition below also checks `pending`, which hides it immediately
  // whenever a request isn't in flight.
  const [stuck, setStuck] = useState(false);

  // Starts the "is this hanging?" timer for THIS pending cycle — syncing
  // with an external timer is exactly what an effect is for; clearing it on
  // a fast/normal completion is the cleanup, not a synchronous setState.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <>
      {/* The amount sits above both buttons rather than inside either. With two
          ways to pay, repeating it on each one implies the price depends on
          which is chosen. */}
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-0.5">
        <span className="text-muted text-sm font-medium">
          {ready
            ? `${visitors} visitor${visitors === 1 ? "" : "s"}`
            : countReady
              ? "Finish the special price"
              : "Enter the visitor count"}
        </span>
        <span className="text-2xl font-bold tabular-nums">{total}</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <TenderButton
          tender="CASH"
          label="Cash received"
          tone="bg-ok"
          disabled={pending || !ready}
          submitting={submitting === "CASH"}
        />
        <TenderButton
          tender="UPI"
          label="UPI received"
          tone="bg-upi"
          disabled={pending || !ready}
          submitting={submitting === "UPI"}
        />
      </div>

      {pending && stuck ? (
        <div className="mt-3 rounded-lg border border-accent/30 bg-accent/5 p-3 text-center">
          <p className="text-sm font-medium text-accent">
            This is taking longer than usual — check the connection.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="touch-target mt-2 rounded-lg border border-accent px-4 text-sm font-semibold text-accent"
          >
            Reload and try again
          </button>
          <p className="text-muted mt-1 text-xs">
            Safe to do — this sale won&rsquo;t be duplicated if it already went through.
          </p>
        </div>
      ) : null}
    </>
  );
}

/**
 * One way of taking the money.
 *
 * A submit button carrying its own `name`/`value`, so which tender was chosen
 * is decided by the tap itself and posted with the sale. Nothing has to be
 * held in state beforehand and there is no way for a stored selection to drift
 * out of step with the button staff actually pressed.
 */
function TenderButton({
  tender,
  label,
  tone,
  disabled,
  submitting,
}: {
  tender: "CASH" | "UPI";
  label: string;
  tone: string;
  disabled: boolean;
  submitting: boolean;
}) {
  return (
    <button
      type="submit"
      name="tender"
      value={tender}
      disabled={disabled}
      className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-xl px-3 py-4 text-white transition-colors hover:brightness-95 disabled:opacity-60 ${tone}`}
    >
      <span className="text-base font-bold leading-tight">
        {submitting ? "Creating ticket…" : label}
      </span>
      {submitting ? (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      ) : null}
    </button>
  );
}

export function CounterForm({
  perVisitorPaise,
  maxVisitors,
  rates,
  staffId,
  idempotencyKey,
}: Props) {
  const [state, formAction] = useActionState<CashSaleState, FormData>(createCashSaleAction, {});
  const counter = useOfflineCounter();
  /** The ticket just sold from the local book, held until staff moves on. */
  const [offlineTicket, setOfflineTicket] = useState<OfflineTicketData | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  /** Read once at sale time for the optional guest fields, which stay uncontrolled. */
  const formRef = useRef<HTMLFormElement>(null);
  /** Tracks an offline spell, so reconnecting can refresh a possibly-stale page. */
  const wasOfflineRef = useRef(false);
  const router = useRouter();
  /**
   * The count as typed, not as a number: it is the single source of truth for
   * the quick-pick buttons, the stepper and the box staff can type into, and
   * keeping it as text is what lets the box be cleared mid-edit without the
   * form silently falling back to some other count.
   */
  const [countText, setCountText] = useState("1");
  /** "STANDARD", a rate category id, or "CUSTOM". */
  const [rateKey, setRateKey] = useState("STANDARD");
  const [customRupees, setCustomRupees] = useState("");
  const [rateNote, setRateNote] = useState("");

  // Server snapshot matches the SSR-rendered hidden input (no hydration
  // mismatch). Client snapshot prefers an unfinished-draft key already in
  // sessionStorage from a previous load of this same tab — see the Props
  // comment above for why — falling back to the fresh server-minted one.
  const draftKey = useSyncExternalStore(
    noopSubscribe,
    () => sessionStorage.getItem(DRAFT_KEY_STORAGE) ?? idempotencyKey,
    () => idempotencyKey,
  );

  // Persists the key so a reload finds it — pure sync-to-external-system,
  // no React state written here.
  useEffect(() => {
    if (!sessionStorage.getItem(DRAFT_KEY_STORAGE)) {
      sessionStorage.setItem(DRAFT_KEY_STORAGE, idempotencyKey);
    }
  }, [idempotencyKey]);

  /*
   * Once the link returns, pull a fresh page.
   *
   * While offline the service worker may have served this screen from cache, so
   * everything the server rendered into it is from some earlier moment: the
   * shift totals, the rate buttons, and — the one that could actually cost
   * money — the idempotency key, which on a cached page may be one that has
   * already been spent. Refreshing before the next online sale replaces all
   * three. Never mid-sale: an open ticket is not interrupted.
   */
  useEffect(() => {
    if (!counter.online) {
      wasOfflineRef.current = true;
      return;
    }
    if (wasOfflineRef.current && !offlineTicket) {
      wasOfflineRef.current = false;
      router.refresh();
    }
  }, [counter.online, offlineTicket, router]);

  const selectedRate = rates.find((rate) => rate.id === rateKey) ?? null;
  const isCustom = rateKey === "CUSTOM";
  const customPaise = Math.round(Number(customRupees) * 100);
  // The note is optional: only the price decides whether this sale can go
  // through. `customRupees` is checked as a non-empty string so a blank field
  // is not read as a free ticket.
  const customValid =
    customRupees.trim() !== "" &&
    Number.isInteger(customPaise) &&
    customPaise >= 0 &&
    customPaise <= perVisitorPaise;

  // What one visitor costs under the current selection. The server re-derives
  // this from the rate row rather than trusting it; this is display only.
  const effectivePerVisitor = isCustom
    ? customPaise
    : (selectedRate?.perVisitorPaise ?? perVisitorPaise);

  const parsed = Number.parseInt(countText, 10);
  const countReady = Number.isInteger(parsed) && parsed >= 1 && parsed <= maxVisitors;
  const ready = countReady && (!isCustom || customValid);
  // An unreadable box prices nothing and confirms nothing — the button below
  // stays disabled rather than guessing a count for money that's changing hands.
  const visitors = countReady ? parsed : 0;
  const totalPaise = visitors * effectivePerVisitor;
  const total = formatPaise(totalPaise);

  function pick(next: number) {
    setCountText(String(clamp(next, maxVisitors)));
  }

  /**
   * The offline path. Takes a pre-issued ticket of the right size out of the
   * local book, queues the sale, and shows the ticket to print.
   *
   * The amount printed here is computed locally, and the server recomputes it
   * from the same rate and count when the sale reconciles — they agree unless
   * an admin re-prices a category in between, in which case the server's figure
   * is the one that counts. Reconciliation is authoritative; paper is a receipt.
   */
  async function sellOffline(tender: "CASH" | "UPI") {
    setOfflineError(null);
    if (!ready) return;

    const data = formRef.current ? new FormData(formRef.current) : null;
    const text = (field: string) => {
      const value = data?.get(field);
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };

    const sold = await counter.sell({
      visitorCount: visitors,
      perVisitorPaise: effectivePerVisitor,
      amountTotal: totalPaise,
      rateCategoryId: selectedRate?.id ?? null,
      customRatePaise: isCustom ? customPaise : null,
      rateNote: isCustom ? (rateNote.trim() || null) : null,
      tender,
      customerName: text("customerName"),
      customerPhone: text("customerPhone"),
      staffId,
    });

    if (!sold) {
      setOfflineError(
        `No pre-issued ticket left for ${visitors} visitor${visitors === 1 ? "" : "s"}. ` +
          "Split the group across two tickets, or wait for the connection.",
      );
      return;
    }

    setOfflineTicket({
      bookingCode: sold.blank.bookingCode,
      token: sold.blank.token,
      visitorCount: sold.blank.visitorCount,
      visitDate: sold.blank.visitDate,
      amountTotal: totalPaise,
      issuedAt: sold.issuedAt,
      customerName: text("customerName"),
    });
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-5">
      <OfflineStatus counter={counter} />

      <input type="hidden" name="visitorCount" value={visitors} />
      <input type="hidden" name="idempotencyKey" value={draftKey} />
      {/* The form posts which rate, not what it costs. */}
      <input
        type="hidden"
        name="rateKind"
        value={isCustom ? "CUSTOM" : selectedRate ? "CATEGORY" : "STANDARD"}
      />
      {selectedRate ? (
        <input type="hidden" name="rateCategoryId" value={selectedRate.id} />
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">How many visitors?</h2>
          <span className="text-muted text-xs">Tap, step or type</span>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {QUICK_COUNTS.map((n) => {
            const selected = visitors === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => pick(n)}
                aria-pressed={selected}
                className={`rounded-xl border py-5 text-xl font-bold tabular-nums transition-colors ${
                  selected
                    ? "border-brand bg-brand text-white ring-2 ring-brand/25"
                    : "border-line bg-background hover:border-brand"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>

        {/* Larger groups are typed straight into the box rather than tapped up
            to one at a time. */}
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-background px-3 py-2">
          <button
            type="button"
            onClick={() => pick(visitors - 1)}
            disabled={visitors <= 1}
            className="touch-target w-16 shrink-0 rounded-xl border border-line bg-surface text-2xl font-bold disabled:opacity-40"
            aria-label="One fewer visitor"
          >
            −
          </button>
          <span className="text-center leading-tight">
            <input
              id="visitor-count"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={countText}
              onChange={(event) => setCountText(event.target.value)}
              onFocus={(event) => event.target.select()}
              aria-label="Number of visitors"
              // Native spinners would sit right next to the −/+ buttons and do the same job.
              className="w-28 rounded-lg border border-line bg-surface px-2 py-1 text-center text-3xl font-bold tabular-nums outline-none [appearance:textfield] focus:border-brand [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-muted mt-0.5 block text-xs">
              {ready ? `visitor${visitors === 1 ? "" : "s"}` : "enter a number"}
            </span>
          </span>
          <button
            type="button"
            onClick={() => pick(visitors + 1)}
            disabled={!ready || visitors >= maxVisitors}
            className="touch-target w-16 shrink-0 rounded-xl border border-line bg-surface text-2xl font-bold disabled:opacity-40"
            aria-label="One more visitor"
          >
            +
          </button>
        </div>
      </section>

      {rates.length > 0 || true ? (
        <section className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Price</h2>
            {effectivePerVisitor !== perVisitorPaise ? (
              <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-accent">
                Special rate
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <RateChip
              selected={rateKey === "STANDARD"}
              onClick={() => setRateKey("STANDARD")}
              title="Standard"
              price={formatPaise(perVisitorPaise)}
            />
            {rates.map((rate) => (
              <RateChip
                key={rate.id}
                selected={rateKey === rate.id}
                onClick={() => setRateKey(rate.id)}
                title={rate.name}
                price={formatPaise(rate.perVisitorPaise)}
              />
            ))}
            <RateChip
              selected={isCustom}
              onClick={() => setRateKey("CUSTOM")}
              title="Other price"
              price="Enter"
            />
          </div>

          {isCustom ? (
            <div className="mt-3 space-y-2 rounded-lg bg-background p-3">
              <label htmlFor="custom-rate" className="text-muted block text-xs font-medium">
                Price per visitor (₹) — cannot be more than the standard{" "}
                {formatPaise(perVisitorPaise)}
              </label>
              <input
                id="custom-rate"
                name="customRateRupees"
                type="number"
                inputMode="decimal"
                min={0}
                max={perVisitorPaise / 100}
                step="1"
                value={customRupees}
                onChange={(event) => setCustomRupees(event.target.value)}
                placeholder="50"
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xl font-bold tabular-nums outline-none focus:border-brand"
              />
              <label htmlFor="rate-note" className="text-muted block text-xs font-medium">
                Who is this for? <span className="font-normal">(optional — kept against the sale)</span>
              </label>
              <input
                id="rate-note"
                name="rateNote"
                value={rateNote}
                onChange={(event) => setRateNote(event.target.value)}
                placeholder="e.g. Govt. school group, letter shown"
                maxLength={200}
                className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              />
              {!customValid && customRupees !== "" ? (
                <p className="text-xs text-accent">
                  {customPaise > perVisitorPaise
                    ? `A special price cannot be more than ${formatPaise(perVisitorPaise)}.`
                    : "Enter a price of zero or more."}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-muted text-sm tabular-nums">
            {countReady
              ? `${visitors} × ${formatPaise(effectivePerVisitor)}`
              : `${formatPaise(effectivePerVisitor)} per visitor`}
          </span>
          <span className="text-3xl font-bold tabular-nums">{countReady ? total : "—"}</span>
        </div>
        {effectivePerVisitor !== perVisitorPaise && countReady ? (
          <p className="text-muted mt-1 text-right text-xs">
            {formatPaise(visitors * (perVisitorPaise - effectivePerVisitor))} less than standard
          </p>
        ) : null}
      </section>

      <details className="rounded-xl border border-line bg-surface p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Add guest name or phone (optional)
        </summary>
        <div className="mt-3 space-y-3">
          <input
            name="customerName"
            placeholder="Guest name"
            maxLength={120}
            className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <input
            name="customerPhone"
            placeholder="Phone number"
            inputMode="tel"
            maxLength={20}
            className="touch-target w-full rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <p className="text-muted text-xs">
            Recording a phone number lets the counter find this ticket again if the guest loses it.
          </p>
        </div>
      </details>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}

      {offlineError ? (
        <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
          {offlineError}
        </p>
      ) : null}

      {/* Pinned to the bottom of the screen: the confirm action stays reachable
          however far the page has been scrolled, on a short counter display. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-background/95 px-4 pb-4 pt-3 backdrop-blur">
        {counter.online ? (
          <ConfirmButtons
            total={total}
            visitors={visitors}
            ready={ready}
            countReady={countReady}
          />
        ) : (
          /*
           * Offline, these are plain buttons rather than submits: the server
           * action behind the form cannot run, and letting the form submit would
           * hang the sale instead of issuing a ticket from the book.
           */
          <OfflineConfirmButtons
            total={total}
            visitors={visitors}
            ready={ready && counter.enrolled && counter.ready}
            reason={
              !counter.enrolled
                ? "Offline selling is not set up on this till"
                : !counter.ready
                  ? "Ticket book not loaded yet"
                  : !countReady
                    ? "Enter the visitor count"
                    : "Finish the special price"
            }
            onSell={(tender) => void sellOffline(tender)}
          />
        )}
        <p className="text-muted mt-2 text-center text-xs">
          Take the money before confirming. The ticket prints on the next screen.
        </p>
      </div>

      {offlineTicket ? (
        <OfflineTicket
          ticket={offlineTicket}
          onDone={() => {
            setOfflineTicket(null);
            setCountText("1");
            setRateKey("STANDARD");
            setCustomRupees("");
            setRateNote("");
            formRef.current?.reset();
          }}
        />
      ) : null}
    </form>
  );
}

/**
 * The offline twin of ConfirmButtons — no form submission, no pending state.
 *
 * Both tenders stay available during an outage. UPI does not need this app to
 * work: the guest scans the park's own QR and shows staff the confirmation on
 * their phone, exactly as they would if the till were a cash box. Hiding the
 * option offline would turn a working payment method off for no reason.
 */
function OfflineConfirmButtons({
  total,
  visitors,
  ready,
  reason,
  onSell,
}: {
  total: string;
  visitors: number;
  ready: boolean;
  reason: string;
  onSell: (tender: "CASH" | "UPI") => void;
}) {
  const [working, setWorking] = useState(false);

  function sell(tender: "CASH" | "UPI") {
    setWorking(true);
    onSell(tender);
    // Re-enabled once the overlay is dismissed and this remounts; the guard
    // exists only to swallow a double-tap on a slow tablet.
    setTimeout(() => setWorking(false), 1200);
  }

  return (
    <>
      <div className="mb-2.5 flex items-baseline justify-between gap-3 px-0.5">
        <span className="text-muted text-sm font-medium">
          {ready ? `${visitors} visitor${visitors === 1 ? "" : "s"} · offline` : reason}
        </span>
        <span className="text-2xl font-bold tabular-nums">{total}</span>
      </div>

      {/*
        The same two colours as online, deliberately: staff should learn one
        mapping of colour to tender, not two. Being offline is said in words on
        each button instead — alongside the banner above the form and the
        "sold offline" note on the ticket that follows, which are the signals
        that actually carry that state.
      */}
      <div className="grid grid-cols-2 gap-2.5">
        <OfflineTenderButton
          label="Cash received"
          tone="bg-ok"
          disabled={!ready || working}
          onClick={() => sell("CASH")}
        />
        <OfflineTenderButton
          label="UPI received"
          tone="bg-upi"
          disabled={!ready || working}
          onClick={() => sell("UPI")}
        />
      </div>
    </>
  );
}

function RateChip({
  selected,
  onClick,
  title,
  price,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  price: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-xl border px-3 py-2 text-left transition-colors ${
        selected ? "border-brand bg-brand text-white" : "border-line bg-background hover:border-brand"
      }`}
    >
      <span className="block text-sm font-semibold">{title}</span>
      <span className={`block text-xs tabular-nums ${selected ? "text-white/80" : "text-muted"}`}>
        {price}
      </span>
    </button>
  );
}

function OfflineTenderButton({
  label,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  tone: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-[4.5rem] flex-col items-center justify-center gap-1 rounded-xl px-3 py-4 text-white transition-colors hover:brightness-95 disabled:opacity-60 ${tone}`}
    >
      <span className="text-base font-bold leading-tight">{label}</span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/85">
        Offline
      </span>
    </button>
  );
}
