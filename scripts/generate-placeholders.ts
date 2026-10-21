// Generates tasteful placeholder product images (two per product) into
// public/placeholders. Replace with real photography before launch.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { seedProducts } from "../prisma/seed-data";
import { slugify } from "../src/lib/slug";

const OUT = path.resolve("public/placeholders");
const W = 1200;
const H = 1500;

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const c = (n >> shift) & 255;
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  };
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

function isDark(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 150;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function front(name: string, hex: string): string {
  const ink = isDark(hex) ? "#f7f3ec" : "#1f1d1b";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${shade(hex, 0.18)}"/><stop offset="1" stop-color="${shade(hex, -0.22)}"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <path d="M300 1320 V560 a300 300 0 0 1 600 0 V1320 Z" fill="${shade(hex, 0.32)}" opacity="0.55"/>
  <text x="600" y="760" text-anchor="middle" font-family="Bodoni Moda, Didot, Georgia, serif" font-style="italic" font-size="64" fill="${ink}">${escape(name)}</text>
  <text x="600" y="1420" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="6" fill="${ink}" opacity="0.7">MERVEN · PLACEHOLDER IMAGE</text>
</svg>`;
}

function detail(hex: string): string {
  const lines = Array.from({ length: 70 }, (_, i) => {
    const x = i * 40 - 900;
    return `<line x1="${x}" y1="0" x2="${x + 1500}" y2="${H}" stroke="${shade(hex, 0.25)}" stroke-width="3" opacity="0.35"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="${shade(hex, -0.05)}"/>${lines}
  <text x="600" y="1420" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="22" letter-spacing="6" fill="${isDark(hex) ? "#f7f3ec" : "#1f1d1b"}" opacity="0.7">FABRIC DETAIL · PLACEHOLDER</text>
</svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  for (const p of seedProducts) {
    const slug = slugify(p.name);
    const hex = p.colours[0].hex;
    await sharp(Buffer.from(front(p.name, hex))).webp({ quality: 80 }).toFile(path.join(OUT, `${slug}-1.webp`));
    await sharp(Buffer.from(detail(hex))).webp({ quality: 80 }).toFile(path.join(OUT, `${slug}-2.webp`));
  }
  console.log(`Wrote ${seedProducts.length * 2} placeholder images to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
