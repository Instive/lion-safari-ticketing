"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import QrScanner from "qr-scanner";

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
  const [cameraError, setCameraError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  // Held in a ref so the scan callback never acts on a stale value.
  const busyRef = useRef(false);

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
    if (busyRef.current) return;
    busyRef.current = true;
    feedbackScanned();

    try {
      const local = await findByToken(token);

      if (local) {
        const verdict = judge(local, (await getMeta()).visitDate);
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
            setOutcome({ kind: "VALID", ticket });
            feedbackAccepted();
            return;
          }

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
      setOutcome({ kind: "UNKNOWN_OFFLINE" });
      feedbackRejected();
    } finally {
      // Brief lockout so one QR in front of the lens is not read repeatedly.
      setTimeout(() => {
        busyRef.current = false;
      }, 1200);
    }
  }, []);

  useEffect(() => {
    if (!enrolled || !videoRef.current) return;

    const scanner = new QrScanner(
      videoRef.current,
      (result) => void handleScan(result.data),
      {
        highlightScanRegion: true,
        highlightCodeOutline: true,
        maxScansPerSecond: 5,
        preferredCamera: "environment",
      },
    );
    scannerRef.current = scanner;

    scanner
      .start()
      .catch(() =>
        setCameraError("Camera unavailable. Check the camera permission for this app."),
      );

    return () => {
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [enrolled, handleScan]);

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
      setOutcome(null);
      setQueueDepth(await scannerDb.queue.count());
      // Push straight away when possible; otherwise the next sync drains it.
      void sync();
      setTimeout(() => setBoarded(null), 2500);
    },
    [sync],
  );

  if (!enrolled) {
    // The sign-out bar belongs here too: someone who signs in on the wrong
    // device would otherwise be stuck on the enrolment screen with no way back.
    return (
      <div className="flex min-h-dvh flex-col bg-neutral-950 text-white">
        <Enrolment onEnrolled={(key) => setDeviceKey(key)} />
        <SignOutBar name={staffName} role={staffRole} />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-950 text-white">
      <SyncBanner
        lastSyncAt={lastSyncAt}
        staleThresholdSeconds={staleThreshold}
        queueDepth={queueDepth}
        online={online}
      />

      <div className="relative flex-1">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />

        {cameraError ? (
          <div className="absolute inset-0 grid place-items-center bg-neutral-950/90 p-6 text-center">
            <p className="text-lg">{cameraError}</p>
          </div>
        ) : null}

        {outcome ? (
          <ResultOverlay
            outcome={outcome}
            onConfirm={confirmBoarding}
            onDismiss={() => setOutcome(null)}
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
        <p className="bg-neutral-900 px-4 py-4 text-center text-lg">
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
