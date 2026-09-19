import { GalleryGrid } from "@/components/site/gallery-grid";
import Link from "next/link";
import { SafariVideo } from "@/components/site/safari-video";
import { SAFARI_PHOTOS } from "@/lib/safari-media";

export const metadata = {
  title: "Gallery — Chhatbir Zoo",
  description: "A look at the Lion & Deer Safari at Chhatbir Zoo.",
};

export default function GalleryPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <header className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Gallery</p>
        <h1 className="mt-2 font-display text-5xl tracking-wide text-brand">The Wild, Up Close</h1>
        <p className="text-muted mx-auto mt-3 max-w-lg">
          Photos and a short film from Chhatbir Zoo. Open a photo for a closer look, or play the clip below.
        </p>
      </header>

      <GalleryGrid images={SAFARI_PHOTOS} />

      <section id="safari-film" aria-labelledby="film-heading" className="mt-12 grid items-center gap-8 rounded-3xl border border-zoo-cream-strong bg-zoo-cream/60 p-5 sm:p-8 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">From the park</p>
          <h2 id="film-heading" className="mt-2 font-display text-4xl tracking-wide text-brand">A Moment at Chhatbir</h2>
          <p className="mt-3 max-w-md text-muted">Take a short look inside the lion enclosure. Press play to watch the clip.</p>
        </div>
        <div className="mx-auto w-full max-w-xs">
          <SafariVideo />
        </div>
      </section>

      <details className="mt-8 rounded-2xl border border-line bg-surface p-5">
        <summary className="min-h-11 content-center font-semibold text-brand">Safari artwork &amp; posters</summary>
        <div className="mt-5">
          <GalleryGrid images={[
            { src: "/media/safari-hero.webp", alt: "Safari artwork of a lion resting beneath a tree", title: "Into the forest", span: "" },
            { src: "/lion_and_deer_safari_zoo.jpeg", alt: "Lion and Deer Safari poster with a bus, lion and deer", title: "Two safaris, one journey", span: "" },
            { src: "/Wildlife_safari_chhatbir.jpeg", alt: "Illustrated safari story showing the gate, lion, deer and jeep", title: "The safari story", span: "" },
          ]} />
        </div>
      </details>

      <div className="mt-10 text-center">
        <Link
          href="/book"
          className="touch-target inline-grid place-items-center rounded-xl bg-brand px-7 text-base font-semibold text-white hover:bg-brand-strong"
        >
          Book Your Tickets
        </Link>
      </div>
    </main>
  );
}
