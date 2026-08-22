"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { formatPaise } from "@/lib/money";
import {
  createRateAction,
  setRateActiveAction,
  updateRateAction,
  type RateState,
} from "./actions";

export type RateRow = {
  id: string;
  name: string;
  perVisitorPaise: number;
  active: boolean;
  soldCount: number;
};

function Submit({ label, subtle }: { label: string; subtle?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        subtle
          ? "rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-brand disabled:opacity-60"
          : "touch-target rounded-lg bg-brand px-4 font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      }
    >
      {pending ? "Working…" : label}
    </button>
  );
}

function Notice({ state }: { state: RateState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-sm text-danger">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return <p className="rounded-lg bg-ok/5 px-3 py-2 text-sm text-ok">{state.success}</p>;
  }
  return null;
}

export function RateManager({
  rates,
  standardPaise,
}: {
  rates: RateRow[];
  standardPaise: number;
}) {
  const [createState, create] = useActionState<RateState, FormData>(createRateAction, {});
  const [updateState, update] = useActionState<RateState, FormData>(updateRateAction, {});
  const [toggleState, toggle] = useActionState<RateState, FormData>(setRateActiveAction, {});

  return (
    <>
      <form action={create} className="space-y-3 rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Add a rate</h2>
        <p className="text-muted text-sm">
          Counter staff pick these by name, so the price charged always comes from here rather than
          from whoever is at the till. The standard fare is {formatPaise(standardPaise)}.
        </p>

        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto]">
          <input
            name="name"
            placeholder="e.g. School group"
            required
            minLength={2}
            maxLength={60}
            className="touch-target rounded-lg border border-line px-3 text-base outline-none focus:border-brand"
          />
          <input
            name="priceRupees"
            type="number"
            inputMode="numeric"
            min={0}
            max={standardPaise / 100}
            step="1"
            placeholder="₹ per visitor"
            required
            className="touch-target rounded-lg border border-line px-3 text-base tabular-nums outline-none focus:border-brand"
          />
          <Submit label="Add rate" />
        </div>
        <Notice state={createState} />
      </form>

      <Notice state={updateState} />
      <Notice state={toggleState} />

      <ul className="mt-5 space-y-2">
        {rates.length === 0 ? (
          <li className="text-muted rounded-xl border border-line bg-surface p-5 text-sm">
            No special rates yet. The counter sells everything at the standard fare until you add
            one.
          </li>
        ) : (
          rates.map((rate) => (
            <li
              key={rate.id}
              className={`rounded-xl border bg-surface p-4 ${
                rate.active ? "border-line" : "border-line opacity-60"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {rate.name}
                    {!rate.active ? (
                      <span className="text-muted ml-2 text-xs font-medium uppercase tracking-wide">
                        retired
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted text-sm tabular-nums">
                    {formatPaise(rate.perVisitorPaise)} per visitor ·{" "}
                    {rate.soldCount === 0
                      ? "not used yet"
                      : `${rate.soldCount} booking${rate.soldCount === 1 ? "" : "s"} sold`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <form action={update} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={rate.id} />
                    <label className="sr-only" htmlFor={`price-${rate.id}`}>
                      New price for {rate.name}
                    </label>
                    <input
                      id={`price-${rate.id}`}
                      name="priceRupees"
                      type="number"
                      min={0}
                      max={standardPaise / 100}
                      step="1"
                      defaultValue={rate.perVisitorPaise / 100}
                      className="w-24 rounded-lg border border-line px-2 py-2 text-sm tabular-nums outline-none focus:border-brand"
                    />
                    <Submit label="Re-price" subtle />
                  </form>

                  <form action={toggle}>
                    <input type="hidden" name="id" value={rate.id} />
                    <input type="hidden" name="active" value={rate.active ? "false" : "true"} />
                    <Submit label={rate.active ? "Retire" : "Restore"} subtle />
                  </form>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </>
  );
}
