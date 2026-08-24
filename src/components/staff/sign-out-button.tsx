"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { signOutAction } from "@/lib/auth/sign-out";

function ConfirmSignOut() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Yes"}
    </button>
  );
}

/**
 * Sign out, but not by accident.
 *
 * This button sits in the header of every staff screen, a few pixels from links
 * staff use all shift. Ending a session mid-queue costs a re-login and whatever
 * was half-entered on screen, so it asks once — the same two-step the gate
 * scanner has always used (`src/app/scanner/sign-out-bar.tsx`) and the same one
 * that cancels a ticket.
 *
 * The question opens as a panel rather than expanding inline, so a tight header
 * does not reflow around it and shift the links either side mid-tap.
 */
export function SignOutButton({ name }: { name: string }) {
  const [confirming, setConfirming] = useState(false);
  const declineRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    // Focus the harmless option: a keyboard user who opened this by mistake
    // gets out with Enter, and Escape works from anywhere.
    declineRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-expanded={confirming}
        className="rounded-lg border border-line px-3 py-1.5 hover:bg-background"
      >
        Sign out
      </button>

      {confirming ? (
        <>
          {/* A tap anywhere else means "no" — which is what a mis-tap on the
              button itself almost always meant too. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setConfirming(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="dialog"
            aria-label="Confirm sign out"
            className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-line bg-surface p-3 text-left shadow-lg"
          >
            <p className="text-sm font-semibold">Sign out of {name}?</p>
            <p className="text-muted mt-0.5 text-xs">
              A sale you have not confirmed yet will be cleared.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                ref={declineRef}
                type="button"
                onClick={() => setConfirming(false)}
                className="flex-1 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-background"
              >
                No
              </button>
              <form action={signOutAction} className="flex-1">
                <ConfirmSignOut />
              </form>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
