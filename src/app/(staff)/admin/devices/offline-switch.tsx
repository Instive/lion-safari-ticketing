"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { setOfflineSellingAction, type DeviceState } from "./actions";

/**
 * The park-wide offline selling switch.
 *
 * Phrased as a state plus the one action that changes it, rather than a styled
 * checkbox: a toggle that flips under the cursor gives no room to say what the
 * consequence is, and this particular consequence — tills can or cannot issue
 * tickets during an outage — is worth a sentence before it is changed.
 *
 * Deliberately says what does NOT change. The most likely misreading of an "off"
 * switch on a page full of device controls is that it stops the counter working,
 * and an admin who believes that will not touch it when they should.
 */
export function OfflineSwitch({ enabled }: { enabled: boolean }) {
  const [state, submit] = useActionState<DeviceState, FormData>(setOfflineSellingAction, {});

  return (
    <section
      className={`mb-5 rounded-xl border p-5 ${
        enabled ? "border-line bg-surface" : "border-accent/40 bg-accent/5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Offline selling</h2>
          <p className="text-muted mt-0.5 text-sm">
            {enabled ? (
              <>
                <span className="font-semibold text-foreground">On.</span> Each counter till holds
                a small book of pre-issued tickets so it can keep selling if the internet drops.
              </>
            ) : (
              <>
                <span className="font-semibold text-accent">Off.</span> Tills cannot issue tickets
                during an outage. Online counter selling is unaffected.
              </>
            )}
          </p>
        </div>

        <form action={submit} className="shrink-0">
          <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
          <Submit turningOn={!enabled} />
        </form>
      </div>

      {/*
       * The two facts that are not obvious from the switch itself, and that
       * decide whether flipping it is safe right now.
       */}
      <ul className="text-muted mt-3 space-y-1 border-t border-line pt-3 text-xs">
        <li>
          Takes effect on each till&rsquo;s next sync — within a minute for a till that is online,
          and not at all for one that is currently offline.
        </li>
        <li>
          Tickets already printed stay valid. Unsold ones are not cancelled here; they expire by
          themselves at the end of their visit date.
        </li>
      </ul>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="mt-3 text-sm text-ok">
          {state.success}
        </p>
      ) : null}
    </section>
  );
}

function Submit({ turningOn }: { turningOn: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`touch-target rounded-lg px-4 text-sm font-semibold disabled:opacity-60 ${
        turningOn
          ? "bg-brand text-white hover:bg-brand-strong"
          : "border border-danger/40 text-danger hover:bg-danger/5"
      }`}
    >
      {pending ? "Working…" : turningOn ? "Turn on" : "Turn off"}
    </button>
  );
}
