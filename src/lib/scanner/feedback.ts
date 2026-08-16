"use client";

/**
 * Scan feedback for a noisy outdoor gate.
 *
 * Accept and reject are distinguishable by SOUND (rising vs low buzz), by
 * VIBRATION pattern, and on screen by icon and words — never by colour alone
 * (spec §17).
 */
let audioContext: AudioContext | null = null;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  // iOS suspends the context until a user gesture resumes it.
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}

function tone(frequency: number, durationMs: number, startOffsetMs = 0, volume = 0.25): void {
  const context = ctx();
  if (!context) return;

  const osc = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + startOffsetMs / 1000;

  osc.type = "square";
  osc.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);

  osc.connect(gain);
  gain.connect(context.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000);
}

/** Neutral click the instant a QR is read, before it has been judged. */
export function feedbackScanned(): void {
  tone(880, 60, 0, 0.15);
  navigator.vibrate?.(30);
}

/** Rising two-tone chime: this group may board. */
export function feedbackAccepted(): void {
  tone(660, 110);
  tone(990, 160, 110);
  navigator.vibrate?.([60, 40, 120]);
}

/** Low double buzz: turn this guest away. */
export function feedbackRejected(): void {
  tone(200, 220, 0, 0.3);
  tone(160, 300, 240, 0.3);
  navigator.vibrate?.([200, 80, 200]);
}

/** Wakes the audio context from a real user gesture (iOS requirement). */
export function primeAudio(): void {
  const context = ctx();
  if (context?.state === "suspended") void context.resume();
}
