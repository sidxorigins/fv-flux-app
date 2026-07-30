#!/usr/bin/env node
/**
 * Regenerate the Flux app icon set.
 *
 *   node scripts/gen-icons.mjs
 *
 * Draws the app's own mark — a white "F" in Outfit Bold with the brand orange
 * dot, on the near-black app background — and writes:
 *
 *   public/icons/icon-192.png            manifest, any
 *   public/icons/icon-512.png            manifest, any
 *   public/icons/icon-192-maskable.png   manifest, maskable (Android crop)
 *   public/icons/icon-512-maskable.png   manifest, maskable
 *   public/icons/apple-touch-icon.png    iOS home screen
 *   src/app/favicon.ico                  multi-size 16/32/48
 *
 * Everything is a static PNG committed to the repo — nothing is generated at
 * request time, which keeps the standalone production build free of any font
 * fetching. Re-run this only when the mark or the brand colours change.
 *
 * The font is pulled from Google Fonts, the same source `next/font/google`
 * uses for the app's Outfit, so the icon and the in-app wordmark are the same
 * typeface. Requires network access.
 */

import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import sharp from "sharp";

// `next/og` is CommonJS and the next package publishes no ESM export map for
// it, so a bare `import ... from "next/og"` fails outside Next's bundler.
const require = createRequire(import.meta.url);
const { ImageResponse } = require("next/og.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS_DIR = path.join(ROOT, "public", "icons");
const FAVICON = path.join(ROOT, "src", "app", "favicon.ico");

// Brand tokens, mirrored from globals.css. Literal here because this output is
// an image, not a stylesheet — there is no CSS variable to reference.
const BG = "#0A0A0A"; // --background
const FG = "#F5F5F7"; // --foreground
const ORANGE = "#FF6B35"; // --primary

// Drawn once at this size, then downsampled with Lanczos so small sizes stay crisp.
const MASTER = 1024;

const OUTFIT_CSS =
  "https://fonts.googleapis.com/css2?family=Outfit:wght@700&display=swap";

async function loadOutfitBold() {
  const css = await fetch(OUTFIT_CSS, {
    // Without a browser UA, Google serves woff2, which satori can't parse.
    headers: { "User-Agent": "Mozilla/5.0" },
  }).then((r) => r.text());

  const url = css.match(/src:\s*url\((https:[^)]+\.ttf)\)/)?.[1];
  if (!url) throw new Error("Could not find an Outfit .ttf in the Google Fonts CSS");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Font download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The mark on transparency: "F" in Outfit Bold followed by the brand dot. */
function markElement() {
  const fontSize = MASTER * 0.62;
  const dot = fontSize * 0.17;
  return {
    type: "div",
    props: {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      },
      children: {
        type: "div",
        props: {
          style: { display: "flex", alignItems: "flex-end" },
          children: [
            {
              type: "div",
              props: {
                style: {
                  fontFamily: "Outfit",
                  fontSize,
                  fontWeight: 700,
                  color: FG,
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                },
                children: "F",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  width: dot,
                  height: dot,
                  borderRadius: dot,
                  background: ORANGE,
                  marginLeft: dot * 0.28,
                  marginBottom: fontSize * 0.11, // sits on the F's baseline
                },
              },
            },
          ],
        },
      },
    },
  };
}

async function main() {
  mkdirSync(ICONS_DIR, { recursive: true });
  const font = await loadOutfitBold();

  const raw = Buffer.from(
    await new ImageResponse(markElement(), {
      width: MASTER,
      height: MASTER,
      fonts: [{ name: "Outfit", data: font, weight: 700, style: "normal" }],
    }).arrayBuffer(),
  );

  // Trim to the real ink bounds before centring. Flex centring alone leaves the
  // mark visibly high and left, because a glyph's layout box includes
  // ascender/descender space the "F" doesn't fill.
  const mark = await sharp(raw).trim({ threshold: 1 }).toBuffer();
  const box = await sharp(mark).metadata();

  /**
   * @param size    square edge in px
   * @param padding fraction of the edge kept clear on the mark's longest side
   */
  async function render(size, padding, file) {
    const inner = Math.round(size * (1 - padding * 2));
    const scale = inner / Math.max(box.width, box.height);
    const w = Math.max(1, Math.round(box.width * scale));
    const h = Math.max(1, Math.round(box.height * scale));

    const scaled = await sharp(mark)
      .resize(w, h, { kernel: "lanczos3", fit: "fill" })
      .toBuffer();

    const out = path.join(ICONS_DIR, file);
    await sharp({
      create: { width: size, height: size, channels: 4, background: BG },
    })
      .composite([
        {
          input: scaled,
          left: Math.round((size - w) / 2),
          top: Math.round((size - h) / 2),
        },
      ])
      .png({ compressionLevel: 9 })
      .toFile(out);

    console.log(`  ${file}  ${size}x${size}`);
    return out;
  }

  console.log("icons:");
  await render(192, 0.2, "icon-192.png");
  await render(512, 0.2, "icon-512.png");
  // Maskable carries extra padding so Android's circle/squircle crop never
  // clips the mark.
  await render(192, 0.28, "icon-192-maskable.png");
  await render(512, 0.28, "icon-512-maskable.png");
  // iOS never masks and applies its own corner radius, so a tighter mark reads
  // better on the home screen.
  await render(180, 0.17, "apple-touch-icon.png");

  // Favicon: tighter still — a 16px tab icon needs every pixel of glyph.
  const icoSizes = [16, 32, 48];
  const icoPaths = [];
  for (const s of icoSizes) icoPaths.push(await render(s, 0.1, `_favicon-${s}.png`));

  writeIco(icoPaths, icoSizes);
  for (const p of icoPaths) if (existsSync(p)) unlinkSync(p); // inputs only
  console.log(`  favicon.ico  ${icoSizes.join("/")}`);
}

/**
 * Pack PNGs into a multi-resolution .ico. sharp can't write ICO, but the
 * container is trivial: a header, one 16-byte directory entry per image, then
 * the PNG bytes. PNG-in-ICO is understood by every browser in use and is far
 * smaller than the legacy BMP encoding.
 */
function writeIco(pngPaths, sizes) {
  const images = pngPaths.map((p, i) => ({
    size: sizes[i],
    data: readFileSync(p),
  }));

  const HEADER = 6;
  const ENTRY = 16;
  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map((img) => {
    const e = Buffer.alloc(ENTRY);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0); // width (0 means 256)
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1); // height
    e.writeUInt8(0, 2); // palette size — 0 for truecolour
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    return e;
  });

  writeFileSync(
    FAVICON,
    Buffer.concat([header, ...entries, ...images.map((i) => i.data)]),
  );
}

await main();
