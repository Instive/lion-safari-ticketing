"use client";

import { useState } from "react";

/**
 * The scrolling notices strip that public-sector portals carry under the
 * masthead. Content comes from the server (the ticket price in it is the same
 * server-side figure the booking form charges), so this component only owns
 * the motion — and the pause control that WCAG 2.2.2 requires for anything
 * that moves for more than five seconds.
 */
export function AnnouncementTicker({ notices }: { notices: string[] }) {
  const [paused, setPaused] = useState(false);

  if (notices.length === 0) return null;

  return (
    <aside
      aria-label="Latest notices"
      className="border-b border-zoo-cream-strong bg-zoo-cream"
    >
      <div className="mx-auto flex max-w-6xl items-stretch gap-0 px-0 sm:px-4">
        <p className="grid shrink-0 place-items-center bg-brand px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-white sm:rounded-b-md sm:px-4">
          Notices
        </p>

        <div className="ticker-viewport relative flex-1 overflow-hidden py-2">
          <div className="ticker-track gap-0" data-paused={paused}>
            {[0, 1].map((copy) => (
              <ul
                key={copy}
                aria-hidden={copy === 1}
                className="flex shrink-0 items-center"
              >
                {notices.map((notice, i) => (
                  <li
                    key={`${copy}-${i}`}
                    className="flex items-center whitespace-nowrap text-sm text-zoo-ink/85"
                  >
                    <span className="mx-3 text-accent" aria-hidden>
                      ◆
                    </span>
                    {notice}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPaused((v) => !v)}
          aria-pressed={paused}
          className="grid w-10 shrink-0 place-items-center text-zoo-ink/60 transition-colors hover:text-brand"
          title={paused ? "Resume notices" : "Pause notices"}
        >
          <span className="sr-only">{paused ? "Resume notices" : "Pause notices"}</span>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
            {paused ? <path d="M8 5v14l11-7z" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />}
          </svg>
        </button>
      </div>
    </aside>
  );
}
