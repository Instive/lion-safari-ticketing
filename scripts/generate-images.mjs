import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const publicDir = path.join(root, "public");
const output = path.join(publicDir, "_images");
const manifestDir = path.join(root, "src/lib/generated");
// Next's default deviceSizes and imageSizes, bounded by each source's width.
const widths = [32, 48, 64, 96, 128, 256, 384, 640, 750, 828, 1080, 1200, 1920, 2048, 3840];
const manifest = {};

async function* sources(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "_images") continue;
    const filename = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(filename);
    else if (/\.(png|jpe?g|webp)$/i.test(entry.name)) yield filename;
  }
}

await mkdir(output, { recursive: true });
await mkdir(manifestDir, { recursive: true });
sharp.concurrency(1);
sharp.cache(false);

for await (const filename of sources(publicDir)) {
  const source = await readFile(filename);
  const metadata = await sharp(source).metadata();
  if (!metadata.width || metadata.pages > 1) continue;
  const src = "/" + path.relative(publicDir, filename).split(path.sep).join("/");
  const variants = [];
  for (const width of [...new Set(widths.map((w) => Math.min(w, metadata.width)))]) {
    const bytes = await sharp(source).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const name = `${hash}-${width}.webp`;
    await writeFile(path.join(output, name), bytes);
    variants.push({ width, src: `/_images/${name}` });
  }
  manifest[src] = variants;
}

await writeFile(path.join(manifestDir, "image-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Prepared responsive images for ${Object.keys(manifest).length} sources (no runtime resizing).`);
