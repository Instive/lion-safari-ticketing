"use client";

import { useEffect, useRef } from "react";

/**
 * Fades a section up the first time it scrolls into view, then stops observing.
 *
 * The server renders the section plainly visible and this effect is what opts
 * it into the animation (`data-shown="false"`, then `"true"` on intersection),
 * so the page still reads correctly with JavaScript disabled or when the
 * visitor has asked for reduced motion.
 */
export function Reveal({
  children,
  className = "",
  delayMs = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delayMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    el.dataset.shown = "false";

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            el.dataset.shown = "true";
            observer.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
      className={`reveal ${className}`}
    >
      {children}
    </div>
  );
}
