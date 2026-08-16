"use client";

import { useState } from "react";

import { primeAudio } from "@/lib/scanner/feedback";

/**
 * One-time device enrolment. The key is issued in the admin portal and shown
 * once; it is what authorises this terminal to sync and to record boardings.
 * Deactivating the device in admin locks it out on the next sync.
 */
export function Enrolment({ onEnrolled }: { onEnrolled: (key: string) => void }) {
  const [key, setKey] = useState("");

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-neutral-950 p-6 text-white">
      <h1 className="text-2xl font-bold">Set up this scanner</h1>
      <p className="mt-2 text-neutral-400">
        Enter the device key from the admin portal. You only need to do this once.
      </p>

      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          // Unlock audio from this real user gesture so scan sounds work later.
          primeAudio();
          onEnrolled(key);
        }}
      >
        <input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Device key"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-4 py-5 font-mono text-base outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          className="w-full rounded-xl bg-emerald-600 px-6 py-5 text-xl font-bold disabled:opacity-50"
          disabled={!key.trim()}
        >
          Activate scanner
        </button>
      </form>
    </div>
  );
}
