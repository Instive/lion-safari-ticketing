"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { findByToken, getMeta, scannerDb, type CachedTicket } from "@/lib/scanner/db";
import { judge, type ScanOutcome } from "@/lib/scanner/judge";
import {
  clearDeviceKey,
  DeviceUnauthorizedError,
  getDeviceKey,
  getDeviceKeyServerSnapshot,
  getOnlineServerSnapshot,
  getOnlineSnapshot,
  recordBoardingLocally,
  runSync,
  setDeviceKey,
  subscribeDeviceKey,
  subscribeOnline,
} from "@/lib/scanner/sync-client";
import { feedbackAccepted, feedbackRejected, feedbackScanned, primeAudio } from "@/lib/scanner/feedback";
import { Enrolment } from "./enrolment";
import { useCamera } from "./use-camera";
import { useWakeLock } from "./use-wake-lock";
import { SignOutBar } from "./sign-out-bar";
import { SyncBanner } from "./sync-banner";

const SYNC_INTERVAL_MS = 20_000;

export function ScannerApp({ staffName, staffRole }: { staffName: string; staffRole: string }) {
  // Device key and connectivity are external state, read through a store so
  // render stays pure and hydration cannot mismatch.
  const deviceKey = useSyncExternalStore(
    subscribeDeviceKey,
    getDeviceKey,
    getDeviceKeyServerSnapshot,
  );
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot);
  const enrolled = deviceKey !== null;

  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [boarded, setBoarded] = useState<CachedTicket | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [staleThreshold, setStaleThreshold] = useState(300);
  const [queueDepth, setQueueDepth] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  // Held in a ref so the scan callback never acts on a stale value.
  const busyRef = useRef(false);
  /**
   * True while a result is on screen. The camera keeps running behind the
   * overlay — stopping and restarting it between guests is far slower than
   * leaving it live — so this is what stops the same QR, still held in front of
   * the lens, from replacing the verdict staff are in the middle of reading.
   */
  const showingResultRef = useRef(false);

  // --- sync loop -----------------------------------------------------------
  const sync = useCallback(async () => {
    if (!getDeviceKey()) return;
    try {
      const state = await runSync();
      setLastSyncAt(state.lastSyncAt);
      setStaleThreshold(state.staleThresholdSeconds);
      setQueueDepth(state.queueDepth);
    } catch (err) {
      if (err instanceof DeviceUnauthorizedError) {
        // The device was deactivated in admin — the stored key is worthless, so
        // drop it and fall back to the enrolment screen.
        clearDeviceKey();
      }
      // Any other failure is left visible through the staleness banner rather
      // than being announced as an error the staff member cannot act on.
      setQueueDepth(await scannerDb.queue.count());
    }
  }, []);

  useEffect(() => {
    if (!enrolled) return;
    // Kick off the first sync on the next tick rather than inside the effect
    // body, then keep it running on the interval.
    const kickoff = setTimeout(() => void sync(), 0);
    const id = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [enrolled, sync]);

  // --- scanning ------------------------------------------------------------
  const handleScan = useCallback(async (token: string) => {
    if (busyRef.current || showingResultRef.current) return;
    busyRef.current = true;
    feedbackScanned();

    try {
      const local = await findByToken(token);

      if (local) {
        const verdict = judge(local, (await getMeta()).visitDate);
        showingResultRef.current = true;
        setOutcome(verdict);
        if (verdict.kind === "VALID") feedbackAccepted();
        else feedbackRejected();
        return;
      }

      // Unknown locally. If we are online this may simply be a booking made
      // since the last sync, so ask the server.
      if (navigator.onLine) {
        const res = await fetch("/api/scanner/lookup", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-device-key": getDeviceKey() ?? "",
          },
          body: JSON.stringify({ token }),
        });

        if (res.ok) {
          const body = (await res.json()) as {
            valid: boolean;
            message: string | null;
            ticket: CachedTicket | null;
          };

          if (body.valid && body.ticket) {
            const ticket: CachedTicket = { ...body.ticket, tokenHash: "", usedAt: null };
            await scannerDb.tickets.put({ ...ticket, tokenHash: await hashOf(token) });
            showingResultRef.current = true;
            setOutcome({ kind: "VALID", ticket });
            feedbackAccepted();
            return;
          }

          showingResultRef.current = true;
          setOutcome({
            kind: "REJECTED",
            message: body.message ?? "This ticket cannot be used.",
            ticket: body.ticket,
          });
          feedbackRejected();
          return;
        }
      }

      // Offline and unrecognised. Never assume valid (spec §7.2).
      showingResultRef.current = true;
      setOutcome({ kind: "UNKNOWN_OFFLINE" });
      feedbackRejected();
    } finally {
      // Brief lockout so one QR in front of the lens is not read repeatedly.
      setTimeout(() => {
        busyRef.current = false;
      }, 1200);
    }
  }, []);

  const camera = useCamera(videoRef, handleScan, enrolled);

  // The screen must not sleep while the gate is open.
  useWakeLock(enrolled);

  // Connectivity returning is the moment the queued boardings can be pushed;
  // waiting up to a full sync interval to notice would leave the banner showing
  // a backlog that has actually cleared.
  useEffect(() => {
    if (!enrolled || !online) return;
    // Deferred a tick for the same reason as the kickoff above: the effect body
    // itself must stay free of state updates.
    const id = setTimeout(() => void sync(), 0);
    return () => clearTimeout(id);
  }, [enrolled, online, sync]);

  // iOS keeps the audio context suspended until a real user gesture, so the
  // first scan of a shift would otherwise be silent — the one beep staff most
  // need to hear. Any touch anywhere on the scanner unlocks it.
  useEffect(() => {
    if (!enrolled) return;
    const prime = () => primeAudio();
    document.addEventListener("pointerdown", prime, { once: true });
    return () => document.removeEventListener("pointerdown", prime);
  }, [enrolled]);

  // --- boarding ------------------------------------------------------------
  const confirmBoarding = useCallback(
    async (ticket: CachedTicket) => {
      primeAudio();
      await recordBoardingLocally({
        ticketId: ticket.ticketId,
        boardedCount: ticket.visitorCount,
        online: navigator.onLine,
      });
      setBoarded(ticket);
      showingResultRef.current = false;
      setOutcome(null);
      setQueueDepth(await scannerDb.queue.count());
      // Push straight away when possible; otherwise the next sync drains it.
      void sync();
      setTimeout(() => setBoarded(null), 2500);
    },
    [sync],
  );

  const dismissResult = useCallback(() => {
    showingResultRef.current = false;
    setOutcome(null);
  }, []);

  if (!enrolled) {
    // The sign-out bar belongs here too: someone who signs in on the wrong
    // device would otherwise be stuck on the enrolment screen with no way back.
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden bg-neutral-950 text-white">
        <Enrolment onEnrolled={(key) => setDeviceKey(key)} />
        <SignOutBar name={staffName} role={staffRole} />
      </div>
    );
  }

  return (
    /*
     * `fixed inset-0` rather than a `min-h-dvh` flex column. This screen is a
     * kiosk: it must fill the viewport exactly, and taking it out of flow means
     * no ancestor's height — the staff shell, the body, the mobile URL bar
     * collapsing — can leave the camera short.
     */
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-neutral-950 text-white">
      <SyncBanner
        lastSyncAt={lastSyncAt}
        staleThresholdSeconds={staleThreshold}
        queueDepth={queueDepth}
        online={online}
      />

      {/* min-h-0 lets this shrink inside the column instead of being forced to
          its content height, which is what pushes the rest off-screen. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/*
         * Absolutely positioned, NOT `h-full`. A percentage height resolves
         * against a definite parent height, and a flex child's height is not
         * definite on every engine — where it isn't, the video falls back to
         * its intrinsic 4:3 size and fills only a band of a portrait screen.
         * `inset-0` sidesteps the question entirely.
         */}
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover"
          muted
          playsInline
          disablePictureInPicture
        />

        {camera.status === "starting" && !outcome && !boarded ? (
          <div className="absolute inset-0 grid place-items-center bg-neutral-950/80">
            <p className="text-lg text-neutral-300">Starting camera…</p>
          </div>
        ) : null}

        {camera.fault ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-neutral-950/95 p-6 text-center">
            <p className="text-5xl" aria-hidden>
              📷
            </p>
            <p className="text-xl font-bold">{camera.fault.title}</p>
            <p className="max-w-sm text-neutral-300">{camera.fault.detail}</p>
            {camera.fault.retryable ? (
              <button
                type="button"
                onClick={camera.restart}
                className="mt-2 rounded-2xl bg-white px-8 py-4 text-lg font-bold text-neutral-900"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Camera controls sit over the picture, out of the way of the scan
            region but reachable with a thumb on a mounted tablet. */}
        {camera.status === "running" && !outcome && !boarded ? (
          <div className="absolute right-3 top-3 flex flex-col gap-2">
            {camera.hasFlash ? (
              <button
                type="button"
                onClick={camera.toggleFlash}
                aria-pressed={camera.flashOn}
                className={`grid h-14 w-14 place-items-center rounded-full border text-2xl ${
                  camera.flashOn
                    ? "border-amber-300 bg-amber-300 text-neutral-900"
                    : "border-white/30 bg-black/40 text-white"
                }`}
              >
                <span aria-hidden>🔦</span>
                <span className="sr-only">
                  {camera.flashOn ? "Turn torch off" : "Turn torch on"}
                </span>
              </button>
            ) : null}

            {camera.cameras.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  const index = camera.cameras.findIndex((c) => c.id === camera.activeCameraId);
                  const next = camera.cameras[(index + 1) % camera.cameras.length];
                  if (next) camera.selectCamera(next.id);
                }}
                className="grid h-14 w-14 place-items-center rounded-full border border-white/30 bg-black/40 text-2xl text-white"
              >
                <span aria-hidden>🔄</span>
                <span className="sr-only">Switch camera</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {outcome ? (
          <ResultOverlay
            outcome={outcome}
            onConfirm={confirmBoarding}
            onDismiss={dismissResult}
          />
        ) : null}

        {boarded ? (
          <div className="absolute inset-0 grid place-items-center bg-emerald-600 p-6 text-center">
            <div>
              <p className="text-6xl" aria-hidden>
                ✓
              </p>
              <p className="mt-3 text-3xl font-bold">BOARDED</p>
              <p className="mt-1 text-xl">
                {boarded.visitorCount} visitor{boarded.visitorCount === 1 ? "" : "s"}
              </p>
              <p className="mt-2 font-mono text-sm opacity-80">{boarded.bookingCode}</p>
            </div>
          </div>
        ) : null}
      </div>

      {!outcome && !boarded ? (
        <p className="shrink-0 bg-neutral-900 px-4 py-4 text-center text-lg">
          Hold the guest&apos;s QR code in front of the camera
        </p>
      ) : null}

      <SignOutBar name={staffName} role={staffRole} />
    </div>
  );
}

async function hashOf(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ResultOverlay({
  outcome,
  onConfirm,
  onDismiss,
}: {
  outcome: ScanOutcome;
  onConfirm: (ticket: CachedTicket) => void;
  onDismiss: () => void;
}) {
  if (outcome.kind === "VALID") {
    return (
      <div className="absolute inset-0 flex flex-col bg-emerald-700 p-5 text-center">
        <div className="flex flex-1 flex-col items-center justify-center">
          <p className="text-5xl" aria-hidden>
            ✓
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-wide">VALID TICKET</p>

          {/* The number staff must physically count before letting the group on. */}
          <p className="mt-6 text-8xl font-black leading-none tabular-nums">
            {outcome.ticket.visitorCount}
          </p>
          <p className="mt-1 text-2xl font-medium">
            VISITOR{outcome.ticket.visitorCount === 1 ? "" : "S"}
          </p>

          <p className="mt-4 font-mono text-sm opacity-80">{outcome.ticket.bookingCode}</p>
          <p className="mt-6 text-base opacity-90">Count the group, then confirm.</p>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            onClick={() => onConfirm(outcome.ticket)}
            className="w-full rounded-2xl bg-white px-6 py-6 text-2xl font-bold text-emerald-800"
          >
            Confirm boarding
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-2xl border border-white/40 px-6 py-4 text-lg"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  const isUnknownOffline = outcome.kind === "UNKNOWN_OFFLINE";

  return (
    <div className="absolute inset-0 flex flex-col bg-red-800 p-5 text-center">
      <div className="flex flex-1 flex-col items-center justify-center">
        <p className="text-5xl" aria-hidden>
          ✕
        </p>
        <p className="mt-3 text-3xl font-black tracking-wide">
          {isUnknownOffline ? "NOT RECOGNISED" : outcome.message}
        </p>
        <p className="mt-4 max-w-sm text-lg opacity-95">
          {isUnknownOffline
            ? "This device is offline and does not know this ticket. It may be a new booking — send the guest to the counter, or wait for the connection to return."
            : outcome.detail}
        </p>
        {!isUnknownOffline && outcome.ticket ? (
          <p className="mt-4 font-mono text-sm opacity-80">{outcome.ticket.bookingCode}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="w-full rounded-2xl bg-white px-6 py-6 text-2xl font-bold text-red-800"
      >
        Next guest
      </button>
    </div>
  );
}
