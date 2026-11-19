// Generates the anonymous competitor artwork in assets/competitors/ (original
// vector art in the site's comic-ink style). Faceless hooded figures: no face,
// skin, hair, body-shape, or religious cues; rank shown only by colour, pose,
// and emblem. Run: node scripts/generate-competitors.mjs
import { writeFileSync } from "node:fs";

const INK = "#182526";
const HOOD = "#efe7d8";
const HOOD_SHADE = "#d9cfbd";
const TROUSERS = "#2a3d3f";
const W = 6; // outline width

// Thick ink-outlined limb along a path (outline stroke, then fill stroke).
const limb = (d, color, width = 62) =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${width + W * 2}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
// Ribbed cuff (sleeve end that covers the hand).
const cuff = (x, y, angle, color = HOOD) =>
  `<g transform="translate(${x} ${y}) rotate(${angle})"><rect x="-40" y="-26" width="80" height="52" rx="22" fill="${color}" stroke="${INK}" stroke-width="${W}"/>` +
  `<path d="M-22 -20v40M-8 -22v44M6 -22v44M20 -20v40" stroke="${INK}" stroke-width="3" opacity=".55"/></g>`;
const star = (cx, cy, r, fill) => {
  const points = Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    return `${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`;
  });
  return `<polygon points="${points.join(" ")}" fill="${fill}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
};

function head() {
  return [
    // hood
    `<path d="M178 356C160 270 172 156 300 126C428 156 440 270 422 356C380 372 220 372 178 356Z" fill="${HOOD}" stroke="${INK}" stroke-width="${W}" stroke-linejoin="round"/>`,
    `<path d="M300 128C298 150 300 160 300 160" stroke="${INK}" stroke-width="4" fill="none"/>`,
    // fabric folds where the hood meets the shoulders
    `<path d="M200 330C214 346 236 352 254 352M400 330C386 346 364 352 346 352" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    // inner hood shade + faceless opening
    `<path d="M216 252C216 186 250 158 300 158C350 158 384 186 384 252C384 304 352 336 300 336C248 336 216 304 216 252Z" fill="${HOOD_SHADE}" stroke="${INK}" stroke-width="4"/>`,
    `<path d="M232 256C232 200 260 176 300 176C340 176 368 200 368 256C368 300 342 322 300 322C258 322 232 300 232 256Z" fill="${INK}"/>`,
    `<path d="M256 214C246 238 248 272 264 298" stroke="#3a5254" stroke-width="7" fill="none" stroke-linecap="round"/>`,
    // hatching on the hood
    `<path d="M394 200l18 8M398 224l19 7M400 248l19 6M398 272l18 5" stroke="${INK}" stroke-width="3" opacity=".6" stroke-linecap="round"/>`,
  ].join("");
}

function torso(jacket, emblem) {
  return [
    // trousers below the jacket hem
    `<path d="M168 700L160 840H440L432 700Z" fill="${TROUSERS}" stroke="${INK}" stroke-width="${W}"/>`,
    `<path d="M300 724V840" stroke="#4a6264" stroke-width="4"/>`,
    // hoodie body
    `<path d="M136 720L142 430C146 378 192 346 244 336H356C408 346 454 378 458 430L464 720Z" fill="${HOOD}" stroke="${INK}" stroke-width="${W}" stroke-linejoin="round"/>`,
    // drawstrings
    `<path d="M282 318C280 360 276 392 278 418M318 318C320 360 324 392 322 418" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    `<rect x="273" y="414" width="10" height="20" rx="3" fill="${INK}"/><rect x="317" y="414" width="10" height="20" rx="3" fill="${INK}"/>`,
    // chest emblem (rank accent, no number or text)
    `<circle cx="300" cy="488" r="34" fill="${jacket}" stroke="${INK}" stroke-width="${W}"/>`,
    star(300, 488, 21, emblem),
    // open varsity jacket panels
    `<path d="M136 720L142 430C146 378 192 346 244 336L252 352L238 720Z" fill="${jacket}" stroke="${INK}" stroke-width="${W}" stroke-linejoin="round"/>`,
    `<path d="M464 720L458 430C454 378 408 346 356 336L348 352L362 720Z" fill="${jacket}" stroke="${INK}" stroke-width="${W}" stroke-linejoin="round"/>`,
    // collar / placket ribbing
    `<path d="M244 336L254 356L240 720" stroke="${HOOD}" stroke-width="12" fill="none"/><path d="M356 336L346 356L360 720" stroke="${HOOD}" stroke-width="12" fill="none"/>`,
    `<path d="M233 340L244 358L229 720M367 340L356 358L371 720" stroke="${INK}" stroke-width="3" fill="none"/>`,
    // jacket hem ribbing with stripes
    `<path d="M136 690H238V728H136Z" fill="${INK}"/><path d="M362 690H464V728H362Z" fill="${INK}"/>`,
    `<path d="M140 702H234M140 716H234M366 702H460M366 716H460" stroke="${jacket}" stroke-width="5"/>`,
    // comic hatching on the right side
    `<path d="M430 470l16 12M432 500l16 12M434 530l16 12M436 560l16 12" stroke="${INK}" stroke-width="3" opacity=".55" stroke-linecap="round"/>`,
  ].join("");
}

function pose(kind, jacket) {
  if (kind === "crossed") {
    // upper arms at the sides, forearms crossed over the chest; hands tucked in cuffs
    return limb("M160 410L150 560", jacket) + limb("M440 410L450 560", jacket) +
      limb("M156 572C230 580 320 560 404 536", jacket, 60) + cuff(404, 536, -14) +
      limb("M444 590C370 596 280 580 196 556", jacket, 60) + cuff(196, 556, 12);
  }
  if (kind === "pockets") {
    // both hands in the hip pockets
    return limb("M160 410L150 560L196 664", jacket) + limb("M440 410L450 560L404 664", jacket) +
      `<path d="M168 676L226 650M432 676L374 650" stroke="${INK}" stroke-width="${W}" stroke-linecap="round"/>`;
  }
  // "strap": one hand in a pocket, the other holding a backpack strap
  return `<path d="M378 346L402 720" stroke="${INK}" stroke-width="40" stroke-linecap="round"/><path d="M378 346L402 720" stroke="#3a5254" stroke-width="28" stroke-linecap="round"/>` +
    limb("M160 410L150 560L196 664", jacket) +
    `<path d="M168 676L226 650" stroke="${INK}" stroke-width="${W}" stroke-linecap="round"/>` +
    limb("M440 410L458 556L404 474", jacket) + cuff(404, 474, -58);
}

const svg = (viewBox, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="${title}">${body}</svg>\n`;

const ranks = [
  ["podium-1", "#f4c856", "#fffdf7", "crossed", "Anonymous champion illustration"],
  ["podium-2", "#bec9c5", "#fffdf7", "pockets", "Anonymous runner-up illustration"],
  ["podium-3", "#a8653a", "#fffdf7", "strap", "Anonymous third-place illustration"],
];
for (const [name, jacket, emblem, kind, title] of ranks) {
  // Draw order: body, then arms in front, then the hood/head.
  const body = torso(jacket, emblem) + pose(kind, jacket) + head();
  writeFileSync(new URL(`../assets/competitors/${name}.svg`, import.meta.url), svg("96 110 408 730", body, title));
}

// Ranks 4-10: head-and-shoulders thumbnails in three coordinated colourways.
const thumbs = [["thumb-a", "#76bbb1"], ["thumb-b", "#ef6f56"], ["thumb-c", "#a7b29b"]];
for (const [name, jacket] of thumbs) {
  const body = torso(jacket, "#fffdf7") + head();
  writeFileSync(new URL(`../assets/competitors/${name}.svg`, import.meta.url),
    svg("120 100 360 360", body, "Anonymous competitor illustration"));
}
console.log("wrote assets/competitors/*.svg");
