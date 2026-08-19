"use client";

import { useState } from "react";

export type FaqItem = { question: string; answer: string };

/**
 * Accordion of frequently asked questions. Native buttons with
 * `aria-expanded`/`aria-controls`, so it works from the keyboard and reads
 * correctly to a screen reader; the closed panels stay in the DOM only when
 * open, keeping the collapsed page short on a phone.
 */
export function FaqAccordion({ items }: { items: FaqItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={item.question}>
            <h3>
              <button
                type="button"
                id={`faq-q-${i}`}
                aria-expanded={open}
                aria-controls={`faq-a-${i}`}
                onClick={() => setOpenIndex(open ? null : i)}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-brand transition-colors hover:bg-zoo-cream/50"
              >
                {item.question}
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                  className={`shrink-0 text-accent transition-transform duration-200 ${
                    open ? "rotate-180" : ""
                  }`}
                >
                  <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </h3>
            {open ? (
              <div
                id={`faq-a-${i}`}
                role="region"
                aria-labelledby={`faq-q-${i}`}
                className="text-muted px-5 pb-4 text-sm leading-relaxed"
              >
                {item.answer}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
