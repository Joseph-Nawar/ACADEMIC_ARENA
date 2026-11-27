// Academic Arena Character V2: deterministic layered SVG renderer.
//
// Original artwork, drawn in code. render(config, options) returns an SVG
// string built only from catalog constants and numbers: config values are
// first normalized to catalog keys, so no input text ever reaches the markup.
// Presentation attributes only (no style attributes or <style>), so the page's
// strict CSP (style-src 'self') is respected.
//
// Coordinate system (full context, viewBox 0 0 400 540):
//   head centre (200,150); eyes y=158; mouth y=210; chin y≈238
//   neck base y=266; shoulders y≈290; waist y=392; hips y=412; ankles y=506; soles y=528
// Layer order, back to front: backdrop, back items (cape, bag body), hair back,
// wheelchair back, legs/bottoms/shoes, neck, top, cane/crutch shafts, arms,
// neck items, bag straps, head-covering drape, ears, face, facial details,
// beard, mouth, mustache, eyes, brows, glasses, hair front, headwear front,
// hearing devices, earrings, sticker.
(function attachAvatarRenderer(root) {
  "use strict";

  const catalog = root.AcademicArenaAvatarCatalog;
  const P = catalog.palettes;
  let renderCount = 0;

  // ---------- colour helpers ----------
  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const rgbToHex = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const x = hexToRgb(a); const y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const dark = (hex, t) => mix(hex, "#1B0E0A", t);
  const light = (hex, t) => mix(hex, "#FFFFFF", t);
  const n = (value) => (Math.round(value * 10) / 10).toString();
  const pt = (x, y) => `${n(x)},${n(y)}`;

  // ---------- geometry ----------
  const CX = 200;
  const faces = {
    oval: { top: 62, fore: 70, cheek: 74, jaw: 62, chin: 22, chinY: 238 },
    round: { top: 64, fore: 74, cheek: 81, jaw: 72, chin: 36, chinY: 234 },
    square: { top: 62, fore: 75, cheek: 77, jaw: 75, chin: 40, chinY: 236 },
    heart: { top: 62, fore: 78, cheek: 77, jaw: 56, chin: 15, chinY: 238 },
    long: { top: 58, fore: 66, cheek: 69, jaw: 60, chin: 24, chinY: 246 },
    diamond: { top: 64, fore: 62, cheek: 79, jaw: 58, chin: 18, chinY: 239 },
  };
  const builds = {
    slim: { sh: 60, waist: 47, hip: 51, arm: 15, leg: 19 },
    regular: { sh: 70, waist: 55, hip: 58, arm: 17, leg: 21 },
    broad: { sh: 84, waist: 66, hip: 64, arm: 20, leg: 24 },
    soft: { sh: 76, waist: 74, hip: 77, arm: 20, leg: 25 },
  };
  const EYE_Y = 158;
  const EYE_DX = 31;
  const MOUTH_Y = 210;

  function facePath(f) {
    const side = (s) => {
      const x = (v) => CX + s * v;
      return [
        `C${pt(x(f.fore * 0.58), f.top)} ${pt(x(f.fore), f.top + 20)} ${pt(x(f.fore), 112)}`,
        `C${pt(x(f.fore), 130)} ${pt(x(f.cheek), 138)} ${pt(x(f.cheek), 160)}`,
        `C${pt(x(f.cheek), 184)} ${pt(x(f.jaw + 2), 196)} ${pt(x(f.jaw * 0.92), 212)}`,
        `C${pt(x(f.jaw * 0.74), f.chinY - 8)} ${pt(x(f.chin + 10), f.chinY)} ${pt(CX, f.chinY)}`,
      ];
    };
    const right = side(1);
    // Left side is the mirror, traversed back up from the chin.
    const l = (v) => CX - v;
    return `M${pt(CX, f.top)} ${right.join(" ")} ` +
      `C${pt(l(f.chin + 10), f.chinY)} ${pt(l(f.jaw * 0.74), f.chinY - 8)} ${pt(l(f.jaw * 0.92), 212)} ` +
      `C${pt(l(f.jaw + 2), 196)} ${pt(l(f.cheek), 184)} ${pt(l(f.cheek), 160)} ` +
      `C${pt(l(f.cheek), 138)} ${pt(l(f.fore), 130)} ${pt(l(f.fore), 112)} ` +
      `C${pt(l(f.fore), f.top + 20)} ${pt(l(f.fore * 0.58), f.top)} ${pt(CX, f.top)} Z`;
  }

  // ---------- small svg builders ----------
  const path = (d, fill, stroke, width = 3, extra = "") =>
    `<path d="${d}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"` : ""}${extra}/>`;
  const circle = (x, y, r, fill, stroke, width = 3, extra = "") =>
    `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${width}"` : ""}${extra}/>`;
  const ellipse = (x, y, rx, ry, fill, extra = "") => `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}" fill="${fill}"${extra}/>`;
  const line = (d, stroke, width, extra = "") => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  const group = (body, extra = "") => (body ? `<g${extra}>${body}</g>` : "");
  const mirror = (body) => `<g transform="matrix(-1 0 0 1 400 0)">${body}</g>`;
  const both = (body) => body + mirror(body);
  // An outlined tube along a polyline (arms, legs, straps): outline pass then fill pass.
  const tube = (d, width, fill, outline, ow = 3) => line(d, outline, width + ow * 2) + line(d, fill, width);
  // A union of circles with one clean outline (curls, puffs, wreaths).
  function blobs(points, fill, outline, ow = 3) {
    return points.map(([x, y, r]) => circle(x, y, r + ow, outline)).join("") + points.map(([x, y, r]) => circle(x, y, r, fill)).join("");
  }

  function createContext(config, idPrefix) {
    const defs = [];
    const id = (name) => `${idPrefix}-${name}`;
    const url = (name) => `url(#${id(name)})`;
    const linear = (name, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => {
      defs.push(`<linearGradient id="${id(name)}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
        stops.map(([offset, color, opacity = 1]) => `<stop offset="${offset}" stop-color="${color}"${opacity !== 1 ? ` stop-opacity="${opacity}"` : ""}/>`).join("") + "</linearGradient>");
      return url(name);
    };
    const radial = (name, stops, cx = 0.5, cy = 0.5, r = 0.5) => {
      defs.push(`<radialGradient id="${id(name)}" cx="${cx}" cy="${cy}" r="${r}">` +
        stops.map(([offset, color, opacity = 1]) => `<stop offset="${offset}" stop-color="${color}"${opacity !== 1 ? ` stop-opacity="${opacity}"` : ""}/>`).join("") + "</radialGradient>");
      return url(name);
    };
    const clip = (name, body, transform = "") => {
      defs.push(`<clipPath id="${id(name)}"${transform}>${body}</clipPath>`);
      return ` clip-path="url(#${id(name)})"`;
    };
    // Soft top-left light, gentle shadow to the lower right.
    const shade = (name, base, amount = 0.14) => linear(name, [[0, light(base, amount)], [0.55, base], [1, dark(base, amount)]], 0.2, 0, 0.8, 1);

    const skinBase = P.skin[Number(config.skin.slice(1)) - 1];
    const hairBase = P.hairColors[config.hairColor][1];
    const cloth = (key) => P.clothColors[key][1];
    const c = {
      skin: skinBase,
      skinShadow: dark(skinBase, 0.16),
      skinLine: dark(skinBase, 0.5),
      hair: hairBase,
      hairLine: dark(hairBase, 0.55),
      hairLight: light(hairBase, 0.28),
      eye: P.eyeColors[config.eyeColor][1],
      ink: "#2A1C18",
      lips: P.lipColors[config.lips][1],
      frame: P.frameColors[config.glassesColor][1],
      top: cloth(config.topColor), bottom: cloth(config.bottomColor), shoes: cloth(config.shoesColor),
      head: cloth(config.headwearColor), neck: cloth(config.neckColor), back: cloth(config.backColor),
      gold: "#E7B43C", goldLine: "#8A5F12",
    };
    const ctx = {
      config, c, defs, id, url, linear, radial, clip, shade,
      face: faces[config.face], build: builds[config.build],
      seated: config.mobility === "wheelchair",
      headwear: catalog.items[`headwear.${config.headwear}`],
      // Two-colour outlined fill helpers bound to this render.
      fillLine: (base) => dark(base, 0.55),
    };
    ctx.radialGlow = (x, y, r, color, opacity) => ellipse(x, y, r, r, radial(`glow${Math.round(x + y + r)}`, [[0, color, opacity], [1, color, 0]]));
    ctx.skinFill = radial("skin", [[0, light(skinBase, 0.1)], [0.65, skinBase], [1, dark(skinBase, 0.1)]], 0.42, 0.36, 0.7);
    ctx.skinFlat = shade("skinflat", skinBase, 0.1);
    ctx.hairFill = linear("hair", [[0, light(hairBase, 0.16)], [0.45, hairBase], [1, dark(hairBase, 0.22)]], 0.3, 0, 0.7, 1);
    return ctx;
  }

  // ---------- backdrops ----------
  const flatBackdrops = { mint: "#76BBB1", coral: "#EF8C74", gold: "#F4C856", paper: "#EDE3D1", sky: "#9CC3E6", lilac: "#C3B2E1" };
  function backdrop(ctx) {
    const key = ctx.config.backdrop;
    const R = (fill) => `<rect x="-60" y="-60" width="520" height="660" fill="${fill}"/>`;
    if (flatBackdrops[key]) {
      const base = flatBackdrops[key];
      const glow = ctx.radial("bd", [[0, light(base, 0.35)], [1, base]], 0.5, 0.32, 0.6);
      const dots = [[52, 74], [72, 96], [344, 420], [322, 446], [360, 392], [40, 470]].map(([x, y]) => circle(x, y, 4, dark(base, 0.14))).join("");
      return R(glow) + circle(CX, 160, 128, light(base, 0.16)) +
        line("M24 210 q26 -16 52 0 t52 0", dark(base, 0.12), 5) + line("M300 120 q22 -14 44 0 t44 0", dark(base, 0.12), 5) + dots;
    }
    if (key === "campus") {
      const sky = ctx.linear("bd", [[0, "#A9D8EC"], [1, "#F6EBD6"]]);
      const windows = [];
      for (let x = 44; x < 360; x += 34) for (const y of [262, 300]) windows.push(`<rect x="${x}" y="${y}" width="16" height="22" rx="3" fill="#F7E3B5"/>`);
      return R(sky) + circle(316, 78, 30, "#FFE9A6") +
        path("M10 420 V250 l40 -30 h300 l40 30 V420 Z", "#D9C3A4", "#9C8061", 3) + path("M150 220 l50 -62 l50 62 Z", "#C86F5A", "#8E4A3A", 3) +
        windows.join("") + path("M-60 440 Q200 410 460 440 V660 H-60 Z", "#8DBF7F", "#5E8F54", 3) +
        circle(46, 400, 34, "#5E9B5C", "#3F6E3E") + circle(356, 404, 30, "#5E9B5C", "#3F6E3E");
    }
    if (key === "night") {
      const sky = ctx.linear("bd", [[0, "#1E2A4A"], [1, "#3B3F6B"]]);
      const stars = [[40, 60], [96, 120], [330, 52], [360, 150], [70, 250], [300, 230], [150, 40], [250, 90], [36, 420], [370, 380]];
      return R(sky) + stars.map(([x, y], i) => circle(x, y, i % 3 ? 2 : 3.2, "#FFF4C8")).join("") +
        circle(320, 92, 28, "#F7E7B0") + circle(332, 84, 24, "#1E2A4A") + ctx.radialGlow(CX, 200, 190, "#F6D98A", 0.3);
    }
    if (key === "library") {
      const wall = ctx.linear("bd", [[0, "#6E4A33"], [1, "#4A2F21"]]);
      const books = [];
      const hues = ["#C6433B", "#2E4A7D", "#E7B43C", "#3F6B4F", "#E8DCC4", "#6E3E6E", "#2F8F88"];
      for (const shelf of [70, 190, 310, 430]) {
        let x = -10;
        let i = shelf;
        while (x < 410) {
          const w = 14 + (i % 4) * 4;
          const h = 70 + (i % 3) * 12;
          books.push(`<rect x="${x}" y="${shelf + 90 - h}" width="${w}" height="${h}" rx="2" fill="${hues[i % hues.length]}" stroke="#2C1A12" stroke-width="2"/>`);
          x += w + 2;
          i += 5;
        }
        books.push(`<rect x="-60" y="${shelf + 90}" width="520" height="12" fill="#3A2418"/>`);
      }
      return R(wall) + books.join("") + ctx.radialGlow(CX, 200, 200, "#FFE6A8", 0.35);
    }
    if (key === "spotlight") {
      const bg = ctx.linear("bd", [[0, "#1F2240"], [1, "#2D2552"]]);
      const beam = ctx.linear("beam", [[0, "#FFF1B8", 0.75], [1, "#FFF1B8", 0]]);
      return R(bg) + path("M150 -20 L250 -20 L340 560 L60 560 Z", beam) +
        ellipse(CX, 586, 150, 24, "#FFF1B8", ' opacity="0.35"') +
        [[50, 80], [350, 120], [70, 330], [340, 300]].map(([x, y]) => star5(x, y, 9, "#F4C856")).join("");
    }
    if (key === "podium") {
      const bg = ctx.linear("bd", [[0, "#F7D9A0"], [1, "#EFA36F"]]);
      const confetti = [[40, 60, "#2F8F88"], [90, 140, "#C6433B"], [330, 70, "#2E4A7D"], [360, 170, "#2F8F88"], [60, 260, "#E7B43C"], [340, 270, "#C6433B"], [150, 40, "#6E3E6E"], [270, 30, "#E7B43C"]];
      return R(bg) + confetti.map(([x, y, col], i) => `<rect x="${x}" y="${y}" width="12" height="7" rx="2" fill="${col}" transform="rotate(${i * 37} ${x} ${y})"/>`).join("") +
        path("M10 520 h120 v90 h-120 Z", "#C9CED6", "#6B7280") + path("M270 536 h120 v80 h-120 Z", "#D9A06A", "#8A5A33") +
        path("M130 496 h140 v120 h-140 Z", "#F4C856", "#8A5F12") +
        `<text x="200" y="590" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="58" fill="#8A5F12">1</text>`;
    }
    if (key === "hall") {
      const bg = ctx.linear("bd", [[0, "#FCE7A8"], [0.6, "#E9B850"], [1, "#B9822A"]]);
      const pillars = [30, 110, 290, 370].map((x) => `<rect x="${x - 16}" y="60" width="32" height="480" fill="#FFF3CF" stroke="#B9822A" stroke-width="3"/>`).join("");
      return R(bg) + pillars + path("M-60 40 H460 V70 H-60 Z", "#FFF3CF", "#B9822A") +
        path("M150 70 v120 l50 -24 l50 24 v-120 Z", "#C6433B", "#7C2621", 3) + star5(CX, 120, 22, "#F4C856") +
        ctx.radialGlow(CX, 230, 200, "#FFFFFF", 0.45);
    }
    if (key === "circuit") {
      const bg = ctx.linear("bd", [[0, "#0F2F33"], [1, "#16243F"]]);
      const traces = ["M0 100 H120 l30 30 H260", "M400 180 H300 l-30 -30 H200", "M0 400 H90 l40 -40 H210", "M400 460 H310 l-30 30 H180", "M60 0 V60 l30 30 V180", "M340 540 V470 l-30 -30 V330"];
      return R(bg) + traces.map((d) => line(d, "#2EE6D6", 3, ' opacity="0.6"')).join("") +
        [[260, 130], [200, 150], [210, 360], [180, 490], [90, 180], [310, 330]].map(([x, y]) => circle(x, y, 6, "#0F2F33", "#2EE6D6", 3)).join("") +
        ctx.radialGlow(CX, 220, 200, "#2EE6D6", 0.18);
    }
    return R("#EDE3D1");
  }

  function star5(x, y, r, fill, stroke = dark(fill, 0.45)) {
    const points = [];
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      points.push(pt(x + Math.cos(a) * rr, y + Math.sin(a) * rr));
    }
    return path(`M${points.join(" L")} Z`, fill, stroke, 2.5);
  }

  // ---------- stickers ----------
  function sticker(ctx) {
    const key = ctx.config.sticker;
    const at = (body) => `<g transform="translate(336 74) rotate(10)">${body}</g>`;
    const ink = "#1B2829";
    switch (key) {
      case "spark": return at(path("M0 -34 C4 -8 8 -4 34 0 C8 4 4 8 0 34 C-4 8 -8 4 -34 0 C-8 -4 -4 -8 0 -34 Z", ink));
      case "bolt": return at(path("M6 -34 L-20 6 H-2 L-8 34 L20 -8 H2 Z", "#F4C856", ink, 3));
      case "heart": return at(path("M0 28 C-30 8 -34 -10 -22 -22 C-12 -30 -2 -24 0 -16 C2 -24 12 -30 22 -22 C34 -10 30 8 0 28 Z", "#EF6F56", ink, 3));
      case "star": return at(star5(0, 0, 32, "#F4C856", ink));
      case "book": return at(path("M-30 -20 Q-14 -28 0 -18 Q14 -28 30 -20 V22 Q14 14 0 24 Q-14 14 -30 22 Z", "#FFFDF7", ink, 3) + line("M0 -18 V24", ink, 3) + line("M-22 -8 h14 M-22 2 h14 M8 -8 h14 M8 2 h14", "#76BBB1", 3));
      case "code": return at(path("M-34 -24 H34 V24 H-34 Z", "#182526", ink, 3, ' rx="8"') + line("M-14 -10 L-24 0 L-14 10 M14 -10 L24 0 L14 10 M5 -14 L-5 14", "#76BBB1", 4));
      case "elite": return at(path("M0 -36 L30 -24 V4 C30 22 14 32 0 38 C-14 32 -30 22 -30 4 V-24 Z", "#2E4A7D", "#F4C856", 4) +
        `<text x="0" y="6" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="13" fill="#F4C856">TOP</text><text x="0" y="24" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="18" fill="#FFFFFF">10</text>`);
      case "podium": return at(line("M-12 -36 L0 -8 L12 -36", "#C6433B", 9) + circle(0, 8, 22, "#C9CED6", "#5B6472", 3) + circle(0, 8, 14, "#E3E7EC") +
        `<text x="0" y="15" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="20" fill="#5B6472">3</text>`);
      case "trophy": return at(path("M-20 -30 H20 V-6 C20 10 10 18 0 18 C-10 18 -20 10 -20 -6 Z", "#F4C856", "#8A5F12", 3) +
        line("M-20 -22 C-34 -22 -34 0 -16 4 M20 -22 C34 -22 34 0 16 4", "#8A5F12", 4) + path("M-6 18 H6 V28 H14 V36 H-14 V28 H-6 Z", "#E7B43C", "#8A5F12", 3) + star5(0, -10, 8, "#FFF3CF", "#8A5F12"));
      case "circuit": return at(path("M-24 -24 H24 V24 H-24 Z", "#0F2F33", "#2EE6D6", 3) + line("M-12 -34 V-24 M0 -34 V-24 M12 -34 V-24 M-12 24 V34 M0 24 V34 M12 24 V34 M-34 -10 H-24 M-34 10 H-24 M24 -10 H34 M24 10 H34", "#2EE6D6", 3) + circle(0, 0, 8, "#2EE6D6"));
      default: return "";
    }
  }

  // ---------- hair ----------
  // Each style: back (behind the body), front (over the forehead), top (y of
  // the hair's highest point, where crown items sit).
  function domeFront(ctx, { top = 46, width = 88, hairline = 102, sideY = 168, fringe = "" } = {}) {
    // Dome over the skull, down to sideburns, back across a hairline curve.
    const w = width;
    const d = `M${pt(CX - w + 2, sideY)} C${pt(CX - w - 6, 120)} ${pt(CX - w + 14, top + 8)} ${pt(CX, top)} ` +
      `C${pt(CX + w - 14, top + 8)} ${pt(CX + w + 6, 120)} ${pt(CX + w - 2, sideY)} ` +
      `L${pt(CX + w - 14, sideY)} C${pt(CX + w - 16, 140)} ${pt(CX + 64, 118)} ${pt(CX + 54, hairline + 4)} ` +
      (fringe || `C${pt(CX + 30, hairline - 4)} ${pt(CX - 30, hairline - 4)} ${pt(CX - 54, hairline + 4)} `) +
      `C${pt(CX - 64, 118)} ${pt(CX - w + 16, 140)} ${pt(CX - w + 14, sideY)} Z`;
    return d;
  }
  function hairPaint(ctx, d, extra = "") { return path(d, ctx.hairFill, ctx.c.hairLine, 3, extra); }
  function shine(ctx, d) { return line(d, ctx.c.hairLight, 4, ' opacity="0.75"'); }

  function curlRing(cx, cy, rx, ry, count, r, from = 0, to = Math.PI * 2, jitter = 0.18) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      const a = from + ((to - from) * i) / Math.max(1, count - (to - from >= Math.PI * 2 - 0.01 ? 0 : 1));
      const rr = r * (1 + Math.sin(i * 2.7) * jitter);
      out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, rr]);
    }
    return out;
  }
  function curlHighlights(ctx, points) {
    return points.filter((_, i) => i % 2 === 0).map(([x, y, r]) => line(`M${pt(x - r * 0.45, y - r * 0.2)} q${n(r * 0.35)} ${n(-r * 0.45)} ${n(r * 0.8)} ${n(-r * 0.1)}`, ctx.c.hairLight, 2.6, ' opacity="0.7"')).join("");
  }

  const hairStyles = {
    bald: { top: 62, front: (ctx) => ellipse(CX - 24, 84, 26, 10, "#FFFFFF", ' opacity="0.22"') },
    buzz: {
      top: 56,
      front: (ctx) => path(domeFront(ctx, { top: 57, width: 80, hairline: 98, sideY: 160 }), mix(ctx.c.hair, ctx.c.skin, 0.32), dark(mix(ctx.c.hair, ctx.c.skin, 0.32), 0.25), 2),
    },
    fade: {
      top: 52,
      front: (ctx) => {
        const fade = ctx.linear("fade", [[0, ctx.c.hair], [0.45, ctx.c.hair], [1, ctx.c.skin, 0]], 0, 0, 0, 1);
        return path(domeFront(ctx, { top: 60, width: 82, hairline: 100, sideY: 176 }), fade) +
          hairPaint(ctx, `M${pt(CX - 70, 104)} C${pt(CX - 72, 64)} ${pt(CX - 30, 50)} ${pt(CX, 50)} C${pt(CX + 30, 50)} ${pt(CX + 72, 64)} ${pt(CX + 70, 104)} C${pt(CX + 40, 92)} ${pt(CX - 40, 92)} ${pt(CX - 70, 104)} Z`) +
          shine(ctx, `M${pt(CX - 36, 66)} q30 -10 58 -2`);
      },
    },
    crop: {
      top: 44,
      front: (ctx) => {
        const fringe = `L${pt(CX + 40, 110)} L${pt(CX + 30, 98)} L${pt(CX + 16, 108)} L${pt(CX + 4, 96)} L${pt(CX - 10, 108)} L${pt(CX - 24, 96)} L${pt(CX - 38, 108)} L${pt(CX - 54, 104)} `;
        return hairPaint(ctx, domeFront(ctx, { top: 44, hairline: 100, sideY: 160, fringe })) + shine(ctx, `M${pt(CX - 40, 62)} q30 -14 64 -4`);
      },
    },
    sidepart: {
      top: 44,
      front: (ctx) => {
        const fringe = `C${pt(CX + 20, 96)} ${pt(CX - 10, 92)} ${pt(CX - 30, 90)} C${pt(CX - 46, 94)} ${pt(CX - 56, 110)} ${pt(CX - 60, 124)} `;
        return hairPaint(ctx, domeFront(ctx, { top: 44, hairline: 104, sideY: 164, fringe })) +
          line(`M${pt(CX - 30, 50)} Q${pt(CX - 32, 70)} ${pt(CX - 30, 90)}`, ctx.c.hairLine, 2.5) + shine(ctx, `M${pt(CX - 10, 62)} q34 -6 60 12`);
      },
    },
    quiff: {
      top: 28,
      front: (ctx) => {
        const d = `M${pt(CX - 86, 160)} C${pt(CX - 94, 110)} ${pt(CX - 80, 66)} ${pt(CX - 46, 52)} C${pt(CX - 40, 30)} ${pt(CX + 10, 20)} ${pt(CX + 46, 34)} ` +
          `C${pt(CX + 76, 44)} ${pt(CX + 94, 90)} ${pt(CX + 86, 160)} L${pt(CX + 72, 160)} C${pt(CX + 70, 126)} ${pt(CX + 60, 108)} ${pt(CX + 40, 100)} ` +
          `C${pt(CX + 10, 88)} ${pt(CX - 20, 94)} ${pt(CX - 50, 104)} C${pt(CX - 66, 116)} ${pt(CX - 72, 140)} ${pt(CX - 72, 160)} Z`;
        return hairPaint(ctx, d) + line(`M${pt(CX - 36, 70)} C${pt(CX - 10, 44)} ${pt(CX + 30, 40)} ${pt(CX + 56, 58)}`, ctx.c.hairLine, 2.5) + shine(ctx, `M${pt(CX - 24, 50)} q30 -16 60 -4`);
      },
    },
    curltop: {
      top: 34,
      front: (ctx) => {
        const fade = ctx.linear("fade", [[0, ctx.c.hair], [0.5, ctx.c.hair], [1, ctx.c.skin, 0]], 0, 0, 0, 1);
        const curls = [...curlRing(CX, 70, 58, 26, 11, 15, Math.PI, Math.PI * 2), ...curlRing(CX, 88, 50, 10, 7, 13, Math.PI * 0.95, Math.PI * 2.05), [CX - 20, 66, 15], [CX + 18, 64, 15], [CX, 78, 15]];
        return path(domeFront(ctx, { top: 70, width: 82, hairline: 104, sideY: 176 }), fade) + blobs(curls, ctx.hairFill, ctx.c.hairLine) + curlHighlights(ctx, curls);
      },
    },
    cornrows: {
      top: 52,
      front: (ctx) => {
        const rows = [];
        for (let i = -3; i <= 3; i += 1) rows.push(line(`M${pt(CX + i * 18, 100)} C${pt(CX + i * 22, 80)} ${pt(CX + i * 24, 62)} ${pt(CX + i * 20, 52)}`, ctx.c.hairLine, 2.5, ' stroke-dasharray="5 4"'));
        return hairPaint(ctx, domeFront(ctx, { top: 52, width: 82, hairline: 102, sideY: 156 })) + rows.join("");
      },
    },
    afro: {
      top: 24,
      back: (ctx) => {
        const ring = curlRing(CX, 138, 106, 100, 26, 26);
        return ellipse(CX, 140, 106, 100, ctx.c.hairLine) + blobs(ring, ctx.hairFill, ctx.c.hairLine) + ellipse(CX, 140, 104, 98, ctx.hairFill) + curlHighlights(ctx, ring.filter(([, y]) => y < 140));
      },
      front: (ctx) => {
        const fringe = curlRing(CX, 124, 70, 30, 10, 12, Math.PI * 1.08, Math.PI * 1.92, 0.12);
        return blobs(fringe, ctx.hairFill, ctx.hairFill, 2) + curlHighlights(ctx, fringe);
      },
    },
    puff: {
      top: 4,
      back: (ctx) => {
        const puff = curlRing(CX, 34, 44, 30, 16, 16);
        return blobs(puff, ctx.hairFill, ctx.c.hairLine) + ellipse(CX, 34, 42, 28, ctx.hairFill) + curlHighlights(ctx, puff.filter(([, y]) => y < 34));
      },
      front: (ctx) => hairPaint(ctx, domeFront(ctx, { top: 54, width: 82, hairline: 100, sideY: 156 })) +
        line(`M${pt(CX - 50, 98)} C${pt(CX - 30, 70)} ${pt(CX - 12, 60)} ${pt(CX - 4, 58)} M${pt(CX + 50, 98)} C${pt(CX + 30, 70)} ${pt(CX + 12, 60)} ${pt(CX + 4, 58)}`, ctx.c.hairLine, 2) +
        path(`M${pt(CX - 16, 60)} h32 v-10 h-32 Z`, "#EF6F56", "#9B3B2A", 2.5),
    },
    twopuffs: {
      top: 30,
      back: (ctx) => {
        const a = curlRing(CX - 72, 64, 34, 30, 13, 13);
        const b = curlRing(CX + 72, 64, 34, 30, 13, 13);
        return blobs([...a, ...b], ctx.hairFill, ctx.c.hairLine) + ellipse(CX - 72, 64, 32, 28, ctx.hairFill) + ellipse(CX + 72, 64, 32, 28, ctx.hairFill) + curlHighlights(ctx, [...a, ...b].filter(([, y]) => y < 64));
      },
      front: (ctx) => hairPaint(ctx, `${domeFront(ctx, { top: 54, width: 82, hairline: 100, sideY: 156 })}`) + line(`M${pt(CX, 54)} V98`, ctx.c.hairLine, 2.5),
    },
    curlybob: {
      top: 30,
      back: (ctx) => {
        const ring = curlRing(CX, 150, 104, 92, 24, 22, -Math.PI * 1.1, Math.PI * 0.1);
        const lower = curlRing(CX, 150, 96, 92, 10, 22, Math.PI * 0.12, Math.PI * 0.88);
        return ellipse(CX, 148, 100, 88, ctx.c.hairLine) + blobs([...ring, ...lower], ctx.hairFill, ctx.c.hairLine) + ellipse(CX, 146, 98, 84, ctx.hairFill) + curlHighlights(ctx, ring);
      },
      front: (ctx) => {
        const fringe = curlRing(CX, 122, 74, 30, 9, 15, Math.PI * 1.04, Math.PI * 1.96, 0.14);
        const sides = [[CX - 84, 160, 16], [CX - 88, 190, 15], [CX + 84, 160, 16], [CX + 88, 190, 15]];
        return blobs([...fringe, ...sides], ctx.hairFill, ctx.c.hairLine) + curlHighlights(ctx, fringe);
      },
    },
    curlylong: {
      top: 30,
      back: (ctx) => {
        const pts = [...curlRing(CX, 150, 104, 92, 22, 22, -Math.PI * 1.06, Math.PI * 0.06)];
        for (let y = 200; y <= 330; y += 26) for (const s of [-1, 1]) pts.push([CX + s * (96 - (y - 200) * 0.05), y, 22], [CX + s * (70 - (y - 200) * 0.1), y + 12, 20]);
        return path(`M${pt(CX - 100, 140)} C${pt(CX - 104, 40)} ${pt(CX + 104, 40)} ${pt(CX + 100, 140)} L${pt(CX + 96, 336)} L${pt(CX - 96, 336)} Z`, ctx.c.hairLine) +
          blobs(pts, ctx.hairFill, ctx.c.hairLine) + path(`M${pt(CX - 96, 140)} C${pt(CX - 100, 48)} ${pt(CX + 100, 48)} ${pt(CX + 96, 140)} L${pt(CX + 90, 330)} L${pt(CX - 90, 330)} Z`, ctx.hairFill) + curlHighlights(ctx, pts);
      },
      front: (ctx) => {
        const fringe = curlRing(CX, 122, 74, 30, 9, 15, Math.PI * 1.04, Math.PI * 1.96, 0.14);
        const sides = [[CX - 84, 158, 16], [CX - 88, 186, 15], [CX - 90, 214, 15], [CX + 84, 158, 16], [CX + 88, 186, 15], [CX + 90, 214, 15]];
        return blobs([...fringe, ...sides], ctx.hairFill, ctx.c.hairLine) + curlHighlights(ctx, [...fringe, ...sides]);
      },
    },
    locs: {
      top: 40,
      back: (ctx) => {
        const strands = [];
        for (let i = 0; i < 9; i += 1) {
          const x = CX - 96 + i * 24;
          const len = 300 + (i % 3) * 22;
          strands.push(tube(`M${pt(x, 110)} C${pt(x - 4, 200)} ${pt(x + 6, 250)} ${pt(x + (i - 4) * 3, len)}`, 15, ctx.hairFill, ctx.c.hairLine, 2.5));
        }
        return strands.join("");
      },
      front: (ctx) => {
        let out = hairPaint(ctx, domeFront(ctx, { top: 40, width: 88, hairline: 98, sideY: 150 }));
        for (const s of [-1, 1]) for (let i = 0; i < 3; i += 1) {
          const x = CX + s * (64 + i * 10);
          out += tube(`M${pt(x, 104 + i * 4)} C${pt(x + s * 4, 160)} ${pt(x + s * 8, 210)} ${pt(x + s * 10, 252 + i * 8)}`, 13, ctx.hairFill, ctx.c.hairLine, 2.5);
        }
        out += line(`M${pt(CX - 50, 70)} q24 -12 48 -6`, ctx.c.hairLight, 4, ' opacity="0.7"');
        for (let i = -2; i <= 2; i += 1) out += line(`M${pt(CX + i * 20, 54)} C${pt(CX + i * 24, 70)} ${pt(CX + i * 24, 86)} ${pt(CX + i * 22, 98)}`, ctx.c.hairLine, 2);
        return out;
      },
    },
    braids: {
      top: 42,
      back: (ctx) => {
        const strands = [];
        for (let i = 0; i < 12; i += 1) {
          const x = CX - 100 + i * 18.2;
          strands.push(tube(`M${pt(x, 110)} C${pt(x - 2, 220)} ${pt(x + 4, 300)} ${pt(x + (i - 6) * 2, 392)}`, 10, ctx.hairFill, ctx.c.hairLine, 2));
          strands.push(line(`M${pt(x, 120)} C${pt(x - 2, 220)} ${pt(x + 4, 300)} ${pt(x + (i - 6) * 2, 386)}`, ctx.c.hairLight, 5, ' stroke-dasharray="2 6" opacity="0.6"'));
        }
        return strands.join("") + both(circle(CX - 70, 396, 5, "#E7B43C", "#8A5F12", 1.5));
      },
      front: (ctx) => {
        let out = hairPaint(ctx, domeFront(ctx, { top: 42, width: 88, hairline: 96, sideY: 150 })) + line(`M${pt(CX, 44)} V96`, ctx.c.hairLine, 2.5);
        for (const s of [-1, 1]) for (let i = 0; i < 2; i += 1) {
          const x = CX + s * (68 + i * 12);
          out += tube(`M${pt(x, 104)} C${pt(x + s * 4, 180)} ${pt(x + s * 8, 240)} ${pt(x + s * 10, 300)}`, 10, ctx.hairFill, ctx.c.hairLine, 2) +
            line(`M${pt(x, 112)} C${pt(x + s * 4, 180)} ${pt(x + s * 8, 240)} ${pt(x + s * 10, 294)}`, ctx.c.hairLight, 5, ' stroke-dasharray="2 6" opacity="0.6"');
        }
        return out;
      },
    },
    wavybob: {
      top: 44,
      back: (ctx) => hairPaint(ctx, `M${pt(CX - 98, 130)} C${pt(CX - 104, 40)} ${pt(CX + 104, 40)} ${pt(CX + 98, 130)} C${pt(CX + 104, 170)} ${pt(CX + 96, 200)} ${pt(CX + 104, 236)} C${pt(CX + 86, 252)} ${pt(CX + 70, 236)} ${pt(CX + 54, 248)} L${pt(CX - 54, 248)} C${pt(CX - 70, 236)} ${pt(CX - 86, 252)} ${pt(CX - 104, 236)} C${pt(CX - 96, 200)} ${pt(CX - 104, 170)} ${pt(CX - 98, 130)} Z`),
      front: (ctx) => {
        const d = `M${pt(CX - 92, 236)} C${pt(CX - 104, 180)} ${pt(CX - 104, 90)} ${pt(CX - 60, 58)} C${pt(CX - 20, 34)} ${pt(CX + 50, 38)} ${pt(CX + 80, 74)} C${pt(CX + 100, 110)} ${pt(CX + 98, 190)} ${pt(CX + 92, 236)} ` +
          `C${pt(CX + 82, 230)} ${pt(CX + 76, 210)} ${pt(CX + 74, 190)} C${pt(CX + 72, 150)} ${pt(CX + 70, 120)} ${pt(CX + 56, 104)} ` +
          `C${pt(CX + 20, 90)} ${pt(CX - 30, 112)} ${pt(CX - 60, 140)} C${pt(CX - 70, 170)} ${pt(CX - 72, 210)} ${pt(CX - 80, 232)} Z`;
        return hairPaint(ctx, d) + shine(ctx, `M${pt(CX - 50, 76)} q34 -20 80 -4`) + line(`M${pt(CX + 80, 150)} q-8 30 2 60 M${pt(CX - 86, 150)} q8 30 -2 60`, ctx.c.hairLine, 2);
      },
    },
    wavylong: {
      top: 44,
      back: (ctx) => hairPaint(ctx, `M${pt(CX - 98, 130)} C${pt(CX - 104, 40)} ${pt(CX + 104, 40)} ${pt(CX + 98, 130)} C${pt(CX + 112, 200)} ${pt(CX + 92, 260)} ${pt(CX + 108, 330)} C${pt(CX + 96, 360)} ${pt(CX + 80, 350)} ${pt(CX + 70, 366)} L${pt(CX - 70, 366)} C${pt(CX - 80, 350)} ${pt(CX - 96, 360)} ${pt(CX - 108, 330)} C${pt(CX - 92, 260)} ${pt(CX - 112, 200)} ${pt(CX - 98, 130)} Z`),
      front: (ctx) => {
        const d = `M${pt(CX - 96, 300)} C${pt(CX - 110, 220)} ${pt(CX - 104, 90)} ${pt(CX - 60, 58)} C${pt(CX - 24, 36)} ${pt(CX + 24, 36)} ${pt(CX + 60, 58)} C${pt(CX + 104, 90)} ${pt(CX + 110, 220)} ${pt(CX + 96, 300)} ` +
          `C${pt(CX + 86, 280)} ${pt(CX + 88, 240)} ${pt(CX + 76, 200)} C${pt(CX + 70, 150)} ${pt(CX + 64, 110)} ${pt(CX + 6, 92)} ` +
          `C${pt(CX - 64, 110)} ${pt(CX - 70, 150)} ${pt(CX - 76, 200)} C${pt(CX - 88, 240)} ${pt(CX - 86, 280)} ${pt(CX - 96, 300)} Z`;
        return hairPaint(ctx, d) + line(`M${pt(CX + 4, 48)} q4 24 2 44`, ctx.c.hairLine, 2.5) + shine(ctx, `M${pt(CX - 56, 80)} q20 -22 46 -26`) +
          line(`M${pt(CX + 88, 160)} q-12 40 4 90 M${pt(CX - 88, 160)} q12 40 -4 90`, ctx.c.hairLine, 2);
      },
    },
    straightlong: {
      top: 44,
      back: (ctx) => hairPaint(ctx, `M${pt(CX - 96, 130)} C${pt(CX - 104, 40)} ${pt(CX + 104, 40)} ${pt(CX + 96, 130)} L${pt(CX + 102, 372)} Q${pt(CX, 384)} ${pt(CX - 102, 372)} Z`),
      front: (ctx) => {
        const d = `M${pt(CX - 98, 320)} L${pt(CX - 96, 130)} C${pt(CX - 98, 70)} ${pt(CX - 50, 46)} ${pt(CX, 46)} C${pt(CX + 50, 46)} ${pt(CX + 98, 70)} ${pt(CX + 96, 130)} L${pt(CX + 98, 320)} ` +
          `L${pt(CX + 78, 320)} L${pt(CX + 76, 150)} C${pt(CX + 72, 110)} ${pt(CX + 40, 92)} ${pt(CX + 4, 90)} C${pt(CX - 40, 92)} ${pt(CX - 72, 110)} ${pt(CX - 76, 150)} L${pt(CX - 78, 320)} Z`;
        return hairPaint(ctx, d) + line(`M${pt(CX + 2, 48)} V90`, ctx.c.hairLine, 2.5) + shine(ctx, `M${pt(CX - 60, 76)} q24 -22 50 -26`) + shine(ctx, `M${pt(CX + 86, 170)} v100`);
      },
    },
    ponytail: {
      top: 46,
      back: (ctx) => hairPaint(ctx, `M${pt(CX + 70, 70)} C${pt(CX + 130, 70)} ${pt(CX + 136, 150)} ${pt(CX + 116, 220)} C${pt(CX + 104, 260)} ${pt(CX + 118, 290)} ${pt(CX + 108, 312)} C${pt(CX + 88, 280)} ${pt(CX + 84, 220)} ${pt(CX + 92, 160)} C${pt(CX + 96, 120)} ${pt(CX + 84, 96)} ${pt(CX + 64, 92)} Z`) +
        shine(ctx, `M${pt(CX + 112, 120)} q6 40 -6 90`),
      front: (ctx) => {
        const fringe = `C${pt(CX + 24, 96)} ${pt(CX - 20, 98)} ${pt(CX - 54, 108)} `;
        return hairPaint(ctx, domeFront(ctx, { top: 46, width: 86, hairline: 100, sideY: 158, fringe })) +
          path(`M${pt(CX + 70, 66)} l14 -8 l8 14 l-14 8 Z`, "#EF6F56", "#9B3B2A", 2.5) + line(`M${pt(CX - 50, 100)} C${pt(CX - 30, 70)} ${pt(CX + 20, 56)} ${pt(CX + 70, 68)}`, ctx.c.hairLine, 2) + shine(ctx, `M${pt(CX - 30, 62)} q30 -12 60 -4`);
      },
    },
    bun: {
      top: 8,
      back: (ctx) => circle(CX, 40, 34, ctx.hairFill, ctx.c.hairLine) + line(`M${pt(CX - 20, 30)} C${pt(CX - 6, 16)} ${pt(CX + 20, 22)} ${pt(CX + 22, 40)} M${pt(CX - 18, 50)} C${pt(CX - 4, 62)} ${pt(CX + 14, 56)} ${pt(CX + 20, 50)}`, ctx.c.hairLine, 2.5) + shine(ctx, `M${pt(CX - 14, 22)} q12 -6 24 0`),
      front: (ctx) => hairPaint(ctx, domeFront(ctx, { top: 52, width: 84, hairline: 98, sideY: 158 })) +
        line(`M${pt(CX - 52, 100)} C${pt(CX - 34, 76)} ${pt(CX - 14, 64)} ${pt(CX - 4, 58)} M${pt(CX + 52, 100)} C${pt(CX + 34, 76)} ${pt(CX + 14, 64)} ${pt(CX + 4, 58)}`, ctx.c.hairLine, 2) +
        path(`M${pt(CX - 26, 66)} q26 -12 52 0 l-2 -10 q-24 -10 -48 0 Z`, "#2F8F88", "#1C5753", 2.5),
    },
    pixie: {
      top: 42,
      front: (ctx) => {
        const fringe = `C${pt(CX + 30, 104)} ${pt(CX + 6, 112)} ${pt(CX - 16, 120)} C${pt(CX - 34, 126)} ${pt(CX - 50, 132)} ${pt(CX - 62, 140)} `;
        return hairPaint(ctx, domeFront(ctx, { top: 42, width: 88, hairline: 102, sideY: 172, fringe })) +
          line(`M${pt(CX + 40, 60)} C${pt(CX + 10, 80)} ${pt(CX - 20, 100)} ${pt(CX - 48, 128)} M${pt(CX + 60, 78)} C${pt(CX + 30, 96)} ${pt(CX + 10, 104)} ${pt(CX - 10, 114)}`, ctx.c.hairLine, 2) + shine(ctx, `M${pt(CX - 30, 62)} q30 -12 60 -2`);
      },
    },
    shag: {
      top: 40,
      back: (ctx) => hairPaint(ctx, `M${pt(CX - 100, 130)} C${pt(CX - 106, 36)} ${pt(CX + 106, 36)} ${pt(CX + 100, 130)} C${pt(CX + 110, 190)} ${pt(CX + 100, 240)} ${pt(CX + 112, 298)} L${pt(CX + 90, 286)} L${pt(CX + 86, 306)} L${pt(CX + 66, 290)} L${pt(CX - 66, 290)} L${pt(CX - 86, 306)} L${pt(CX - 90, 286)} L${pt(CX - 112, 298)} C${pt(CX - 100, 240)} ${pt(CX - 110, 190)} ${pt(CX - 100, 130)} Z`),
      front: (ctx) => {
        const d = `M${pt(CX - 100, 250)} C${pt(CX - 112, 170)} ${pt(CX - 106, 70)} ${pt(CX - 50, 48)} C${pt(CX - 20, 36)} ${pt(CX + 20, 36)} ${pt(CX + 50, 48)} C${pt(CX + 106, 70)} ${pt(CX + 112, 170)} ${pt(CX + 100, 250)} ` +
          `L${pt(CX + 84, 230)} L${pt(CX + 80, 180)} C${pt(CX + 76, 140)} ${pt(CX + 60, 118)} ${pt(CX + 36, 120)} C${pt(CX + 20, 112)} ${pt(CX + 10, 104)} ${pt(CX + 2, 96)} ` +
          `C${pt(CX - 10, 104)} ${pt(CX - 20, 112)} ${pt(CX - 36, 120)} C${pt(CX - 60, 118)} ${pt(CX - 76, 140)} ${pt(CX - 80, 180)} L${pt(CX - 84, 230)} Z`;
        return hairPaint(ctx, d) + shine(ctx, `M${pt(CX - 56, 70)} q24 -18 48 -18`) + line(`M${pt(CX + 92, 160)} l-6 50 M${pt(CX - 92, 160)} l6 50`, ctx.c.hairLine, 2);
      },
    },
  };

  // ---------- face ----------
  const eyeShapes = {
    almond: { w: 30, up: 11, low: 8, tilt: 2, crease: true },
    round: { w: 28, up: 14, low: 12, tilt: 0, crease: true },
    hooded: { w: 30, up: 9, low: 8, tilt: 1, hood: true },
    monolid: { w: 31, up: 8, low: 7, tilt: 3, crease: false },
    upturned: { w: 30, up: 11, low: 7, tilt: 6, crease: true },
    downturned: { w: 30, up: 11, low: 8, tilt: -4, crease: true },
    wide: { w: 34, up: 13, low: 10, tilt: 1, crease: true },
    joyful: { w: 30, joyful: true },
  };

  function eyes(ctx) {
    const shape = eyeShapes[ctx.config.eyes];
    const { c } = ctx;
    const details = ctx.config.details;
    const liner = ctx.config.liner;
    let out = "";
    for (const s of [-1, 1]) {
      const ex = CX + s * EYE_DX;
      const ey = EYE_Y;
      const inner = [ex - s * shape.w / 2, ey];
      const outer = [ex + s * shape.w / 2, ey - (shape.tilt || 0)];
      if (shape.joyful) {
        out += line(`M${pt(ex - 14, ey + 3)} Q${pt(ex, ey - 12)} ${pt(ex + 14, ey + 3)}`, c.ink, 4.2);
        if (liner === "wing") out += line(`M${pt(ex + s * 14, ey + 2)} l${n(s * 8)} -6`, c.ink, 3);
        continue;
      }
      const upper = `M${pt(...inner)} C${pt(inner[0] + s * shape.w * 0.16, ey - shape.up)} ${pt(outer[0] - s * shape.w * 0.22, ey - shape.up - (shape.tilt || 0))} ${pt(...outer)}`;
      const opening = `${upper} C${pt(outer[0] - s * shape.w * 0.2, ey + shape.low - (shape.tilt || 0) * 0.3)} ${pt(inner[0] + s * shape.w * 0.2, ey + shape.low)} ${pt(...inner)} Z`;
      if (liner === "shadow") out += path(`M${pt(inner[0], ey - 2)} C${pt(inner[0] + s * 6, ey - shape.up - 12)} ${pt(outer[0] - s * 6, ey - shape.up - 12 - (shape.tilt || 0))} ${pt(outer[0] + s * 3, outer[1] - 2)} Z`, "#9C6FA8", null, 0, ' opacity="0.45"');
      const clipAttr = ctx.clip(`eye${s}`, `<path d="${opening}"/>`);
      out += path(opening, "#FFFDF8");
      const iris = ctx.radial(`iris${s}`, [[0, light(c.eye, 0.25)], [0.7, c.eye], [1, dark(c.eye, 0.35)]], 0.45, 0.4, 0.6);
      out += group(circle(ex, ey + 1, 9.5, iris) + circle(ex, ey + 1, 4.6, "#140C0A") + circle(ex - 3, ey - 3, 2.6, "#FFFFFF") + circle(ex + 3, ey + 4, 1.2, "#FFFFFF", null, 0, ' opacity="0.8"') +
        path(`M${pt(inner[0] - s * 4, ey - 20)} H${n(outer[0] + s * 4)} V${n(ey - shape.up + 3)} H${n(inner[0] - s * 4)} Z`, dark(c.skin, 0.2), null, 0, ' opacity="0.12"'), clipAttr);
      out += line(upper, c.ink, liner === "soft" || liner === "wing" ? 4.6 : 3.6);
      if (liner === "wing") out += line(`M${pt(...outer)} l${n(s * 9)} -7`, c.ink, 3.4);
      if (details.includes("lashes")) out += line(`M${pt(outer[0] - s * 2, outer[1] - 2)} l${n(s * 6)} -6 M${pt(outer[0] - s * 7, outer[1] - 5)} l${n(s * 4)} -7`, c.ink, 2.2);
      out += line(`M${pt(inner[0] + s * 6, ey + shape.low - 1)} Q${pt(ex, ey + shape.low + 2)} ${pt(outer[0] - s * 5, outer[1] + shape.low - 2)}`, c.skinLine, 1.4, ' opacity="0.45"');
      if (shape.crease) out += line(`M${pt(inner[0] + s * 5, ey - shape.up - 3)} Q${pt(ex, ey - shape.up - 9)} ${pt(outer[0] - s * 3, outer[1] - shape.up + 1)}`, c.skinLine, 1.6, ' opacity="0.45"');
      if (shape.hood) out += line(`M${pt(inner[0] + s * 4, ey - shape.up + 1)} Q${pt(ex, ey - shape.up - 6)} ${pt(outer[0] + s * 1, outer[1] - 1)}`, c.skinShadow, 4, ' opacity="0.9"');
    }
    return out;
  }

  const browShapes = {
    soft: { inner: 4, outer: 2.6, arch: 6, lift: 0 },
    straight: { inner: 4.4, outer: 3.2, arch: 1, lift: 0 },
    arched: { inner: 3.8, outer: 2.2, arch: 11, lift: 2 },
    thick: { inner: 7, outer: 5, arch: 4, lift: 0 },
    thin: { inner: 2.4, outer: 1.6, arch: 6, lift: 1 },
    angled: { inner: 4.6, outer: 2.4, arch: 8, lift: -4, peak: 0.65 },
    rounded: { inner: 4.2, outer: 3, arch: 9, lift: 2, peak: 0.4 },
    bushy: { inner: 7.4, outer: 6, arch: 5, lift: 0, bushy: true },
  };
  function eyebrows(ctx) {
    const b = browShapes[ctx.config.brows];
    const color = ctx.config.hair === "bald" || ctx.config.hair === "buzz" ? dark(mix(ctx.c.hair, ctx.c.skin, 0.2), 0.1) : dark(ctx.c.hair, 0.08);
    let out = "";
    for (const s of [-1, 1]) {
      const ix = CX + s * 13;
      const ox = CX + s * 52;
      const y = EYE_Y - 26;
      const px = CX + s * (13 + 39 * (b.peak ?? 0.55));
      const top = `M${pt(ix, y + 2 - b.inner)} Q${pt(px, y - b.arch - b.inner * 0.6)} ${pt(ox, y + 6 - b.lift - b.outer * 0.5)}`;
      const bottom = `Q${pt(px, y - b.arch + b.inner * 0.9)} ${pt(ix, y + 2 + b.inner * 0.4)} Z`;
      out += path(`${top} L${pt(ox, y + 6 - b.lift + b.outer * 0.5)} ${bottom}`, color, dark(color, 0.2), 1.2);
      if (b.bushy) out += line(`M${pt(ix + s * 6, y - 2)} l${n(s * 6)} -5 M${pt(ix + s * 16, y - 5)} l${n(s * 6)} -5 M${pt(ix + s * 26, y - 6)} l${n(s * 6)} -4`, dark(color, 0.3), 1.6);
    }
    return out;
  }

  function nose(ctx) {
    const { c } = ctx;
    const w = { button: 10, rounded: 13, straight: 9, wide: 17, aquiline: 10, petite: 7 }[ctx.config.nose];
    const len = { button: 0, rounded: 2, straight: 6, wide: 2, aquiline: 8, petite: -4 }[ctx.config.nose];
    const y = 190 + len * 0.3;
    let out = path(`M${pt(CX - w - 4, y + 2)} Q${pt(CX, y + 10)} ${pt(CX + w + 4, y + 2)} Q${pt(CX, y + 16)} ${pt(CX - w - 4, y + 2)} Z`, c.skinShadow, null, 0, ' opacity="0.55"');
    out += line(`M${pt(CX - w, y - 2)} Q${pt(CX - w - 5, y + 6)} ${pt(CX - w + 4, y + 7)} M${pt(CX + w, y - 2)} Q${pt(CX + w + 5, y + 6)} ${pt(CX + w - 4, y + 7)}`, c.skinLine, 2.4);
    out += line(`M${pt(CX - 4, y + 8)} Q${pt(CX, y + 10)} ${pt(CX + 4, y + 8)}`, c.skinLine, 2, ' opacity="0.7"');
    const bridgeTop = 168 - len;
    out += line(`M${pt(CX + 7, bridgeTop)} ${ctx.config.nose === "aquiline" ? `Q${pt(CX + 14, y - 14)} ${pt(CX + w - 2, y - 4)}` : `Q${pt(CX + 9, y - 12)} ${pt(CX + w - 3, y - 3)}`}`, c.skinShadow, 2.6, ' opacity="0.8"');
    out += ellipse(CX - 3, y - 2, 4, 3, "#FFFFFF", ' opacity="0.28"');
    if (ctx.config.details.includes("rosy")) out += ellipse(CX, y + 2, w + 2, 7, "#E06C6C", ' opacity="0.28"');
    return out;
  }

  function mouth(ctx) {
    const { c } = ctx;
    const y = MOUTH_Y;
    const lip = c.lips;
    const lineColor = lip ? dark(lip, 0.25) : dark(c.skin, 0.55);
    const inner = "#6B2A2A";
    const teeth = "#FFFDF8";
    const tongue = "#E07A7A";
    const lipFill = (d) => (lip ? path(d, lip, dark(lip, 0.3), 1.6) : "");
    switch (ctx.config.mouth) {
      case "smile":
        return lipFill(`M${pt(CX - 20, y - 2)} Q${pt(CX, y + 14)} ${pt(CX + 20, y - 2)} Q${pt(CX, y + 6)} ${pt(CX - 20, y - 2)} Z`) +
          line(`M${pt(CX - 20, y - 2)} Q${pt(CX, y + 12)} ${pt(CX + 20, y - 2)}`, lineColor, 3.4) + line(`M${pt(CX - 22, y - 4)} q2 3 4 3 M${pt(CX + 22, y - 4)} q-2 3 -4 3`, lineColor, 2);
      case "grin":
        return path(`M${pt(CX - 24, y - 4)} Q${pt(CX, y + 22)} ${pt(CX + 24, y - 4)} Z`, inner, lineColor, 3) +
          path(`M${pt(CX - 22, y - 3)} L${pt(CX + 22, y - 3)} Q${pt(CX + 16, y + 4)} ${pt(CX, y + 4)} Q${pt(CX - 16, y + 4)} ${pt(CX - 22, y - 3)} Z`, teeth) + (lip ? line(`M${pt(CX - 24, y - 4)} Q${pt(CX, y + 22)} ${pt(CX + 24, y - 4)}`, lip, 3.4) : "");
      case "laugh":
        return path(`M${pt(CX - 24, y - 6)} Q${pt(CX, y - 8)} ${pt(CX + 24, y - 6)} Q${pt(CX + 20, y + 24)} ${pt(CX, y + 24)} Q${pt(CX - 20, y + 24)} ${pt(CX - 24, y - 6)} Z`, inner, lineColor, 3) +
          path(`M${pt(CX - 20, y - 6)} H${n(CX + 20)} Q${pt(CX + 18, y)} ${pt(CX, y)} Q${pt(CX - 18, y)} ${pt(CX - 20, y - 6)} Z`, teeth) + ellipse(CX, y + 16, 11, 6, tongue);
      case "smirk":
        return lipFill(`M${pt(CX - 16, y + 1)} Q${pt(CX + 4, y + 8)} ${pt(CX + 20, y - 6)} Q${pt(CX + 4, y + 3)} ${pt(CX - 16, y + 1)} Z`) + line(`M${pt(CX - 16, y + 2)} Q${pt(CX + 6, y + 8)} ${pt(CX + 20, y - 6)}`, lineColor, 3.4);
      case "calm":
        return lipFill(`M${pt(CX - 16, y)} Q${pt(CX, y + 8)} ${pt(CX + 16, y)} Q${pt(CX, y - 4)} ${pt(CX - 16, y)} Z`) + line(`M${pt(CX - 15, y + 1)} Q${pt(CX, y + 4)} ${pt(CX + 15, y + 1)}`, lineColor, 3.2);
      case "soft":
        return path(`M${pt(CX - 18, y - 2)} Q${pt(CX, y + 14)} ${pt(CX + 18, y - 2)} Q${pt(CX, y + 2)} ${pt(CX - 18, y - 2)} Z`, inner, lineColor, 2.6) +
          path(`M${pt(CX - 14, y)} Q${pt(CX, y + 3)} ${pt(CX + 14, y)} L${pt(CX + 12, y + 3)} Q${pt(CX, y + 5)} ${pt(CX - 12, y + 3)} Z`, teeth) + (lip ? line(`M${pt(CX - 18, y - 2)} Q${pt(CX, y + 14)} ${pt(CX + 18, y - 2)}`, lip, 3) : "");
      case "wow":
        return ellipse(CX, y + 4, 9, 12, inner, ` stroke="${lip || lineColor}" stroke-width="${lip ? 4 : 3}"`) + ellipse(CX, y + 10, 6, 4, tongue);
      case "focused":
        return lipFill(`M${pt(CX - 16, y + 2)} Q${pt(CX, y + 6)} ${pt(CX + 16, y + 2)} Q${pt(CX, y - 2)} ${pt(CX - 16, y + 2)} Z`) + line(`M${pt(CX - 15, y + 3)} L${pt(CX + 15, y + 2)}`, lineColor, 3.2) + line(`M${pt(CX - 6, y + 9)} q6 2 12 0`, c.skinLine, 1.6, ' opacity="0.5"');
      case "cheeky":
        return path(`M${pt(CX - 20, y - 2)} Q${pt(CX + 2, y + 18)} ${pt(CX + 22, y - 8)} Q${pt(CX + 2, y + 4)} ${pt(CX - 20, y - 2)} Z`, inner, lineColor, 3) +
          path(`M${pt(CX - 16, y)} Q${pt(CX + 2, y + 4)} ${pt(CX + 18, y - 5)} L${pt(CX + 16, y - 2)} Q${pt(CX + 2, y + 7)} ${pt(CX - 14, y + 3)} Z`, teeth) + ellipse(CX + 6, y + 9, 6, 3.5, tongue);
      case "beam":
        return path(`M${pt(CX - 28, y - 6)} Q${pt(CX, y + 26)} ${pt(CX + 28, y - 6)} Q${pt(CX, y - 2)} ${pt(CX - 28, y - 6)} Z`, inner, lineColor, 3) +
          path(`M${pt(CX - 24, y - 4)} Q${pt(CX, y)} ${pt(CX + 24, y - 4)} L${pt(CX + 20, y + 3)} Q${pt(CX, y + 6)} ${pt(CX - 20, y + 3)} Z`, teeth) + (lip ? line(`M${pt(CX - 28, y - 6)} Q${pt(CX, y + 26)} ${pt(CX + 28, y - 6)}`, lip, 3.4) : "");
      default: return "";
    }
  }

  function faceDetails(ctx) {
    const { c, config } = ctx;
    let out = "";
    if (config.blush !== "none") {
      const blush = ctx.radial("blush", [[0, "#F07A7A", config.blush === "rosy" ? 0.55 : 0.32], [1, "#F07A7A", 0]]);
      out += ellipse(CX - 46, 192, 20, 13, blush) + ellipse(CX + 46, 192, 20, 13, blush);
    }
    if (config.details.includes("vitiligo")) {
      const patch = light(mix(c.skin, "#F6E6DA", 0.6), 0.25);
      out += path(`M${pt(CX + 22, 140)} C${pt(CX + 40, 128)} ${pt(CX + 66, 136)} ${pt(CX + 68, 154)} C${pt(CX + 72, 176)} ${pt(CX + 54, 182)} ${pt(CX + 44, 176)} C${pt(CX + 30, 168)} ${pt(CX + 14, 156)} ${pt(CX + 22, 140)} Z`, patch, null, 0, ' opacity="0.95"') +
        path(`M${pt(CX - 30, 226)} C${pt(CX - 18, 218)} ${pt(CX - 2, 224)} ${pt(CX + 2, 236)} L${pt(CX - 24, 240)} C${pt(CX - 34, 236)} ${pt(CX - 36, 230)} ${pt(CX - 30, 226)} Z`, patch, null, 0, ' opacity="0.95"');
    }
    if (config.details.includes("freckles")) {
      const spots = [[-44, 178], [-36, 186], [-50, 188], [-28, 180], [-40, 196], [44, 178], [36, 186], [50, 188], [28, 180], [40, 196], [-8, 176], [8, 178]];
      out += spots.map(([x, y]) => circle(CX + x, y, 1.8, dark(c.skin, 0.35), null, 0, ' opacity="0.7"')).join("");
    }
    if (config.details.includes("beautymark")) out += circle(CX + 30, 214, 2.6, dark(c.skin, 0.6));
    if (config.details.includes("dimples")) out += line(`M${pt(CX - 30, 204)} q-2 6 0 10 M${pt(CX + 30, 204)} q2 6 0 10`, c.skinLine, 2, ' opacity="0.55"');
    return out;
  }

  function facialHairLayer(ctx, part) {
    const { c, config, face } = ctx;
    const style = config.facialHair;
    if (style === "none") return "";
    const color = c.hair;
    const clipFace = ctx.clip(`beard-${part}`, `<path d="${facePath(face)}"/>`);
    const mustache = path(`M${pt(CX - 26, MOUTH_Y - 4)} C${pt(CX - 20, MOUTH_Y - 18)} ${pt(CX - 6, MOUTH_Y - 16)} ${pt(CX, MOUTH_Y - 12)} C${pt(CX + 6, MOUTH_Y - 16)} ${pt(CX + 20, MOUTH_Y - 18)} ${pt(CX + 26, MOUTH_Y - 4)} C${pt(CX + 14, MOUTH_Y - 8)} ${pt(CX + 6, MOUTH_Y - 8)} ${pt(CX, MOUTH_Y - 6)} C${pt(CX - 6, MOUTH_Y - 8)} ${pt(CX - 14, MOUTH_Y - 8)} ${pt(CX - 26, MOUTH_Y - 4)} Z`, ctx.hairFill, c.hairLine, 2);
    const goatee = path(`M${pt(CX - 20, MOUTH_Y + 12)} C${pt(CX - 20, face.chinY + 6)} ${pt(CX + 20, face.chinY + 6)} ${pt(CX + 20, MOUTH_Y + 12)} C${pt(CX + 10, MOUTH_Y + 18)} ${pt(CX - 10, MOUTH_Y + 18)} ${pt(CX - 20, MOUTH_Y + 12)} Z`, ctx.hairFill, c.hairLine, 2);
    const beardRegion = `M${pt(CX - 110, 158)} C${pt(CX - 70, 168)} ${pt(CX - 62, 196)} ${pt(CX - 38, 200)} C${pt(CX - 20, 194)} ${pt(CX + 20, 194)} ${pt(CX + 38, 200)} C${pt(CX + 62, 196)} ${pt(CX + 70, 168)} ${pt(CX + 110, 158)} L${pt(CX + 110, 280)} L${pt(CX - 110, 280)} Z`;
    if (part === "beard") {
      switch (style) {
        case "stubble": return group(path(beardRegion, mix(color, c.skin, 0.45), null, 0, ' opacity="0.55"'), clipFace);
        case "chinstrap": return group(group(line(facePath(face), color, 18), ctx.clip("strap", `<rect x="0" y="172" width="400" height="200"/>`)), clipFace);
        case "short": return group(path(beardRegion, ctx.hairFill), clipFace) + line(`M${pt(CX - 60, 212)} Q${pt(CX, face.chinY + 8)} ${pt(CX + 60, 212)}`, c.hairLine, 2, ' opacity="0.5"');
        case "full": return group(path(beardRegion, ctx.hairFill), clipFace) + path(`M${pt(CX - face.jaw * 0.9, 212)} Q${pt(CX, face.chinY + 30)} ${pt(CX + face.jaw * 0.9, 212)} Q${pt(CX, face.chinY + 4)} ${pt(CX - face.jaw * 0.9, 212)} Z`, ctx.hairFill, c.hairLine, 2.5);
        case "long": return group(path(beardRegion, ctx.hairFill), clipFace) + path(`M${pt(CX - face.jaw * 0.92, 210)} C${pt(CX - 40, face.chinY + 40)} ${pt(CX - 10, face.chinY + 58)} ${pt(CX, face.chinY + 62)} C${pt(CX + 10, face.chinY + 58)} ${pt(CX + 40, face.chinY + 40)} ${pt(CX + face.jaw * 0.92, 210)} Q${pt(CX, face.chinY + 4)} ${pt(CX - face.jaw * 0.92, 210)} Z`, ctx.hairFill, c.hairLine, 2.5) +
          line(`M${pt(CX - 14, face.chinY + 14)} q4 20 10 34 M${pt(CX + 12, face.chinY + 14)} q-2 20 -8 34`, c.hairLight, 2.4, ' opacity="0.6"');
        case "goatee": case "vandyke": return goatee;
        case "soulpatch": return path(`M${pt(CX - 6, MOUTH_Y + 14)} Q${pt(CX, MOUTH_Y + 26)} ${pt(CX + 6, MOUTH_Y + 14)} Z`, ctx.hairFill, c.hairLine, 1.6);
        default: return "";
      }
    }
    // part === "mustache": drawn over the mouth
    if (["mustache", "vandyke", "short", "full", "long"].includes(style)) return mustache;
    if (style === "goatee") return path(`M${pt(CX - 18, MOUTH_Y - 6)} C${pt(CX - 12, MOUTH_Y - 14)} ${pt(CX + 12, MOUTH_Y - 14)} ${pt(CX + 18, MOUTH_Y - 6)} C${pt(CX + 8, MOUTH_Y - 9)} ${pt(CX - 8, MOUTH_Y - 9)} ${pt(CX - 18, MOUTH_Y - 6)} Z`, ctx.hairFill, c.hairLine, 1.6) +
      line(`M${pt(CX - 18, MOUTH_Y - 6)} Q${pt(CX - 24, MOUTH_Y + 6)} ${pt(CX - 16, MOUTH_Y + 14)} M${pt(CX + 18, MOUTH_Y - 6)} Q${pt(CX + 24, MOUTH_Y + 6)} ${pt(CX + 16, MOUTH_Y + 14)}`, color, 5);
    return "";
  }

  function head(ctx) {
    const { c, face, headwear } = ctx;
    let out = "";
    if (!headwear?.hidesEars) {
      for (const s of [-1, 1]) {
        const x = CX + s * (face.cheek + 3);
        out += path(`M${pt(x - s * 6, 150)} C${pt(x + s * 18, 138)} ${pt(x + s * 20, 186)} ${pt(x - s * 4, 190)} Z`, ctx.skinFlat, c.skinLine, 3) +
          line(`M${pt(x + s * 1, 156)} C${pt(x + s * 10, 154)} ${pt(x + s * 10, 176)} ${pt(x, 180)}`, c.skinShadow, 3);
      }
    }
    out += path(facePath(face), ctx.skinFill, c.skinLine, 3.2);
    // Soft jaw shadow and a forehead highlight give the head some volume.
    out += group(path(`M${pt(CX - 100, 214)} Q${pt(CX, 262)} ${pt(CX + 100, 214)} L${pt(CX + 100, 260)} L${pt(CX - 100, 260)} Z`, c.skinShadow, null, 0, ' opacity="0.35"'), ctx.clip("jaw", `<path d="${facePath(face)}"/>`)) +
      ellipse(CX - 22, 112, 28, 12, "#FFFFFF", ' opacity="0.16"');
    return out;
  }

  function neckLayer(ctx) {
    const { c } = ctx;
    return path(`M${pt(CX - 22, 214)} L${pt(CX - 23, 276)} Q${pt(CX, 286)} ${pt(CX + 23, 276)} L${pt(CX + 22, 214)} Z`, ctx.skinFlat, c.skinLine, 3) +
      path(`M${pt(CX - 22, 226)} Q${pt(CX, 252)} ${pt(CX + 22, 226)} L${pt(CX + 22, 244)} Q${pt(CX, 262)} ${pt(CX - 22, 244)} Z`, c.skinShadow, null, 0, ' opacity="0.6"');
  }

  // ---------- glasses, hearing, earrings ----------
  function glasses(ctx) {
    const kind = ctx.config.glasses;
    if (kind === "none") return "";
    const f = ctx.c.frame;
    const lens = kind === "shades" ? "#2A2F3A" : "#DDEFFF";
    const lensOpacity = kind === "shades" ? "0.92" : "0.22";
    const shapes = {
      round: (x) => `M${pt(x - 20, EYE_Y)} a20 20 0 1 0 40 0 a20 20 0 1 0 -40 0 Z`,
      square: (x) => `M${pt(x - 22, EYE_Y - 15)} h44 q3 0 3 3 v22 q0 9 -9 9 h-32 q-9 0 -9 -9 v-22 q0 -3 3 -3 Z`,
      cateye: (x, s) => `M${pt(x - s * 20, EYE_Y - 10)} Q${pt(x, EYE_Y - 16)} ${pt(x + s * 26, EYE_Y - 18)} Q${pt(x + s * 22, EYE_Y + 18)} ${pt(x, EYE_Y + 16)} Q${pt(x - s * 22, EYE_Y + 14)} ${pt(x - s * 20, EYE_Y - 10)} Z`,
      wide: (x) => `M${pt(x - 25, EYE_Y - 20)} h50 q4 0 4 4 v24 q0 14 -14 14 h-30 q-14 0 -14 -14 v-24 q0 -4 4 -4 Z`,
      half: (x) => `M${pt(x - 22, EYE_Y - 12)} h44 v8 q0 18 -22 18 q-22 0 -22 -18 Z`,
      shades: (x) => `M${pt(x - 24, EYE_Y - 14)} h48 q2 0 2 3 q-2 26 -26 26 q-24 0 -26 -26 q0 -3 2 -3 Z`,
    };
    let out = "";
    for (const s of [-1, 1]) {
      const x = CX + s * EYE_DX;
      const d = shapes[kind](x, s);
      out += path(d, lens, null, 0, ` opacity="${lensOpacity}"`);
      if (kind === "half") out += line(`M${pt(x - 22, EYE_Y - 10)} h44`, f, 6) + path(d, "none", f, 1.6);
      else out += path(d, "none", f, kind === "wide" ? 5 : 4.2);
      out += line(`M${pt(x + s * (kind === "wide" ? 29 : 24), EYE_Y - 8)} L${pt(CX + s * (ctx.face.cheek + 2), EYE_Y - 12)}`, f, 4);
      if (kind !== "shades") out += line(`M${pt(x - 10, EYE_Y - 8)} l8 -6`, "#FFFFFF", 2.6, ' opacity="0.7"');
    }
    out += line(`M${pt(CX - 10, EYE_Y - 6)} Q${pt(CX, EYE_Y - 12)} ${pt(CX + 10, EYE_Y - 6)}`, f, 4);
    return out;
  }

  function hearing(ctx) {
    const kind = ctx.config.hearing;
    if (kind === "none" || ctx.headwear?.hidesEars) return "";
    const { face } = ctx;
    let out = "";
    for (const s of [-1, 1]) {
      const x = CX + s * (face.cheek + 12);
      if (kind === "cochlear") {
        out += path(`M${pt(x - s * 2, 142)} C${pt(x + s * 10, 140)} ${pt(x + s * 12, 172)} ${pt(x + s * 4, 186)} L${pt(x - s * 4, 184)} C${pt(x + s * 2, 170)} ${pt(x + s * 2, 152)} ${pt(x - s * 6, 148)} Z`, "#3A4250", "#161A22", 2.2) +
          line(`M${pt(x - s * 2, 146)} Q${pt(x - s * 6, 132)} ${pt(x - s * 10, 126)}`, "#3A4250", 2.4) + circle(x - s * 12, 120, 9, "#3A4250", "#161A22", 2.2) + circle(x - s * 12, 120, 3.5, "#7AA6D9");
      } else {
        const body = kind === "btecolor" ? "#2F8F88" : "#4B5058";
        out += path(`M${pt(x - s * 2, 146)} C${pt(x + s * 12, 142)} ${pt(x + s * 14, 170)} ${pt(x + s * 4, 178)} L${pt(x - s * 2, 174)} C${pt(x + s * 4, 166)} ${pt(x + s * 4, 154)} ${pt(x - s * 6, 152)} Z`, body, dark(body, 0.5), 2.2) +
          line(`M${pt(x - s * 4, 150)} Q${pt(x - s * 12, 152)} ${pt(x - s * 12, 164)}`, "#C9D2DB", 2);
      }
    }
    return out;
  }

  function earrings(ctx) {
    const kind = ctx.config.earrings;
    if (kind === "none" || ctx.headwear?.hidesEars) return "";
    const { face, c } = ctx;
    return [-1, 1].map((s) => {
      const x = CX + s * (face.cheek + 5);
      return kind === "studs" ? circle(x, 190, 4, c.gold, c.goldLine, 1.6) : circle(x, 200, 9, "none", c.gold, 3.4) + line(`M${pt(x - 6, 194)} a8 8 0 0 0 0 10`, "#FFF3CF", 1.4, ' opacity="0.8"');
    }).join("");
  }

  // ---------- head coverings and hats ----------
  function headwearBack(ctx) {
    const kind = ctx.config.headwear;
    const col = ctx.c.head;
    const fill = ctx.shade("hw", col, 0.16);
    const edge = dark(col, 0.5);
    const b = ctx.build;
    const folds = (d) => line(d, dark(col, 0.22), 2.4, ' opacity="0.8"');
    switch (kind) {
      case "wrap":
        return path(`M${pt(CX, 40)} C${pt(CX + 76, 40)} ${pt(CX + 108, 86)} ${pt(CX + 106, 156)} C${pt(CX + 104, 210)} ${pt(CX + 92, 246)} ${pt(CX + 96, 276)} C${pt(CX + 112, 300)} ${pt(CX + 98, 336)} ${pt(CX + 50, 346)} Q${pt(CX, 358)} ${pt(CX - 50, 346)} C${pt(CX - 98, 336)} ${pt(CX - 112, 300)} ${pt(CX - 96, 276)} C${pt(CX - 92, 246)} ${pt(CX - 104, 210)} ${pt(CX - 106, 156)} C${pt(CX - 108, 86)} ${pt(CX - 76, 40)} ${pt(CX, 40)} Z`, fill, edge, 3) +
          folds(`M${pt(CX - 60, 258)} Q${pt(CX - 20, 300)} ${pt(CX + 40, 312)} M${pt(CX - 40, 286)} Q${pt(CX, 316)} ${pt(CX + 60, 322)} M${pt(CX + 86, 230)} Q${pt(CX + 70, 270)} ${pt(CX + 80, 300)}`);
      case "sport":
        return path(`M${pt(CX, 44)} C${pt(CX + 72, 44)} ${pt(CX + 100, 90)} ${pt(CX + 98, 156)} C${pt(CX + 96, 214)} ${pt(CX + 84, 248)} ${pt(CX + 70, 276)} Q${pt(CX, 300)} ${pt(CX - 70, 276)} C${pt(CX - 84, 248)} ${pt(CX - 96, 214)} ${pt(CX - 98, 156)} C${pt(CX - 100, 90)} ${pt(CX - 72, 44)} ${pt(CX, 44)} Z`, fill, edge, 3) +
          line(`M${pt(CX - 66, 270)} Q${pt(CX, 290)} ${pt(CX + 66, 270)}`, light(col, 0.35), 3);
      case "draped":
        return path(`M${pt(CX, 38)} C${pt(CX + 78, 38)} ${pt(CX + 112, 88)} ${pt(CX + 110, 160)} C${pt(CX + 108, 230)} ${pt(CX + 118, 300)} ${pt(CX + 122, 380)} L${pt(CX + 80, 384)} C${pt(CX + 70, 330)} ${pt(CX + 40, 300)} ${pt(CX - 20, 300)} C${pt(CX - 70, 300)} ${pt(CX - 96, 290)} ${pt(CX - 104, 260)} C${pt(CX - 110, 210)} ${pt(CX - 112, 150)} ${pt(CX - 108, 120)} C${pt(CX - 100, 70)} ${pt(CX - 70, 38)} ${pt(CX, 38)} Z`, fill, edge, 3) +
          path(`M${pt(CX - 96, 262)} C${pt(CX - 40, 300)} ${pt(CX + 40, 286)} ${pt(CX + 104, 236)} L${pt(CX + 108, 268)} C${pt(CX + 40, 320)} ${pt(CX - 40, 322)} ${pt(CX - 100, 290)} Z`, ctx.shade("hw2", light(col, 0.06), 0.14), edge, 3) +
          folds(`M${pt(CX + 96, 300)} Q${pt(CX + 104, 340)} ${pt(CX + 100, 376)} M${pt(CX - 60, 290)} Q${pt(CX, 310)} ${pt(CX + 70, 280)}`);
      case "khimar":
        return path(`M${pt(CX, 38)} C${pt(CX + 78, 38)} ${pt(CX + 110, 88)} ${pt(CX + 108, 160)} C${pt(CX + 106, 220)} ${pt(CX + b.sh + 6, 250)} ${pt(CX + b.sh + 20, 300)} C${pt(CX + b.sh + 26, 340)} ${pt(CX + b.sh + 20, 380)} ${pt(CX + b.sh + 12, 404)} Q${pt(CX, 430)} ${pt(CX - b.sh - 12, 404)} C${pt(CX - b.sh - 20, 380)} ${pt(CX - b.sh - 26, 340)} ${pt(CX - b.sh - 20, 300)} C${pt(CX - b.sh - 6, 250)} ${pt(CX - 106, 220)} ${pt(CX - 108, 160)} C${pt(CX - 110, 88)} ${pt(CX - 78, 38)} ${pt(CX, 38)} Z`, fill, edge, 3) +
          folds(`M${pt(CX - 40, 300)} Q${pt(CX - 50, 360)} ${pt(CX - 44, 410)} M${pt(CX + 36, 300)} Q${pt(CX + 46, 360)} ${pt(CX + 40, 412)} M${pt(CX - b.sh, 320)} Q${pt(CX - b.sh + 4, 360)} ${pt(CX - b.sh - 4, 396)} M${pt(CX + b.sh, 320)} Q${pt(CX + b.sh - 4, 360)} ${pt(CX + b.sh + 4, 396)}`);
      default: return "";
    }
  }

  // y where a crown item (kufi, laurel) sits, given the hairstyle.
  const crownTop = (ctx) => (ctx.headwear?.hidesHair ? 40 : (hairStyles[ctx.config.hair].top ?? 50));

  function headwearFront(ctx) {
    const kind = ctx.config.headwear;
    const col = ctx.c.head;
    const fill = ctx.shade("hwf", col, 0.18);
    const edge = dark(col, 0.5);
    switch (kind) {
      case "wrap": case "sport": case "draped": case "khimar": {
        const outer = kind === "sport" ? 96 : 104;
        const band = `M${pt(CX - outer, 178)} C${pt(CX - outer - 4, 100)} ${pt(CX - 70, 46)} ${pt(CX, 44)} C${pt(CX + 70, 46)} ${pt(CX + outer + 4, 100)} ${pt(CX + outer, 178)} ` +
          `L${pt(CX + 78, 178)} C${pt(CX + 80, 140)} ${pt(CX + 70, 104)} ${pt(CX + 40, 94)} C${pt(CX + 20, 88)} ${pt(CX - 20, 88)} ${pt(CX - 40, 94)} C${pt(CX - 70, 104)} ${pt(CX - 80, 140)} ${pt(CX - 78, 178)} Z`;
        let out = path(band, fill, edge, 3) + line(`M${pt(CX - 70, 70)} Q${pt(CX - 30, 50)} ${pt(CX + 10, 52)}`, light(col, 0.4), 4, ' opacity="0.7"');
        if (kind === "wrap") out += line(`M${pt(CX + 72, 76)} Q${pt(CX + 92, 120)} ${pt(CX + 88, 170)}`, dark(col, 0.22), 2.4);
        if (kind === "sport") out += line(`M${pt(CX - 78, 160)} Q${pt(CX - 82, 110)} ${pt(CX - 46, 84)}`, light(col, 0.35), 3);
        if (kind === "draped") out += line(`M${pt(CX - 86, 90)} Q${pt(CX - 40, 64)} ${pt(CX + 30, 70)}`, dark(col, 0.22), 2.4);
        return out;
      }
      case "turban":
        return path(`M${pt(CX - 88, 124)} C${pt(CX - 104, 60)} ${pt(CX - 60, 22)} ${pt(CX, 22)} C${pt(CX + 60, 22)} ${pt(CX + 104, 60)} ${pt(CX + 88, 124)} C${pt(CX + 60, 104)} ${pt(CX - 60, 104)} ${pt(CX - 88, 124)} Z`, fill, edge, 3) +
          path(`M${pt(CX - 40, 104)} C${pt(CX - 30, 70)} ${pt(CX + 20, 46)} ${pt(CX + 70, 48)} L${pt(CX + 76, 64)} C${pt(CX + 30, 66)} ${pt(CX - 6, 84)} ${pt(CX - 18, 108)} Z`, ctx.shade("tb2", light(col, 0.1)), edge, 2.6) +
          path(`M${pt(CX + 40, 104)} C${pt(CX + 30, 70)} ${pt(CX - 20, 46)} ${pt(CX - 70, 48)} L${pt(CX - 76, 64)} C${pt(CX - 30, 66)} ${pt(CX + 6, 84)} ${pt(CX + 18, 108)} Z`, ctx.shade("tb3", dark(col, 0.06)), edge, 2.6) +
          circle(CX, 96, 12, ctx.shade("tb4", col), edge, 2.6);
      case "kufi": {
        const y = crownTop(ctx) + 4;
        return path(`M${pt(CX - 62, y + 34)} C${pt(CX - 62, y - 4)} ${pt(CX + 62, y - 4)} ${pt(CX + 62, y + 34)} Q${pt(CX, y + 26)} ${pt(CX - 62, y + 34)} Z`, fill, edge, 3) +
          line(`M${pt(CX - 54, y + 22)} Q${pt(CX, y + 12)} ${pt(CX + 54, y + 22)}`, light(col, 0.4), 2.4, ' stroke-dasharray="4 5"');
      }
      case "beanie":
        return path(`M${pt(CX - 92, 112)} C${pt(CX - 96, 30)} ${pt(CX + 96, 30)} ${pt(CX + 92, 112)} Z`, fill, edge, 3) +
          path(`M${pt(CX - 96, 96)} Q${pt(CX, 84)} ${pt(CX + 96, 96)} L${pt(CX + 96, 122)} Q${pt(CX, 110)} ${pt(CX - 96, 122)} Z`, ctx.shade("bn2", dark(col, 0.06)), edge, 3) +
          [-60, -36, -12, 12, 36, 60].map((dx) => line(`M${pt(CX + dx, 92)} v22`, dark(col, 0.25), 2)).join("") + circle(CX, 30, 14, light(col, 0.2), edge, 3);
      case "cap": case "circuitcap": {
        const capCol = kind === "circuitcap" ? "#123B40" : col;
        const capFill = kind === "circuitcap" ? ctx.shade("cc", capCol, 0.2) : fill;
        const capEdge = dark(capCol, 0.5);
        const trim = kind === "circuitcap" ? line(`M${pt(CX - 60, 80)} H${n(CX - 20)} l10 -14 H${n(CX + 40)} M${pt(CX + 20, 50)} v20`, "#2EE6D6", 3) + circle(CX + 40, 66, 4, "#2EE6D6") : "";
        return path(`M${pt(CX - 90, 108)} C${pt(CX - 94, 32)} ${pt(CX + 94, 32)} ${pt(CX + 90, 108)} Q${pt(CX, 96)} ${pt(CX - 90, 108)} Z`, capFill, capEdge, 3) +
          path(`M${pt(CX - 92, 106)} Q${pt(CX, 92)} ${pt(CX + 92, 106)} Q${pt(CX + 70, 130)} ${pt(CX, 128)} Q${pt(CX - 70, 130)} ${pt(CX - 92, 106)} Z`, ctx.shade("brim", dark(capCol, 0.08)), capEdge, 3) +
          line(`M${pt(CX, 38)} V100`, dark(capCol, 0.25), 2) + circle(CX, 38, 5, light(capCol, 0.2), capEdge, 2) + trim;
      }
      case "bucket":
        return path(`M${pt(CX - 82, 104)} C${pt(CX - 86, 34)} ${pt(CX + 86, 34)} ${pt(CX + 82, 104)} Z`, fill, edge, 3) +
          path(`M${pt(CX - 84, 98)} Q${pt(CX, 86)} ${pt(CX + 84, 98)} L${pt(CX + 116, 128)} Q${pt(CX, 112)} ${pt(CX - 116, 128)} Z`, ctx.shade("bk2", dark(col, 0.06)), edge, 3) +
          line(`M${pt(CX - 80, 92)} Q${pt(CX, 80)} ${pt(CX + 80, 92)}`, dark(col, 0.3), 3);
      case "mortarboard": {
        return path(`M${pt(CX - 76, 108)} C${pt(CX - 80, 74)} ${pt(CX + 80, 74)} ${pt(CX + 76, 108)} Q${pt(CX, 98)} ${pt(CX - 76, 108)} Z`, "#22303A", "#0F151A", 3) +
          path(`M${pt(CX, 38)} L${pt(CX + 118, 66)} L${pt(CX, 92)} L${pt(CX - 118, 66)} Z`, ctx.linear("mb", [[0, "#3B4A57"], [1, "#1A242C"]]), "#0F151A", 3) +
          circle(CX, 65, 5, "#E7B43C", "#8A5F12", 2) + line(`M${pt(CX, 65)} L${pt(CX + 92, 72)} L${pt(CX + 94, 118)}`, "#E7B43C", 3) + path(`M${pt(CX + 88, 116)} h12 l2 22 h-16 Z`, "#E7B43C", "#8A5F12", 2);
      }
      case "eliteband": {
        // Elite (Top 10): a navy band at the hairline with a gold stripe and a
        // "10" shield, readable even on small rank thumbnails.
        const y = 100;
        return path(`M${pt(CX - 94, y + 6)} Q${pt(CX, y - 34)} ${pt(CX + 94, y + 6)} L${pt(CX + 92, y + 24)} Q${pt(CX, y - 14)} ${pt(CX - 92, y + 24)} Z`, ctx.linear("eb", [[0, "#2B4372"], [1, "#16264A"]]), "#0E1A33", 3) +
          line(`M${pt(CX - 92, y + 13)} Q${pt(CX, y - 25)} ${pt(CX + 92, y + 13)}`, "#E7B43C", 3) +
          path(`M${pt(CX, y - 40)} l18 7 v15 c0 11 -9 16 -18 19 c-9 -3 -18 -8 -18 -19 v-15 Z`, "#22355E", "#E7B43C", 3) +
          `<text x="${CX}" y="${y - 14}" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="15" fill="#F4C856">10</text>`;
      }
      case "podiumcap": {
        // Podium (Top 3): a silver cap with a gold star and a gold brim edge.
        const silver = ctx.linear("pc", [[0, "#F4F6F9"], [0.55, "#C9CED6"], [1, "#9AA2AE"]]);
        return path(`M${pt(CX - 90, 108)} C${pt(CX - 94, 32)} ${pt(CX + 94, 32)} ${pt(CX + 90, 108)} Q${pt(CX, 96)} ${pt(CX - 90, 108)} Z`, silver, "#5B6472", 3) +
          path(`M${pt(CX - 92, 106)} Q${pt(CX, 92)} ${pt(CX + 92, 106)} Q${pt(CX + 70, 130)} ${pt(CX, 128)} Q${pt(CX - 70, 130)} ${pt(CX - 92, 106)} Z`, "#AEB5C0", "#5B6472", 3) +
          line(`M${pt(CX - 86, 112)} Q${pt(CX, 100)} ${pt(CX + 86, 112)}`, "#E7B43C", 3) + star5(CX, 70, 14, "#E7B43C", "#8A5F12");
      }
      case "laurel": {
        // A wreath worn around the head at the hairline, whatever the hair volume.
        const y = 96;
        const leaves = [];
        for (const s of [-1, 1]) for (let i = 0; i < 6; i += 1) {
          const a = Math.PI * (0.98 + i * 0.09);
          const x = CX + s * Math.cos(a) * -92;
          const yy = y + Math.sin(a) * 40 + 4;
          leaves.push(`<ellipse cx="${n(x)}" cy="${n(yy)}" rx="13" ry="6.5" fill="${i % 2 ? "#E7B43C" : "#F4D06F"}" stroke="#8A5F12" stroke-width="2" transform="rotate(${n(s * (-30 + i * 14))} ${n(x)} ${n(yy)})"/>`);
        }
        return line(`M${pt(CX - 90, y + 4)} Q${pt(CX, y - 46)} ${pt(CX + 90, y + 4)}`, "#8A5F12", 3) + leaves.join("") + star5(CX, y - 18, 9, "#FFF3CF", "#8A5F12");
      }
      default: return "";
    }
  }

  // ---------- body ----------
  const SHOULDER_Y = 292;
  const WAIST_Y = 392;
  // Standing: ankles 562, soles 584. Seated: knees 452, soles 558 on the footplate.
  const ankleY = (ctx) => (ctx.seated ? 534 : 562);
  const soleY = (ctx) => (ctx.seated ? 558 : 584);
  const handPos = (ctx, s) => [CX + s * (ctx.build.sh + (ctx.seated ? 18 : 12)), ctx.seated ? 430 : 452];
  const shoulderPos = (ctx, s) => [CX + s * (ctx.build.sh - ctx.build.arm * 0.6), 304];
  const elbowPos = (ctx, s) => [CX + s * (ctx.build.sh + 6), 378];

  function torsoPath(ctx, hemY, flare = 0, neck = "crew") {
    const b = ctx.build;
    const neckDip = neck === "v" ? 330 : neck === "open" ? 360 : 286;
    const belly = ctx.config.build === "soft" ? 8 : 0;
    const R = (s) => [
      `C${pt(CX + s * 40, 268)} ${pt(CX + s * (b.sh - 10), 272)} ${pt(CX + s * b.sh, SHOULDER_Y)}`,
      `C${pt(CX + s * (b.sh + 2), 330)} ${pt(CX + s * (b.waist + belly), 352)} ${pt(CX + s * b.waist, WAIST_Y)}`,
      `L${pt(CX + s * (b.hip + flare), hemY)}`,
    ];
    const right = R(1);
    return `M${pt(CX + 24, 266)} ${right.join(" ")} Q${pt(CX, hemY + 6)} ${pt(CX - b.hip - flare, hemY)} ` +
      `L${pt(CX - b.waist, WAIST_Y)} C${pt(CX - b.waist - belly, 352)} ${pt(CX - b.sh - 2, 330)} ${pt(CX - b.sh, SHOULDER_Y)} ` +
      `C${pt(CX - b.sh + 10, 272)} ${pt(CX - 40, 268)} ${pt(CX - 24, 266)} Q${pt(CX, neckDip)} ${pt(CX + 24, 266)} Z`;
  }

  function armPath(ctx, s, until = "hand") {
    const [sx, sy] = shoulderPos(ctx, s);
    const [ex, ey] = elbowPos(ctx, s);
    const [hx, hy] = handPos(ctx, s);
    if (until === "elbow") return `M${pt(sx, sy)} L${pt(ex, ey - 8)}`;
    return `M${pt(sx, sy)} L${pt(ex, ey)} L${pt(hx, hy - 14)}`;
  }

  // Item colours: fixed for special editions, the student's choice otherwise.
  const topColors = (ctx) => ({ varsity: ["#22355E", "#F1E6CC"], podiumjacket: ["#E9ECF1", "#C9CED6"], circuithoodie: ["#123B40", "#123B40"], vest: [ctx.c.top, "#F3F0E9"] }[ctx.config.top] || [ctx.c.top, ctx.c.top]);

  function arms(ctx, sleeves) {
    const { c } = ctx;
    const b = ctx.build;
    const [, sleeveCol] = topColors(ctx);
    const sleeveFill = ctx.shade("sleeve", sleeveCol, 0.16);
    const sleeveLine = dark(sleeveCol, 0.55);
    let out = "";
    for (const s of [-1, 1]) {
      const [hx, hy] = handPos(ctx, s);
      out += tube(armPath(ctx, s), b.arm * 2 - 6, ctx.skinFlat, c.skinLine);
      if (sleeves === "long") out += tube(armPath(ctx, s), b.arm * 2, sleeveFill, sleeveLine) + line(`M${pt(hx - (b.arm - 2), hy - 22)} L${pt(hx + (b.arm - 2), hy - 22)}`, dark(sleeveCol, 0.25), 3);
      else if (sleeves === "short") out += tube(armPath(ctx, s, "elbow"), b.arm * 2 + 4, sleeveFill, sleeveLine);
      out += path(`M${pt(hx - b.arm + 3, hy - 16)} C${pt(hx - b.arm, hy + 4)} ${pt(hx - 6, hy + 14)} ${pt(hx, hy + 12)} C${pt(hx + 8, hy + 12)} ${pt(hx + b.arm, hy + 4)} ${pt(hx + b.arm - 3, hy - 16)} Z`, ctx.skinFlat, c.skinLine, 3) +
        line(`M${pt(hx - s * 4, hy - 2)} q${n(s * 4)} 6 ${n(s * 8)} 4`, c.skinShadow, 2);
    }
    if (ctx.config.top === "podiumjacket") for (const s of [-1, 1]) out += line(`M${pt(CX + s * (b.sh - 2), 300)} L${pt(CX + s * (b.sh + 12), 398)}`, "#E7B43C", 4) + line(`M${pt(CX + s * (b.sh + 6), 300)} L${pt(CX + s * (b.sh + 20), 396)}`, "#C98A4B", 3);
    if (ctx.config.top === "varsity") for (const s of [-1, 1]) { const [hx, hy] = handPos(ctx, s); out += line(`M${pt(hx - b.arm + 1, hy - 26)} h${n(b.arm * 2 - 2)}`, "#22355E", 4) + line(`M${pt(hx - b.arm + 1, hy - 32)} h${n(b.arm * 2 - 2)}`, "#E7B43C", 2.4); }
    if (ctx.config.top === "track") for (const s of [-1, 1]) out += line(`M${pt(CX + s * (b.sh + 2), 300)} L${pt(CX + s * (b.sh + 16), 400)}`, light(sleeveCol, 0.7), 4);
    if (ctx.config.top === "circuithoodie") for (const s of [-1, 1]) out += line(`M${pt(CX + s * (b.sh + 2), 320)} l${n(s * 4)} 30 l${n(s * 8)} 6`, "#2EE6D6", 2.6);
    return out;
  }

  function top(ctx) {
    const kind = ctx.config.top;
    const b = ctx.build;
    const [bodyCol] = topColors(ctx);
    const fill = ctx.shade("top", bodyCol, 0.16);
    const edge = dark(bodyCol, 0.55);
    const seam = dark(bodyCol, 0.22);
    const hi = light(bodyCol, 0.3);
    const inner = (col = "#F3F0E9") => path(`M${pt(CX - 26, 266)} L${pt(CX + 26, 266)} L${pt(CX + 24, 400)} L${pt(CX - 24, 400)} Z`, ctx.shade("inner", col, 0.1), dark(col, 0.45), 2.6);
    const lapels = (open = 22) => both(path(`M${pt(CX - 24, 266)} L${pt(CX - 8, 340)} L${pt(CX - open, 300)} L${pt(CX - 46, 286)} Z`, ctx.shade("lapel", dark(bodyCol, 0.06)), edge, 2.6));
    let body;
    let sleeves = "long";
    let extra = "";
    switch (kind) {
      case "tee": sleeves = "short"; body = torsoPath(ctx, 414); extra = line(`M${pt(CX - 24, 268)} Q${pt(CX, 290)} ${pt(CX + 24, 268)}`, seam, 3); break;
      case "polo": sleeves = "short"; body = torsoPath(ctx, 414); extra = both(path(`M${pt(CX - 24, 264)} L${pt(CX - 2, 290)} L${pt(CX - 30, 296)} L${pt(CX - 40, 270)} Z`, ctx.shade("collar", light(bodyCol, 0.06)), edge, 2.4)) + line(`M${pt(CX, 290)} V322`, seam, 2.4) + circle(CX, 302, 2.6, hi) + circle(CX, 314, 2.6, hi); break;
      case "hoodie": body = torsoPath(ctx, 418); extra = path(`M${pt(CX - 42, 262)} C${pt(CX - 50, 300)} ${pt(CX + 50, 300)} ${pt(CX + 42, 262)} C${pt(CX + 28, 290)} ${pt(CX - 28, 290)} ${pt(CX - 42, 262)} Z`, ctx.shade("hood", dark(bodyCol, 0.08)), edge, 2.6) +
        line(`M${pt(CX - 12, 290)} v34 M${pt(CX + 12, 290)} v30`, light(bodyCol, 0.55), 3) + path(`M${pt(CX - 40, 356)} h80 l8 40 h-96 Z`, ctx.shade("pocket", dark(bodyCol, 0.04)), seam, 2.4) +
        line(`M${pt(CX - b.hip - 1, 404)} Q${pt(CX, 410)} ${pt(CX + b.hip + 1, 404)}`, seam, 3); break;
      case "sweater": body = torsoPath(ctx, 416); extra = path(`M${pt(CX - 26, 266)} Q${pt(CX, 296)} ${pt(CX + 26, 266)} L${pt(CX + 22, 264)} Q${pt(CX, 286)} ${pt(CX - 22, 264)} Z`, seam, edge, 2) +
        [-30, -10, 10, 30].map((dx) => line(`M${pt(CX + dx, 312)} l6 8 l6 -8`, seam, 2, ' opacity="0.6"')).join("") + line(`M${pt(CX - b.hip, 404)} Q${pt(CX, 410)} ${pt(CX + b.hip, 404)}`, seam, 3); break;
      case "shirt": body = torsoPath(ctx, 416); extra = both(path(`M${pt(CX - 24, 264)} L${pt(CX - 2, 292)} L${pt(CX - 28, 298)} L${pt(CX - 40, 270)} Z`, ctx.shade("collar", light(bodyCol, 0.08)), edge, 2.4)) +
        line(`M${pt(CX, 292)} V410`, seam, 2.4) + [306, 332, 358, 384].map((y) => circle(CX + 5, y, 2.6, hi)).join("") + path(`M${pt(CX + 22, 312)} h22 v20 q-11 4 -22 0 Z`, "none", seam, 2); break;
      case "overshirt": body = torsoPath(ctx, 418, 0, "open"); extra = inner("#F3F0E9") + both(path(`M${pt(CX - 26, 264)} L${pt(CX - 20, 400)} L${pt(CX - 34, 410)} L${pt(CX - 30, 270)} Z`, ctx.shade("placket", dark(bodyCol, 0.04)), edge, 2.2)) +
        path(`M${pt(CX - 52, 312)} h22 v20 q-11 4 -22 0 Z`, "none", seam, 2) + path(`M${pt(CX + 30, 312)} h22 v20 q-11 4 -22 0 Z`, "none", seam, 2) +
        both(path(`M${pt(CX - 26, 262)} L${pt(CX - 14, 286)} L${pt(CX - 36, 290)} L${pt(CX - 44, 268)} Z`, ctx.shade("collar", light(bodyCol, 0.06)), edge, 2.4)); break;
      case "cardigan": body = torsoPath(ctx, 470, 8, "open"); extra = inner("#E8DCC4") + both(line(`M${pt(CX - 24, 270)} L${pt(CX - 22, 464)}`, seam, 6)) +
        [310, 340, 370].map((y) => circle(CX - 26, y, 3, hi, edge, 1.4)).join("") + both(path(`M${pt(CX - 70, 400)} h26 v24 h-26 Z`, "none", seam, 2)); break;
      case "blazer": body = torsoPath(ctx, 428, 4, "open"); extra = inner("#F3F0E9") + lapels(36) + circle(CX - 22, 384, 3.4, dark(bodyCol, 0.35)) + line(`M${pt(CX + 34, 330)} h22`, seam, 3) + both(line(`M${pt(CX - 70, 398)} h28`, seam, 3)); break;
      case "tunic": body = torsoPath(ctx, 486, 12); extra = path(`M${pt(CX - 20, 264)} Q${pt(CX, 274)} ${pt(CX + 20, 264)} L${pt(CX + 20, 256)} Q${pt(CX, 266)} ${pt(CX - 20, 256)} Z`, ctx.shade("mandarin", dark(bodyCol, 0.06)), edge, 2.4) +
        line(`M${pt(CX, 272)} V330`, seam, 2.4) + [286, 302, 318].map((y) => circle(CX + 4, y, 2.4, hi)).join("") + both(line(`M${pt(CX - b.hip - 12, 486)} l4 -40`, edge, 2.6)); break;
      case "dress": body = torsoPath(ctx, ctx.seated ? 500 : 566, ctx.seated ? 26 : 40); extra = line(`M${pt(CX - b.waist, WAIST_Y)} Q${pt(CX, WAIST_Y + 8)} ${pt(CX + b.waist, WAIST_Y)}`, seam, 5) +
        line(`M${pt(CX - 20, 264)} Q${pt(CX, 278)} ${pt(CX + 20, 264)}`, seam, 2.6) + both(line(`M${pt(CX - 30, 404)} Q${pt(CX - 40, 450)} ${pt(CX - 56, ctx.seated ? 494 : 560)}`, seam, 2.4, ' opacity="0.7"')); break;
      case "abaya": {
        const hem = ctx.seated ? 500 : 572;
        body = torsoPath(ctx, hem, ctx.seated ? 24 : 44, "open");
        const under = dark(bodyCol, 0.28);
        extra = path(`M${pt(CX - 24, 268)} L${pt(CX + 24, 268)} L${pt(CX + 32, hem - 2)} Q${pt(CX, hem + 4)} ${pt(CX - 32, hem - 2)} Z`, ctx.shade("abaya-in", under, 0.1), dark(under, 0.5), 2.4) +
          both(line(`M${pt(CX - 25, 268)} L${pt(CX - 34, hem - 2)}`, light(bodyCol, 0.45), 4)) +
          both(line(`M${pt(CX - 46, 420)} Q${pt(CX - 56, (hem + 420) / 2)} ${pt(CX - 66, hem - 4)}`, dark(bodyCol, 0.2), 2.4, ' opacity="0.6"'));
        break;
      }
      case "thobe": {
        const hem = ctx.seated ? 500 : 568;
        body = torsoPath(ctx, hem, ctx.seated ? 18 : 26);
        extra = path(`M${pt(CX - 20, 264)} Q${pt(CX, 274)} ${pt(CX + 20, 264)} L${pt(CX + 20, 254)} Q${pt(CX, 264)} ${pt(CX - 20, 254)} Z`, ctx.shade("thobe-c", dark(bodyCol, 0.05)), edge, 2.4) +
          line(`M${pt(CX, 272)} V344`, seam, 2.4) + [286, 304, 322].map((y) => circle(CX + 4, y, 2.4, dark(bodyCol, 0.3))).join("") +
          path(`M${pt(CX + 26, 306)} h20 v18 q-10 4 -20 0 Z`, "none", seam, 2) +
          both(line(`M${pt(CX - 34, 420)} Q${pt(CX - 40, (hem + 420) / 2)} ${pt(CX - 46, hem - 4)}`, seam, 2.2, ' opacity="0.55"'));
        break;
      }
      case "vest": body = torsoPath(ctx, 412, 0, "v"); extra = both(path(`M${pt(CX - 24, 264)} L${pt(CX - 4, 292)} L${pt(CX - 30, 296)} L${pt(CX - 38, 270)} Z`, ctx.shade("vest-collar", "#F3F0E9", 0.08), "#9A958B", 2.2)) +
        path(`M${pt(CX - 22, 268)} L${pt(CX, 330)} L${pt(CX + 22, 268)} Z`, "#F3F0E9", "#9A958B", 2) +
        [-34, -14, 6, 26].map((dx) => line(`M${pt(CX + dx, 352)} l5 7 l5 -7`, seam, 2, ' opacity="0.65"')).join("") +
        line(`M${pt(CX - b.hip, 402)} Q${pt(CX, 408)} ${pt(CX + b.hip, 402)}`, seam, 4); break;
      case "track": body = torsoPath(ctx, 416); extra = line(`M${pt(CX, 270)} V414`, dark(bodyCol, 0.4), 3) + line(`M${pt(CX - 4, 270)} V414`, light(bodyCol, 0.5), 1.4, ' stroke-dasharray="2 3"') +
        path(`M${pt(CX - 24, 262)} L${pt(CX + 24, 262)} L${pt(CX + 28, 280)} L${pt(CX - 28, 280)} Z`, ctx.shade("track-c", dark(bodyCol, 0.1)), edge, 2.4) +
        both(line(`M${pt(CX - b.sh + 4, 300)} L${pt(CX - b.waist + 2, 402)}`, light(bodyCol, 0.7), 4)) +
        path(`M${pt(CX - b.hip, 402)} Q${pt(CX, 410)} ${pt(CX + b.hip, 402)} L${pt(CX + b.hip, 416)} Q${pt(CX, 422)} ${pt(CX - b.hip, 416)} Z`, dark(bodyCol, 0.2), edge, 2); break;
      case "varsity": body = torsoPath(ctx, 416, 0, "open"); extra = inner("#F3F0E9") + both(line(`M${pt(CX - 24, 270)} L${pt(CX - 22, 410)}`, "#E7B43C", 5)) + [308, 334, 360, 386].map((y) => circle(CX - 30, y, 3, "#F1E6CC")).join("") +
        path(`M${pt(CX - b.hip - 2, 402)} Q${pt(CX, 410)} ${pt(CX + b.hip + 2, 402)} L${pt(CX + b.hip + 2, 418)} Q${pt(CX, 424)} ${pt(CX - b.hip - 2, 418)} Z`, "#22355E", "#0E1A33", 2.4) + line(`M${pt(CX - b.hip, 410)} Q${pt(CX, 416)} ${pt(CX + b.hip, 410)}`, "#E7B43C", 2.4) +
        path(`M${pt(CX + 34, 300)} h30 v34 h-30 Z`, "#F1E6CC", "#E7B43C", 3) + `<text x="${CX + 49}" y="326" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="24" fill="#22355E">A</text>`; break;
      case "podiumjacket": body = torsoPath(ctx, 416); extra = line(`M${pt(CX, 268)} V414`, "#8C939E", 3) + path(`M${pt(CX - 22, 262)} L${pt(CX + 22, 262)} L${pt(CX + 26, 280)} L${pt(CX - 26, 280)} Z`, "#C9CED6", "#5B6472", 2.4) +
        both(line(`M${pt(CX - b.sh + 6, 300)} L${pt(CX - b.waist + 4, 400)}`, "#E7B43C", 5)) + star5(CX + 40, 318, 10, "#E7B43C", "#8A5F12") + path(`M${pt(CX - b.hip, 402)} Q${pt(CX, 410)} ${pt(CX + b.hip, 402)} L${pt(CX + b.hip, 416)} Q${pt(CX, 422)} ${pt(CX - b.hip, 416)} Z`, "#22303A", "#0F151A", 2); break;
      case "circuithoodie": body = torsoPath(ctx, 418); extra = path(`M${pt(CX - 42, 262)} C${pt(CX - 50, 300)} ${pt(CX + 50, 300)} ${pt(CX + 42, 262)} C${pt(CX + 28, 290)} ${pt(CX - 28, 290)} ${pt(CX - 42, 262)} Z`, "#0E2E32", "#06181A", 2.6) +
        line(`M${pt(CX - 40, 320)} H${n(CX - 10)} l10 12 H${n(CX + 40)} M${pt(CX - 30, 360)} H${n(CX + 10)} l10 -10 H${n(CX + 36)} M${pt(CX, 332)} V360`, "#2EE6D6", 3) + circle(CX - 40, 320, 4, "#2EE6D6") + circle(CX + 36, 350, 4, "#2EE6D6") + circle(CX + 40, 332, 4, "#2EE6D6"); break;
      default: body = torsoPath(ctx, 414);
    }
    return { body: path(body, fill, edge, 3) + extra, sleeves };
  }

  function legs(ctx) {
    const { config, c } = ctx;
    const b = ctx.build;
    const kind = config.bottom;
    const coveredByDress = catalog.items[`top.${config.top}`].covers?.includes("bottom");
    const col = c.bottom;
    const fill = ctx.shade("bottom", col, 0.14);
    const edge = dark(col, 0.55);
    const seam = dark(col, 0.25);
    const lx = (s) => CX + s * b.hip * 0.5;
    const ankle = ankleY(ctx);
    let out = "";
    // Skin shins (visible under skirts) and shoes are drawn by the caller.
    if (ctx.seated) {
      const lapTop = 390;
      if (kind === "shorts" && !coveredByDress) {
        const knees = [-1, 1].map((s) => tube(`M${pt(lx(s), 446)} L${pt(lx(s) + s * 2, ankle)}`, b.leg * 2 - 6, ctx.skinFlat, c.skinLine)).join("");
        const lapShort = path(`M${pt(CX - b.hip - 4, lapTop)} L${pt(CX + b.hip + 4, lapTop)} C${pt(CX + b.hip + 14, 416)} ${pt(CX + b.hip + 12, 444)} ${pt(CX + b.hip - 6, 448)} L${pt(CX - b.hip + 6, 448)} C${pt(CX - b.hip - 12, 444)} ${pt(CX - b.hip - 14, 416)} ${pt(CX - b.hip - 4, lapTop)} Z`, fill, edge, 3);
        return { under: knees, over: lapShort };
      }
      const kneeY = 452;
      const shins = (fillShin, edgeShin, width = b.leg * 2) => [-1, 1].map((s) => tube(`M${pt(lx(s), kneeY - 6)} L${pt(lx(s) + s * 2, ankle)}`, width, fillShin, edgeShin)).join("");
      if (coveredByDress) return { under: shins(ctx.skinFlat, c.skinLine, b.leg * 2 - 6), over: "" };
      const skirt = kind === "midi" || kind === "maxi";
      const lower = skirt && kind === "midi" ? shins(ctx.skinFlat, c.skinLine, b.leg * 2 - 6) : shins(fill, edge, kind === "wide" ? b.leg * 2 + 10 : b.leg * 2);
      const lap = path(`M${pt(CX - b.hip - 4, lapTop)} L${pt(CX + b.hip + 4, lapTop)} C${pt(CX + b.hip + 14, 420)} ${pt(CX + b.hip + 12, kneeY)} ${pt(CX + b.hip - 6, kneeY + 6)} L${pt(CX - b.hip + 6, kneeY + 6)} C${pt(CX - b.hip - 12, kneeY)} ${pt(CX - b.hip - 14, 420)} ${pt(CX - b.hip - 4, lapTop)} Z`, fill, edge, 3) +
        line(`M${pt(CX, lapTop + 10)} V${n(kneeY)}`, seam, 2.4, ' opacity="0.6"');
      const skirtFront = kind === "maxi" ? path(`M${pt(CX - b.hip - 8, kneeY - 4)} L${pt(CX + b.hip + 8, kneeY - 4)} L${pt(CX + b.hip + 16, ankle)} Q${pt(CX, ankle + 6)} ${pt(CX - b.hip - 16, ankle)} Z`, fill, edge, 3) : "";
      return { under: lower, over: lap + skirtFront };
    }
    if (coveredByDress) return { under: [-1, 1].map((s) => tube(`M${pt(lx(s), 520)} L${pt(lx(s), ankle)}`, b.leg * 2 - 8, ctx.skinFlat, c.skinLine)).join(""), over: "" };
    if (kind === "midi" || kind === "maxi") {
      const hem = kind === "midi" ? 512 : 566;
      out += [-1, 1].map((s) => tube(`M${pt(lx(s), 440)} L${pt(lx(s), ankle)}`, b.leg * 2 - 8, ctx.skinFlat, c.skinLine)).join("");
      out += path(`M${pt(CX - b.waist - 2, WAIST_Y)} L${pt(CX + b.waist + 2, WAIST_Y)} L${pt(CX + b.hip + (kind === "midi" ? 22 : 30), hem)} Q${pt(CX, hem + 8)} ${pt(CX - b.hip - (kind === "midi" ? 22 : 30), hem)} Z`, fill, edge, 3) +
        both(line(`M${pt(CX - 20, 404)} Q${pt(CX - 26, (hem + 404) / 2)} ${pt(CX - 34, hem - 4)}`, seam, 2.4, ' opacity="0.7"'));
      return { under: "", over: out };
    }
    if (kind === "shorts") {
      // Knee-length: shins below the hem are skin.
      out += [-1, 1].map((s) => tube(`M${pt(lx(s), 486)} L${pt(lx(s), ankle)}`, b.leg * 2 - 8, ctx.skinFlat, c.skinLine)).join("");
      const hemY = 500;
      out += path(`M${pt(CX - b.waist - 2, WAIST_Y)} L${pt(CX + b.waist + 2, WAIST_Y)} C${pt(CX + b.hip + 6, 430)} ${pt(CX + b.hip + 6, 470)} ${pt(lx(1) + b.leg + 6, hemY)} L${pt(lx(1) - b.leg - 2, hemY)} L${pt(CX + 3, 466)} L${pt(CX - 3, 466)} L${pt(lx(-1) + b.leg + 2, hemY)} L${pt(lx(-1) - b.leg - 6, hemY)} C${pt(CX - b.hip - 6, 470)} ${pt(CX - b.hip - 6, 430)} ${pt(CX - b.waist - 2, WAIST_Y)} Z`, fill, edge, 3) +
        both(line(`M${pt(lx(-1) - b.leg - 4, hemY - 8)} h${n(b.leg * 2 + 8)}`, seam, 2.4));
      return { under: "", over: out };
    }
    const widen = { wide: 12, jeans: 0, chinos: 0, joggers: -2, cargo: 2, pleated: 8, leggings: -5 }[kind] ?? 0;
    const crotch = 472;
    const d = `M${pt(CX - b.waist - 2, WAIST_Y)} L${pt(CX + b.waist + 2, WAIST_Y)} C${pt(CX + b.hip + 6, 430)} ${pt(CX + b.hip + 4, 460)} ${pt(lx(1) + b.leg + widen, ankle)} ` +
      `L${pt(lx(1) - b.leg - widen * 0.4, ankle)} L${pt(CX + 3, crotch)} L${pt(CX - 3, crotch)} L${pt(lx(-1) + b.leg + widen * 0.4, ankle)} L${pt(lx(-1) - b.leg - widen, ankle)} ` +
      `C${pt(CX - b.hip - 4, 460)} ${pt(CX - b.hip - 6, 420)} ${pt(CX - b.waist - 2, WAIST_Y)} Z`;
    out += path(d, fill, edge, 3) + line(`M${pt(CX, WAIST_Y + 4)} V${n(crotch - 4)}`, seam, 2.4);
    if (kind === "jeans") out += both(line(`M${pt(CX - b.waist + 2, WAIST_Y + 6)} Q${pt(CX - b.waist + 20, 416)} ${pt(CX - 14, WAIST_Y + 6)}`, light(col, 0.35), 2, ' stroke-dasharray="3 3"'));
    if (kind === "chinos") out += both(line(`M${pt(lx(-1), 460)} V${n(ankle - 6)}`, seam, 2, ' opacity="0.5"'));
    if (kind === "joggers") out += both(path(`M${pt(lx(-1) - b.leg - 1, ankle - 14)} h${n(b.leg * 2 + 2)} v14 h${n(-b.leg * 2 - 2)} Z`, seam, edge, 2)) + line(`M${pt(CX - 8, WAIST_Y + 4)} l-4 22 M${pt(CX + 8, WAIST_Y + 4)} l4 22`, light(col, 0.5), 2.4);
    if (kind === "pleated") out += both(line(`M${pt(lx(-1) - 4, WAIST_Y + 6)} L${pt(lx(-1) - 2, ankle - 4)} M${pt(lx(-1) + 8, WAIST_Y + 6)} l2 40`, seam, 2.2, ' opacity="0.7"'));
    if (kind === "leggings") out += both(line(`M${pt(lx(-1) - b.leg + 4, 470)} V${n(ankle - 4)}`, light(col, 0.3), 2, ' opacity="0.6"'));
    if (kind === "cargo") out += both(path(`M${pt(lx(-1) - b.leg - 4, 480)} h22 v28 h-22 Z`, ctx.shade("cargo", dark(col, 0.06)), edge, 2.4));
    return { under: "", over: out };
  }

  function shoes(ctx) {
    const { config } = ctx;
    const b = ctx.build;
    const kind = config.shoes;
    const fixed = { elite: ["#F3F0E9", "#22355E"], gold: ["#E7B43C", "#FFF3CF"] }[kind];
    const col = fixed ? fixed[0] : ctx.c.shoes;
    const accent = fixed ? fixed[1] : (kind === "sneakers" || kind === "hightops" ? "#FFFFFF" : dark(col, 0.25));
    const edge = dark(col, 0.6);
    const fill = ctx.shade("shoe", col, 0.18);
    let out = "";
    for (const s of [-1, 1]) {
      const x = CX + s * (b.hip * 0.5 + (ctx.seated ? 2 : 0)) + s * 4;
      const y = soleY(ctx);
      if (kind === "sandals") {
        // Open sandals: the foot shows, with two straps and a sole.
        out += path(`M${pt(x - 22, y - 4)} C${pt(x - 22, y - 14)} ${pt(x - 10, y - 20)} ${pt(x, y - 20)} C${pt(x + 14, y - 20)} ${pt(x + 24, y - 12)} ${pt(x + 24, y - 4)} Z`, ctx.skinFlat, ctx.c.skinLine, 2.6) +
          path(`M${pt(x - 25, y - 6)} H${n(x + 27)} V${n(y)} H${n(x - 24)} Z`, dark(col, 0.2), edge, 2) +
          line(`M${pt(x - 18, y - 10)} Q${pt(x, y - 18)} ${pt(x + 20, y - 10)} M${pt(x - 6, y - 18)} L${pt(x + 4, y - 6)}`, col, 4);
        continue;
      }
      const tall = kind === "boots" ? 34 : kind === "hightops" ? 26 : kind === "flats" || kind === "loafers" ? 12 : kind === "slipons" ? 14 : 18;
      out += path(`M${pt(x - 24, y)} C${pt(x - 26, y - tall)} ${pt(x - 14, y - tall - 6)} ${pt(x, y - tall - 6)} C${pt(x + 16, y - tall - 6)} ${pt(x + 28, y - tall + 4)} ${pt(x + 26, y)} Z`, fill, edge, 3);
      if (["sneakers", "hightops", "elite", "gold"].includes(kind)) out += path(`M${pt(x - 25, y - 6)} H${n(x + 27)} V${n(y)} H${n(x - 24)} Z`, accent, edge, 2) + line(`M${pt(x - 8, y - tall)} l14 0 M${pt(x - 8, y - tall + 6)} l14 0`, accent, 2.4);
      if (kind === "elite") out += line(`M${pt(x - 20, y - 12)} Q${pt(x, y - 20)} ${pt(x + 20, y - 12)}`, "#E7B43C", 3);
      if (kind === "gold") out += star5(x + s * 6, y - 18, 6, "#FFF3CF", "#8A5F12");
      if (kind === "loafers") out += line(`M${pt(x - 10, y - 12)} h20`, accent, 3);
      if (kind === "slipons") out += path(`M${pt(x - 25, y - 5)} H${n(x + 27)} V${n(y)} H${n(x - 24)} Z`, "#F3F0E9", edge, 2) + line(`M${pt(x - 4, y - 18)} l6 8`, dark(col, 0.35), 2.4);
      if (kind === "boots") out += line(`M${pt(x - 20, y - 26)} h42`, accent, 3);
    }
    return out;
  }

  // ---------- neck & back items ----------
  function neckItem(ctx) {
    const kind = ctx.config.neck;
    const col = ctx.c.neck;
    switch (kind) {
      case "headphones":
        return line(`M${pt(CX - 40, 270)} Q${pt(CX, 300)} ${pt(CX + 40, 270)}`, dark(col, 0.5), 9) + line(`M${pt(CX - 40, 270)} Q${pt(CX, 300)} ${pt(CX + 40, 270)}`, col, 5) +
          both(`<rect x="${CX - 58}" y="258" width="22" height="30" rx="9" fill="${ctx.shade("hp", col)}" stroke="${dark(col, 0.55)}" stroke-width="3" transform="rotate(-14 ${CX - 47} 273)"/>`);
      case "scarf": case "scholarscarf": {
        const scholar = kind === "scholarscarf";
        const base = scholar ? "#22355E" : col;
        const fill = ctx.shade("scarf", base, 0.16);
        const edge = dark(base, 0.55);
        const stripes = scholar ? line(`M${pt(CX + 14, 320)} h26 M${pt(CX + 13, 340)} h26 M${pt(CX + 12, 360)} h26`, "#E7B43C", 5) + line(`M${pt(CX - 40, 280)} Q${pt(CX, 296)} ${pt(CX + 40, 280)}`, "#F1E6CC", 4) : "";
        return path(`M${pt(CX - 46, 262)} Q${pt(CX, 284)} ${pt(CX + 46, 262)} L${pt(CX + 48, 286)} Q${pt(CX, 310)} ${pt(CX - 48, 286)} Z`, fill, edge, 3) +
          path(`M${pt(CX + 10, 296)} L${pt(CX + 42, 292)} L${pt(CX + 40, 380)} L${pt(CX + 10, 384)} Z`, fill, edge, 3) + stripes +
          line(`M${pt(CX + 12, 378)} v8 M${pt(CX + 20, 378)} v8 M${pt(CX + 28, 377)} v8 M${pt(CX + 36, 377)} v8`, edge, 2);
      }
      case "tie":
        return path(`M${pt(CX - 8, 270)} h16 l-3 12 h-10 Z`, ctx.shade("tie-k", dark(col, 0.08)), dark(col, 0.55), 2.2) +
          path(`M${pt(CX - 5, 282)} h10 l9 76 l-14 16 l-14 -16 Z`, ctx.shade("tie", col, 0.16), dark(col, 0.55), 2.4) +
          line(`M${pt(CX - 6, 300)} l12 -8 M${pt(CX - 8, 324)} l16 -10 M${pt(CX - 10, 348)} l20 -12`, light(col, 0.35), 2, ' opacity="0.7"');
      case "lanyard":
        return line(`M${pt(CX - 32, 268)} L${pt(CX - 6, 360)} M${pt(CX + 32, 268)} L${pt(CX + 6, 360)}`, dark(col, 0.45), 7) +
          line(`M${pt(CX - 32, 268)} L${pt(CX - 6, 360)} M${pt(CX + 32, 268)} L${pt(CX + 6, 360)}`, col, 4) +
          `<rect x="${CX - 18}" y="360" width="36" height="46" rx="5" fill="#F3F0E9" stroke="#5B6472" stroke-width="2.4"/>` +
          `<rect x="${CX - 18}" y="360" width="36" height="12" rx="5" fill="${col}"/>` + circle(CX, 388, 7, "#C9CED6") + line(`M${pt(CX - 10, 400)} h20`, "#9AA2AE", 2.4);
      case "medal":
        return line(`M${pt(CX - 30, 268)} L${pt(CX, 336)} L${pt(CX + 30, 268)}`, "#22355E", 12) + line(`M${pt(CX - 30, 268)} L${pt(CX, 336)} L${pt(CX + 30, 268)}`, "#C6433B", 6) +
          circle(CX, 350, 20, ctx.radial("medal", [[0, "#FFF0B5"], [0.6, "#E7B43C"], [1, "#B9822A"]], 0.4, 0.35), "#8A5F12", 3) + star5(CX, 350, 10, "#FFF3CF", "#8A5F12");
      case "elitepin":
        return path(`M${pt(CX + 40, 302)} l16 6 v14 c0 10 -8 14 -16 17 c-8 -3 -16 -7 -16 -17 v-14 Z`, "#22355E", "#E7B43C", 3) +
          `<text x="${CX + 40}" y="326" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="13" fill="#F4C856">10</text>`;
      default: return "";
    }
  }

  function backLayer(ctx) {
    const kind = ctx.config.back;
    const b = ctx.build;
    if (kind === "backpack" || kind === "circuitpack") {
      const col = kind === "circuitpack" ? "#123B40" : ctx.c.back;
      return path(`M${pt(CX - b.sh - 8, 300)} Q${pt(CX - b.sh - 10, 276)} ${pt(CX - b.sh + 20, 274)} H${n(CX + b.sh - 20)} Q${pt(CX + b.sh + 10, 276)} ${pt(CX + b.sh + 8, 300)} V${n(400)} Q${pt(CX, 410)} ${pt(CX - b.sh - 8, 400)} Z`, ctx.shade("pack", col), dark(col, 0.55), 3);
    }
    if (kind === "cape") {
      return path(`M${pt(CX - b.sh + 4, 280)} C${pt(CX - b.sh - 40, 360)} ${pt(CX - b.sh - 50, 480)} ${pt(CX - b.sh - 40, 570)} Q${pt(CX, 550)} ${pt(CX + b.sh + 40, 570)} C${pt(CX + b.sh + 50, 480)} ${pt(CX + b.sh + 40, 360)} ${pt(CX + b.sh - 4, 280)} Z`,
        ctx.linear("cape", [[0, "#D9473E"], [1, "#8E2420"]]), "#5E1512", 3) + line(`M${pt(CX - b.sh - 40, 566)} Q${pt(CX, 546)} ${pt(CX + b.sh + 40, 566)}`, "#E7B43C", 5);
    }
    return "";
  }

  function backFront(ctx) {
    const kind = ctx.config.back;
    const b = ctx.build;
    if (kind === "backpack" || kind === "circuitpack") {
      const col = kind === "circuitpack" ? "#123B40" : ctx.c.back;
      const strap = kind === "circuitpack" ? "#2EE6D6" : dark(col, 0.12);
      return both(tube(`M${pt(CX - b.sh + 18, 276)} C${pt(CX - b.sh + 26, 320)} ${pt(CX - b.sh + 18, 360)} ${pt(CX - b.sh + 6, 384)}`, 12, strap, dark(col, 0.6), 2.4)) +
        both(path(`M${pt(CX - b.sh + 14, 330)} h12 v10 h-12 Z`, "#C9CED6", "#5B6472", 1.6));
    }
    if (kind === "tote") {
      const col = ctx.c.back;
      const [hx] = handPos(ctx, -1);
      return line(`M${pt(CX + 30, 270)} L${pt(hx + 14, 400)}`, dark(col, 0.55), 9) + line(`M${pt(CX + 30, 270)} L${pt(hx + 14, 400)}`, col, 5) +
        path(`M${pt(hx - 22, 392)} h48 l4 54 h-56 Z`, ctx.shade("tote", col), dark(col, 0.55), 3) + path(`M${pt(hx - 8, 410)} h20 v16 h-20 Z`, light(col, 0.4), null, 0, ' opacity="0.7"');
    }
    if (kind === "messenger") {
      const col = ctx.c.back;
      return line(`M${pt(CX - 34, 270)} L${pt(CX + b.hip + 6, 404)}`, dark(col, 0.55), 11) + line(`M${pt(CX - 34, 270)} L${pt(CX + b.hip + 6, 404)}`, col, 7) +
        path(`M${pt(CX + b.hip - 18, 388)} h52 v42 q-26 6 -52 0 Z`, ctx.shade("msg", col), dark(col, 0.55), 3) +
        path(`M${pt(CX + b.hip - 18, 388)} h52 v18 q-26 6 -52 0 Z`, ctx.shade("msg2", dark(col, 0.1)), dark(col, 0.55), 2.4) + circle(CX + b.hip + 8, 404, 3, "#C9CED6");
    }
    if (kind === "cape") return both(circle(CX - 34, 272, 8, "#E7B43C", "#8A5F12", 2.4)) + line(`M${pt(CX - 34, 272)} Q${pt(CX, 282)} ${pt(CX + 34, 272)}`, "#E7B43C", 3);
    return "";
  }

  // ---------- mobility ----------
  function mobilityBack(ctx) {
    if (ctx.config.mobility !== "wheelchair") return "";
    const b = ctx.build;
    let out = "";
    for (const s of [-1, 1]) {
      const wx = CX + s * (b.hip + 50);
      const wy = 472;
      const spokes = [];
      for (let i = 0; i < 6; i += 1) {
        const a = (i * Math.PI) / 6;
        spokes.push(`M${pt(wx - Math.cos(a) * 58, wy - Math.sin(a) * 58)} L${pt(wx + Math.cos(a) * 58, wy + Math.sin(a) * 58)}`);
      }
      out += line(`M${pt(CX + s * (b.sh - 10), 262)} V440`, "#5B6472", 9) + line(`M${pt(CX + s * (b.sh - 10), 262)} V440`, "#A9B1BC", 5) + circle(CX + s * (b.sh - 10), 262, 6, "#22303A");
      out += circle(wx, wy, 70, "none", "#22303A", 12) + circle(wx, wy, 62, "none", "#A9B1BC", 3) + line(spokes.join(" "), "#C9CED6", 2) + circle(wx, wy, 8, "#5B6472", "#22303A", 2.4);
    }
    return out;
  }
  function mobilityFront(ctx) {
    const kind = ctx.config.mobility;
    const b = ctx.build;
    if (kind === "wheelchair") {
      return both(line(`M${pt(CX - b.hip - 6, 452)} L${pt(CX - b.hip * 0.5 - 12, 556)}`, "#5B6472", 6) + circle(CX - b.hip - 18, 572, 10, "#22303A", "#0F151A", 2)) +
        path(`M${pt(CX - b.hip - 20, 556)} H${n(CX + b.hip + 20)} V${n(564)} H${n(CX - b.hip - 20)} Z`, "#5B6472", "#22303A", 2);
    }
    return "";
  }
  function aidShafts(ctx) {
    const kind = ctx.config.mobility;
    if (kind === "cane") {
      const [hx, hy] = handPos(ctx, -1);
      return tube(`M${pt(hx + 2, hy - 4)} L${pt(hx - 4, 588)}`, 6, "#7A4A28", "#3E2414", 2) + tube(`M${pt(hx - 14, hy - 2)} Q${pt(hx - 10, hy - 18)} ${pt(hx + 4, hy - 12)} L${pt(hx + 2, hy - 4)}`, 7, "#7A4A28", "#3E2414", 2);
    }
    if (kind === "crutches") return [-1, 1].map((s) => { const [hx, hy] = handPos(ctx, s); return tube(`M${pt(hx, hy - 50)} L${pt(hx + s * 6, 588)}`, 7, "#A9B1BC", "#4B5058", 2) + tube(`M${pt(hx + s * 6, 588)} l0 -1`, 10, "#22303A", "#0F151A", 2); }).join("");
    return "";
  }
  function aidFront(ctx) {
    if (ctx.config.mobility !== "crutches") return "";
    return [-1, 1].map((s) => { const [hx, hy] = handPos(ctx, s); return path(`M${pt(hx - 14, hy - 56)} q14 -10 28 0 l-2 10 q-12 -6 -24 0 Z`, "#4B5058", "#22303A", 2) + line(`M${pt(hx - 12, hy + 2)} h24`, "#22303A", 6); }).join("");
  }

  // ---------- composition ----------
  const contexts = {
    full: "0 0 400 600",
    portrait: "56 8 288 288",
    torso: "30 240 340 360",
    face: "112 104 176 136",
    legs: "60 380 280 220",
  };

  function render(input, options = {}) {
    const config = catalog.normalizeForRender(input);
    const context = Object.hasOwn(contexts, options.context) ? options.context : "full";
    renderCount += 1;
    const ctx = createContext(config, `aa${renderCount}`);
    const hw = ctx.headwear;
    const style = hairStyles[config.hair];
    const hideHair = hw?.hidesHair;
    const fittedClip = hw?.fit === "fitted" ? ctx.clip("hat", `<rect x="0" y="${["cap", "circuitcap"].includes(config.headwear) ? 100 : config.headwear === "mortarboard" ? 90 : 104}" width="400" height="500"/>`) : "";
    const t = top(ctx);
    const L = legs(ctx);
    const layers = [
      options.backdrop === false ? "" : backdrop(ctx),
      backLayer(ctx),
      hideHair ? "" : group(style.back?.(ctx) ?? "", fittedClip),
      mobilityBack(ctx),
      L.under,
      shoes(ctx),
      ctx.seated ? "" : L.over,
      neckLayer(ctx),
      t.body,
      // Seated: the lap is drawn over the torso hem so the figure sits forward.
      ctx.seated ? L.over : "",
      aidShafts(ctx),
      arms(ctx, t.sleeves),
      aidFront(ctx),
      mobilityFront(ctx),
      neckItem(ctx),
      backFront(ctx),
      headwearBack(ctx),
      head(ctx),
      faceDetails(ctx),
      facialHairLayer(ctx, "beard"),
      mouth(ctx),
      facialHairLayer(ctx, "mustache"),
      nose(ctx),
      eyes(ctx),
      eyebrows(ctx),
      hideHair ? "" : group(style.front?.(ctx) ?? "", fittedClip),
      glasses(ctx),
      headwearFront(ctx),
      hearing(ctx),
      earrings(ctx),
      options.sticker === false || (context !== "full" && options.sticker !== true) ? "" : sticker(ctx),
    ];
    const title = options.title ? `<title>${escapeText(options.title)}</title>` : "";
    const role = options.decorative ? ' aria-hidden="true" focusable="false"' : ` role="img"${options.title ? "" : ' aria-label="Custom character"'}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${contexts[context]}" class="aa-avatar aa-${context}"${role}>${title}<defs>${ctx.defs.join("")}</defs>${layers.join("")}</svg>`;
  }

  function escapeText(text) {
    return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  // Drawing coverage, for the asset tests: every catalog key has a drawing.
  const coverage = {
    hair: Object.keys(hairStyles), eyes: Object.keys(eyeShapes), brows: Object.keys(browShapes),
    face: Object.keys(faces), build: Object.keys(builds), backdrop: [...Object.keys(flatBackdrops), "campus", "night", "library", "spotlight", "podium", "hall", "circuit"],
  };

  root.AcademicArenaAvatarRenderer = Object.freeze({ render: (input, options) => render(input, options), contexts: Object.keys(contexts), coverage });
})(typeof window !== "undefined" ? window : globalThis);
