"use client";

import manifest from "./generated/image-manifest.json";

/** Responsive URLs for build-time assets, without a runtime image service. */
export default function staticImageLoader({ src, width }: { src: string; width: number }): string {
  const variants = (manifest as Record<string, { width: number; src: string }[]>)[src];
  if (!variants?.length) return src;
  return (variants.find((variant) => variant.width >= width) ?? variants[variants.length - 1]!).src;
}
