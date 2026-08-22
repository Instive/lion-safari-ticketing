"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

const CAMERA_STORAGE = "ls_scanner_camera_id";

/** How long the picture may be frozen before we assume the stream is dead. */
const STALL_TIMEOUT_MS = 6_000;
const WATCHDOG_INTERVAL_MS = 3_000;

export type CameraStatus = "starting" | "running" | "error";

export type CameraFault = {
  /** Short, actionable — this is read at a gate, by someone holding a queue. */
  title: string;
  detail: string;
  /** False when retrying cannot possibly help, e.g. the device has no camera. */
  retryable: boolean;
};

export type CameraControls = {
  status: CameraStatus;
  fault: CameraFault | null;
  restart: () => void;
  cameras: QrScanner.Camera[];
  activeCameraId: string | null;
  selectCamera: (deviceId: string) => void;
  hasFlash: boolean;
  flashOn: boolean;
  toggleFlash: () => void;
};

/**
 * getUserMedia failures are DOMExceptions whose `name` is the only reliable
 * signal. Each one needs a different action from the person at the gate, so
 * they must not collapse into one "camera unavailable".
 */
function faultFor(err: unknown): CameraFault {
  const name = err instanceof DOMException ? err.name : "";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        title: "Camera permission is blocked",
        detail:
          "Allow camera access for this site in the browser settings, then tap Try again. On a locked-down tablet this may need the device administrator.",
        retryable: true,
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        title: "No camera found",
        detail:
          "This device has no usable camera. Use another device, or check the guest's ticket at the counter.",
        retryable: false,
      };
    case "NotReadableError":
    case "AbortError":
      return {
        title: "The camera is busy",
        detail:
          "Another app is using the camera. Close it — the camera or video-call app is the usual culprit — then tap Try again.",
        retryable: true,
      };
    default:
      return {
        title: "Camera could not start",
        detail: "Tap Try again. If it keeps failing, restart the browser on this device.",
        retryable: true,
      };
  }
}

/**
 * Owns the camera for the whole life of the scanner screen.
 *
 * The gate is the one place in this system where a silent failure is expensive:
 * staff will keep holding tickets up to a frozen picture rather than conclude
 * the software is broken. So beyond starting the camera this:
 *
 *   - watches for a stalled stream (another app stealing the camera, an OS
 *     suspend, a driver hiccup) and restarts it without anyone reloading;
 *   - restarts when the tab becomes visible again, since a backgrounded tab
 *     often comes back with a dead track;
 *   - reports *why* it failed, in terms of what to do about it;
 *   - remembers which lens was chosen, because the default "environment" camera
 *     on a multi-lens Android is often the ultra-wide, which cannot focus close
 *     enough to read a phone screen.
 */
export function useCamera(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  onDecode: (value: string) => void,
  enabled: boolean,
): CameraControls {
  const scannerRef = useRef<QrScanner | null>(null);
  // The decode callback is kept in a ref, updated in an effect rather than
  // during render, so a new callback identity never tears down and restarts a
  // working camera.
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  }, [onDecode]);

  const [status, setStatus] = useState<CameraStatus>("starting");
  const [fault, setFault] = useState<CameraFault | null>(null);
  const [cameras, setCameras] = useState<QrScanner.Camera[]>([]);
  const [activeCameraId, setActiveCameraId] = useState<string | null>(null);
  const [hasFlash, setHasFlash] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  /** Bumping this re-runs the start effect from scratch. */
  const [attempt, setAttempt] = useState(0);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const selectCamera = useCallback((deviceId: string) => {
    localStorage.setItem(CAMERA_STORAGE, deviceId);
    setActiveCameraId(deviceId);
    setAttempt((n) => n + 1);
  }, []);

  const toggleFlash = useCallback(() => {
    const scanner = scannerRef.current;
    if (!scanner) return;
    void scanner
      .toggleFlash()
      .then(() => setFlashOn((on) => !on))
      .catch(() => setHasFlash(false));
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;

    let disposed = false;
    const scanner = new QrScanner(video, (result) => onDecodeRef.current(result.data), {
      highlightScanRegion: true,
      highlightCodeOutline: true,
      maxScansPerSecond: 5,
      preferredCamera: localStorage.getItem(CAMERA_STORAGE) ?? "environment",
    });
    scannerRef.current = scanner;

    // Frame progress is the only trustworthy proof the camera is alive: a
    // stalled track keeps readyState high and reports no error at all.
    let lastFrameTime = -1;
    let lastProgressAt = Date.now();

    const watchdog = window.setInterval(() => {
      if (disposed || document.visibilityState !== "visible") return;

      const current = video.currentTime;
      if (current !== lastFrameTime) {
        lastFrameTime = current;
        lastProgressAt = Date.now();
        return;
      }
      if (Date.now() - lastProgressAt > STALL_TIMEOUT_MS) {
        console.warn("[scanner] camera stalled — restarting");
        lastProgressAt = Date.now();
        void scanner.start().catch(() => {
          if (!disposed) setAttempt((n) => n + 1);
        });
      }
    }, WATCHDOG_INTERVAL_MS);

    // A track that ends on its own (another app took the camera, the OS
    // suspended it) fires no error on the scanner — only here.
    const attachTrackWatch = () => {
      const stream = video.srcObject;
      if (!(stream instanceof MediaStream)) return;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          if (!disposed) setAttempt((n) => n + 1);
        });
      }
    };

    const onVisible = () => {
      if (disposed || document.visibilityState !== "visible") return;
      lastProgressAt = Date.now();
      void scanner.start().catch(() => setAttempt((n) => n + 1));
    };

    setStatus("starting");
    setFault(null);

    scanner
      .start()
      .then(async () => {
        if (disposed) return;
        setStatus("running");
        setFault(null);
        lastProgressAt = Date.now();
        attachTrackWatch();

        try {
          const list = await QrScanner.listCameras(true);
          if (!disposed) setCameras(list);
        } catch {
          /* labels need permission; not fatal */
        }
        try {
          const flash = await scanner.hasFlash();
          if (!disposed) setHasFlash(flash);
        } catch {
          /* no flash API on this device */
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        console.error("[scanner] camera failed to start", err);
        setStatus("error");
        setFault(faultFor(err));
      });

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      disposed = true;
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisible);
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
      setFlashOn(false);
    };
  }, [enabled, videoRef, attempt]);

  return {
    status,
    fault,
    restart,
    cameras,
    activeCameraId: activeCameraId ?? cameras[0]?.id ?? null,
    selectCamera,
    hasFlash,
    flashOn,
    toggleFlash,
  };
}
