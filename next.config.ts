import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Variants are generated at build time; the web process never loads Sharp.
    loader: "custom",
    loaderFile: "./src/lib/static-image-loader.ts",
  },
  async headers() {
    return [{
      source: "/_images/:path*",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    }];
  },
};

export default nextConfig;
