import Image from "next/image";

/**
 * The zoo crest and wordmark, for staff-facing screens.
 *
 * The public site carries the full "safari poster" styling; staff screens stay
 * plain so they read fast in daylight. This is the one shared piece of identity
 * between them — enough that a person signing in knows whose system this is,
 * without importing the poster look into a working tool.
 */
export function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const crest = size === "lg" ? 72 : size === "md" ? 44 : 32;

  return (
    <span className="flex items-center gap-3">
      <Image
        src="/lion_deer_safari_logo.jpeg"
        alt=""
        width={crest}
        height={crest}
        className="rounded-full ring-2 ring-accent/40"
        priority
      />
      <span className="leading-tight">
        <span
          className={`block font-display tracking-wide text-brand ${
            size === "lg" ? "text-3xl" : size === "md" ? "text-xl" : "text-base"
          }`}
        >
          Chhatbir Zoo
        </span>
        <span
          className={`block uppercase tracking-[0.18em] text-muted ${
            size === "lg" ? "text-xs" : "text-[10px]"
          }`}
        >
          Lion &amp; Deer Safari
        </span>
      </span>
    </span>
  );
}
