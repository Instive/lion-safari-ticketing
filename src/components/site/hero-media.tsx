"use client";

import Image from "next/image";
import { useState } from "react";

/** The hero stays a small, responsive image; motion never downloads a video. */
export function HeroMedia() {
  const [paused, setPaused] = useState(false);
  return (
    <>
      <div className="safari-hero-visual absolute inset-0 overflow-hidden" aria-hidden="true">
        <Image
          src="/media/safari-hero.webp"
          alt=""
          fill
          preload
          sizes="100vw"
          className="safari-hero-image object-cover"
          style={{ animationPlayState: paused ? "paused" : "running" }}
        />
        <div className="safari-hero-shade absolute inset-0" />
      </div>
      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-pressed={paused}
        aria-label={paused ? "Resume background animation" : "Pause background animation"}
        className="absolute right-4 top-4 z-20 flex min-h-11 items-center gap-2 rounded-full border border-white/30 bg-zoo-forest-deep/70 px-4 text-sm font-medium text-white backdrop-blur-sm hover:bg-zoo-forest-deep motion-reduce:hidden sm:right-6 sm:top-6"
      >
        <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>
        {paused ? "Resume motion" : "Pause motion"}
      </button>
    </>
  );
}
