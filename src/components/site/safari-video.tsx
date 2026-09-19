"use client";

import Image from "next/image";
import { useRef, useState } from "react";

export function SafariVideo() {
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  return (
    <figure className="overflow-hidden rounded-3xl border border-zoo-cream-strong bg-zoo-forest-deep shadow-lg">
      <div className="relative aspect-[9/16]">
        {started ? (
          <video
            ref={video}
            src="/media/lion-safari-preview.mp4"
            poster="/media/lion-video-poster.webp"
            controls
            autoPlay
            muted
            playsInline
            preload="none"
            aria-label="A short clip of a lion at Chhatbir Zoo"
            aria-describedby="safari-video-description"
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
            onLoadedData={() => video.current?.focus()}
            tabIndex={0}
          />
        ) : (
          <button
            type="button"
            onClick={() => setStarted(true)}
            aria-label="Play the lion video"
            className="group absolute inset-0 h-full w-full text-white"
          >
            <Image src="/media/lion-video-poster.webp" alt="A lion in its enclosure at Chhatbir Zoo" fill sizes="(min-width: 640px) 320px, 90vw" className="object-cover" />
            <span className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-20 w-20 place-items-center rounded-full border border-white/70 bg-white/20 shadow-xl backdrop-blur-sm transition-transform group-hover:scale-110">
                <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 4v16l13-8z" /></svg>
              </span>
            </span>
            <span className="absolute inset-x-5 bottom-5 text-left text-base font-semibold">A moment at Chhatbir <span className="mt-1 block text-sm font-normal text-white/80">Tap to watch the clip</span></span>
          </button>
        )}
      </div>
      <figcaption id="safari-video-description" className="px-5 py-4 text-sm text-zoo-cream/90">
        A glimpse of the lion enclosure, filmed at the zoo.
        {failed ? <p role="alert" className="mt-2">The clip could not load. <button type="button" className="underline" onClick={() => { setFailed(false); setStarted(false); }}>Try again</button></p> : null}
      </figcaption>
    </figure>
  );
}
