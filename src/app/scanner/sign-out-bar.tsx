"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

import { signOutAction } from "@/lib/auth/sign-out";

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target rounded-lg bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-60"
    >
      {pending ? "Signing out…" : "Yes, sign out"}
    </button>
  );
}

/**
 * Identity and sign-out for the gate scanner.
 *
 * The scanner is outside the (staff) route group — so that it keeps its own
 * full-screen dark chrome rather than the staff nav header — which left a
 * SCANNER-role user with no way to sign out at all.
 *
 * Signing out takes two taps on purpose. This sits under a live camera on a
 * device being handled at a busy gate, and a stray tap that ended the shift
 * mid-queue would be worse than the extra tap costs.
 */
export function SignOutBar({ name, role }: { name: string; role: string }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 bg-neutral-900 px-4 py-3">
        <p className="text-sm text-neutral-300">
          Sign out of {name}?{" "}
          <span className="text-neutral-500">This scanner stays enrolled.</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="touch-target rounded-lg border border-neutral-600 px-4 text-sm font-semibold text-neutral-200"
          >
            Cancel
          </button>
          <form action={signOutAction}>
            <ConfirmButton />
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-neutral-900 px-4 py-2 text-sm text-neutral-400">
      <span className="truncate">
        {name} · {role.toLowerCase()}
      </span>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 font-semibold text-neutral-200"
      >
        Sign out
      </button>
    </div>
  );
}
