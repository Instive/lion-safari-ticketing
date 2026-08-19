"use client";

import { useEffect, useRef } from "react";

/**
 * "At a glance" figure that counts up once, when it first scrolls into view.
 *
 * The final figure is what the server renders and what a screen reader
 * announces; the count-up is written straight to the DOM by the effect below,
 * and never runs at all for a visitor who has asked for reduced motion.
 */
export function StatCounter({
  to,
  suffix = "",
  label,
  durationMs = 1400,
}: {
  to: number;
  suffix?: string;
  label: string;
  durationMs?: number;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const out = valueRef.current;
    if (!root || !out) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const paint = (n: number) => {
      out.textContent = `${n.toLocaleString("en-IN")}${suffix}`;
    };
    paint(0);
    let frame = 0;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();

        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / durationMs);
          // Ease-out cubic: quick off the mark, settling on the real figure.
          paint(Math.round(to * (1 - Math.pow(1 - t, 3))));
          if (t < 1) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    observer.observe(root);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      paint(to);
    };
  }, [to, suffix, durationMs]);

  return (
    <div ref={rootRef} className="text-center">
      <p className="font-display text-4xl tracking-wide text-brand tabular-nums sm:text-5xl">
        <span ref={valueRef} aria-hidden>
          {to.toLocaleString("en-IN")}
          {suffix}
        </span>
        <span className="sr-only">
          {to.toLocaleString("en-IN")}
          {suffix}
        </span>
      </p>
      <p className="text-muted mt-1 text-[11px] font-medium uppercase tracking-[0.14em] sm:text-xs">
        {label}
      </p>
    </div>
  );
}
