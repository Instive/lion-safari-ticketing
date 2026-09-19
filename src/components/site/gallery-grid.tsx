"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";

type GalleryImage = {
  src: string;
  alt: string;
  title?: string;
  position?: string;
  span: string;
};

export function GalleryGrid({ images }: { images: GalleryImage[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const captionId = useId();
  const [selected, setSelected] = useState<number | null>(null);
  const current = selected === null ? null : images[selected];

  useEffect(() => {
    if (selected === null) return;
    if (!dialog.current?.open) dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [selected]);

  function move(delta: number) {
    setSelected((index) => index === null ? null : (index + delta + images.length) % images.length);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:auto-rows-[240px] sm:grid-cols-3">
        {images.map((img, index) => (
          <button
            key={img.src}
            type="button"
            onClick={() => setSelected(index)}
            aria-label={`Enlarge image: ${img.alt}`}
            aria-haspopup="dialog"
            className={`group relative aspect-[4/5] overflow-hidden rounded-2xl border border-zoo-cream-strong bg-zoo-cream text-left sm:aspect-auto ${img.span}`}
          >
            <Image
              src={img.src}
              alt={img.alt}
              fill
              sizes={img.span.includes("col-span-3") ? "(min-width: 1152px) 1120px, 100vw" : img.span.includes("col-span-2") ? "(min-width: 1152px) 740px, (min-width: 640px) 66vw, 100vw" : "(min-width: 1152px) 365px, (min-width: 640px) 33vw, 100vw"}
              style={{ objectPosition: img.position ?? "center" }}
              className="object-cover transition-transform duration-500 group-hover:scale-105 group-focus-visible:scale-105"
            />
            <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-5 pb-5 pt-16 text-white">
              <span className="text-lg font-semibold">{img.title ?? "View image"}</span>
              <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/50 bg-black/20 text-xl backdrop-blur-sm">↗</span>
            </span>
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="gallery-dialog"
        aria-label="Safari gallery"
        aria-describedby={current ? captionId : undefined}
        onClose={() => setSelected(null)}
        onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
        }}
      >
        {current && selected !== null ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm text-zoo-cream">{current.title ?? "Safari gallery"} · {selected + 1} / {images.length}</p>
              <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-lg border border-white/30 px-4 text-sm hover:bg-white/10">Close ✕</button>
            </div>
            <div
              className="relative h-[50dvh] touch-pan-y sm:h-[60dvh]"
              onPointerDown={(event) => { if (event.pointerType === "touch") swipeStart.current = { x: event.clientX, y: event.clientY }; }}
              onPointerCancel={() => { swipeStart.current = null; }}
              onPointerUp={(event) => {
                const start = swipeStart.current;
                swipeStart.current = null;
                if (!start) return;
                const dx = event.clientX - start.x;
                const dy = event.clientY - start.y;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 1 : -1);
              }}
            >
              <Image src={current.src} alt={current.alt} fill sizes="(min-width: 1024px) 960px, 90vw" className="object-contain" />
            </div>
            <p id={captionId} aria-live="polite" className="mt-3 text-sm text-zoo-cream">{current.alt}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <button type="button" onClick={() => move(-1)} className="min-h-11 rounded-lg border border-white/30 px-4 text-sm hover:bg-white/10">← Previous</button>
              <span className="hidden text-xs text-zoo-cream/70 sm:inline">Use ← → to browse · Esc to close</span>
              <button type="button" onClick={() => move(1)} className="min-h-11 rounded-lg border border-white/30 px-4 text-sm hover:bg-white/10">Next →</button>
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}
