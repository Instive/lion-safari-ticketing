"use client";

import Image from "next/image";
import { useRef, useState } from "react";

type GalleryImage = { src: string; alt: string; span: string };

export function GalleryGrid({ images }: { images: GalleryImage[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(0);
  const current = images[selected];

  function move(delta: number) {
    setSelected((index) => (index + delta + images.length) % images.length);
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:auto-rows-[240px] sm:grid-cols-3">
        {images.map((img, index) => (
          <button
            key={img.src}
            type="button"
            onClick={() => { setSelected(index); dialog.current?.showModal(); }}
            aria-label={`Enlarge image: ${img.alt}`}
            className={`group relative min-h-72 overflow-hidden rounded-2xl border border-zoo-cream-strong bg-zoo-cream text-left sm:min-h-0 ${img.span}`}
          >
            <Image src={img.src} alt={img.alt} fill sizes="(min-width: 640px) 66vw, 100vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
            <span className="absolute bottom-3 right-3 rounded-full bg-zoo-forest-deep/90 px-4 py-2 text-sm font-medium text-white">View image ↗</span>
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="gallery-dialog"
        aria-label="Safari gallery"
        onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
          if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-zoo-cream">Safari gallery · {selected + 1} / {images.length}</p>
          <button type="button" onClick={() => dialog.current?.close()} className="min-h-11 rounded-lg border border-white/30 px-4 text-sm hover:bg-white/10">Close ✕</button>
        </div>
        <div className="relative h-[55dvh] sm:h-[65dvh]">
          <Image src={current.src} alt={current.alt} fill sizes="90vw" className="object-contain" />
        </div>
        <p aria-live="polite" className="mt-3 text-sm text-zoo-cream">{current.alt}</p>
        <div className="mt-4 flex justify-between gap-3">
          <button type="button" onClick={() => move(-1)} className="min-h-11 rounded-lg border border-white/30 px-4 text-sm hover:bg-white/10">← Previous</button>
          <button type="button" onClick={() => move(1)} className="min-h-11 rounded-lg border border-white/30 px-4 text-sm hover:bg-white/10">Next →</button>
        </div>
      </dialog>
    </>
  );
}
