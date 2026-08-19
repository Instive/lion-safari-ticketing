"use client";

import { useEffect, useSyncExternalStore } from "react";

const SCALES = [100, 112, 125] as const;
type Scale = (typeof SCALES)[number];
const STORAGE_KEY = "zoo:text-scale";

/*
 * The chosen text size lives in localStorage, which is external state rather
 * than React state: it must survive navigation between pages and be shared by
 * every copy of this bar. It is read through useSyncExternalStore so the
 * server can render the default (100%) and the client can correct to the
 * remembered value on hydration without a mismatch.
 */
const listeners = new Set<() => void>();
let cached: Scale | null = null;

function isScale(value: number): value is Scale {
  return (SCALES as readonly number[]).includes(value);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): Scale {
  if (cached === null) {
    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    cached = isScale(stored) ? stored : 100;
  }
  return cached;
}

function getServerSnapshot(): Scale {
  return 100;
}

function writeScale(next: Scale) {
  cached = next;
  window.localStorage.setItem(STORAGE_KEY, String(next));
  for (const listener of listeners) listener();
}

/**
 * The utility strip that sits above the masthead on an official portal: the
 * owning department on the left, and the accessibility controls (skip link +
 * text resizing) that public-sector guidelines expect on the right.
 *
 * Text resizing works by scaling the root font size, which every measurement
 * on the public site is expressed in, so the whole layout grows with the text
 * rather than only the body copy.
 */
export function GovUtilityBar() {
  const scale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    document.documentElement.style.fontSize = scale === 100 ? "" : `${scale}%`;
  }, [scale]);

  const step = (direction: -1 | 1) => {
    const index = SCALES.indexOf(scale) + direction;
    writeScale(SCALES[Math.min(SCALES.length - 1, Math.max(0, index))]);
  };

  return (
    <div className="bg-brand-strong text-zoo-cream/85">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-1.5 text-[11px] sm:text-xs">
        <p className="tracking-wide">
          <span className="font-semibold text-zoo-gold-light">Government of Punjab</span>
          <span className="mx-2 text-zoo-cream/40" aria-hidden>
            |
          </span>
          <span className="hidden sm:inline">
            Department of Forests &amp; Wildlife Preservation
          </span>
          <span className="sm:hidden">Forests &amp; Wildlife Preservation</span>
        </p>

        <div className="flex items-center gap-3">
          <a href="#main-content" className="hidden hover:text-zoo-gold-light sm:inline">
            Skip to main content
          </a>
          <div className="flex items-center gap-1" role="group" aria-label="Text size">
            <ScaleButton
              onClick={() => step(-1)}
              disabled={scale === SCALES[0]}
              label="Decrease text size"
            >
              A<span className="text-[0.7em]">−</span>
            </ScaleButton>
            <ScaleButton
              onClick={() => writeScale(100)}
              disabled={scale === 100}
              label="Reset text size"
            >
              A
            </ScaleButton>
            <ScaleButton
              onClick={() => step(1)}
              disabled={scale === SCALES[SCALES.length - 1]}
              label="Increase text size"
            >
              A<span className="text-[0.7em]">+</span>
            </ScaleButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScaleButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="grid h-6 min-w-6 place-items-center rounded border border-zoo-cream/25 px-1 leading-none transition-colors hover:border-zoo-gold-light hover:text-zoo-gold-light disabled:opacity-40 disabled:hover:border-zoo-cream/25 disabled:hover:text-zoo-cream/85"
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden>{children}</span>
    </button>
  );
}
