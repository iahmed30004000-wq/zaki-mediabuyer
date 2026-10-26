// The PWA icons (spec 18.5) from the Media Buyer mark (src/components/logo.tsx) in «وُضوح» colours (spec 18.1).
// `node scripts/make-icons.mjs` — writes public/icons/*.png; run again only if the mark changes.
import sharp from "sharp";

const NAVY = "#0C3252", PETROL = "#1A6382", CYAN = "#36B5CC", WHITE = "#F4F8FA";
const mark = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="${NAVY}"/>
  <g transform="translate(24 24) scale(${pad})">
    <g><rect x="-15" y="-15" width="30" height="30" rx="3" fill="${PETROL}"/>
    <rect x="-15" y="-15" width="30" height="30" rx="3" transform="rotate(45)" fill="${PETROL}"/>
    <circle r="10.5" fill="${WHITE}"/></g>
    <g transform="translate(-24 -24)"><path d="M16 29 L22 23 L26 26 L32 18" fill="none" stroke="${CYAN}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="32" cy="18" r="2.4" fill="${CYAN}"/></g>
  </g></svg>`;

for (const [name, size, pad] of [["icon-192", 192, 0.9], ["icon-512", 512, 0.9], ["maskable-512", 512, 0.62], ["apple-touch", 180, 0.8]]) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(`public/icons/${name}.png`);
  console.log(`public/icons/${name}.png`);
}
