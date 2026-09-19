import Image from "next/image";

/** A responsive hero image with a brief, CSS-only entrance animation. */
export function HeroMedia() {
  return (
    <div className="safari-hero-visual absolute inset-0 overflow-hidden" aria-hidden="true">
      <Image
        src="/media/safari-hero.webp"
        alt=""
        fill
        preload
        sizes="100vw"
        className="safari-hero-image object-cover"
      />
      <div className="safari-hero-shade absolute inset-0" />
    </div>
  );
}
