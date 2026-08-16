import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Gallery — Chhatbir Zoo",
  description: "A look at the Lion & Deer Safari at Chhatbir Zoo.",
};

const IMAGES = [
  {
    src: "/Wildlife_safari_web.png",
    alt: "A lion resting in the forest, with a lioness and cub, a spotted deer, and the safari jeep below",
    span: "sm:col-span-2 sm:row-span-2",
  },
  {
    src: "/lion_and_deer_safari_zoo.jpeg",
    alt: "Lion and Deer Safari poster with the safari bus, a lion and a deer",
    span: "",
  },
  {
    src: "/Wildlife_safari_chhatbir.jpeg",
    alt: "Story panels: entering the gate, meeting a lion, a spotted deer, and the safari jeep on the trail",
    span: "sm:row-span-2",
  },
  {
    src: "/lion_deer_safari_logo.jpeg",
    alt: "Lion & Deer Safari by M.C.Z.P Chhatbir crest",
    span: "",
  },
];

export default function GalleryPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-12">
      <header className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">Gallery</p>
        <h1 className="mt-2 font-display text-5xl tracking-wide text-brand">The Wild, Up Close</h1>
        <p className="text-muted mx-auto mt-3 max-w-lg">
          A glimpse of the lions, deer and safari trails waiting for you at Chhatbir Zoo.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {IMAGES.map((img) => (
          <div
            key={img.src}
            className={`relative aspect-square overflow-hidden rounded-2xl border border-zoo-cream-strong bg-zoo-cream ${img.span}`}
          >
            <Image src={img.src} alt={img.alt} fill className="object-cover" />
          </div>
        ))}
      </div>

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
