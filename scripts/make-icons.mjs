// Renders the PWA icons in public/ from the "M" mark (same shape as
// src/components/LogoMark.jsx). Not part of the build: sharp is not a
// dependency here, run it with a sharp that resolves, e.g.
//   NODE_PATH=/opt/repos/web/node_modules node scripts/make-icons.mjs
import { createRequire } from 'node:module'
const sharp = createRequire(process.argv[1])('sharp')

// size = output px; inset = share of the canvas left as padding around the
// mark (maskable icons need a safe zone); radius 7/32 matches the logo.
const svg = (inset, rounded) => {
  const s = 32 * (1 - 2 * inset)
  const o = 32 * inset
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${rounded ? 'none' : '#2a2622'}"/>
  <g transform="translate(${o} ${o}) scale(${s / 32})">
    <rect width="32" height="32" rx="${rounded ? 7 : 0}" fill="#2a2622"/>
    <text x="16" y="23" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="19" font-weight="700" fill="#ffffff">M</text>
  </g>
</svg>`
}

const icons = [
  ['icon-192.png', 192, 0, true],
  ['icon-512.png', 512, 0, true],
  ['icon-maskable-512.png', 512, 0.1, false], // full-bleed, mark in the safe zone
  ['apple-touch-icon.png', 180, 0, false], // iOS rounds the corners itself
  ['favicon-32.png', 32, 0, true],
]
for (const [name, size, inset, rounded] of icons) {
  await sharp(Buffer.from(svg(inset, rounded)), { density: 384 })
    .resize(size, size)
    .png()
    .toFile(new URL(`../public/${name}`, import.meta.url).pathname)
}
