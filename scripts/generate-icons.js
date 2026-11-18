const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table for valid PNG chunk checksums
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter type 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idat),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// Signed Distance Function primitives in normalized [-1, 1] coordinates
function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdCapsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax, pay = py - ay;
  const bax = bx - ax, bay = by - ay;
  const lenSq = bax * bax + bay * bay || 1e-6;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / lenSq));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function sdJ(px, py, cx, cy, h, stroke) {
  // Crisp geometric "J"
  const topY = cy - h * 0.45;
  const botY = cy + h * 0.25;
  const rx = cx + h * 0.22;
  const lx = cx - h * 0.18;
  // Top serif bar + vertical stem + bottom curve
  const dTop = sdCapsule(px, py, cx - h * 0.08, topY, rx + h * 0.06, topY, stroke);
  const dStem = sdCapsule(px, py, rx, topY, rx, botY, stroke);
  // Bottom hook arc centered at (cx + 0.02*h, botY) radius 0.20*h
  const acx = (lx + rx) * 0.5;
  const ar = (rx - lx) * 0.5;
  let dArc = 1;
  if (py >= botY) {
    dArc = Math.abs(Math.hypot(px - acx, py - botY) - ar) - stroke;
  } else {
    dArc = Math.min(
      sdCapsule(px, py, lx, botY, lx, botY - h * 0.06, stroke),
      sdCapsule(px, py, rx, botY, rx, botY, stroke)
    );
  }
  return Math.min(dTop, dStem, dArc);
}

function sdR(px, py, cx, cy, h, stroke) {
  const topY = cy - h * 0.45;
  const midY = cy + h * 0.02;
  const botY = cy + h * 0.45;
  const lx = cx - h * 0.26;
  const mx = cx + h * 0.05;
  const rx = cx + h * 0.28;
  const dStem = sdCapsule(px, py, lx, topY, lx, botY, stroke);
  const dTopBar = sdCapsule(px, py, lx, topY, mx, topY, stroke);
  const dMidBar = sdCapsule(px, py, lx, midY, mx, midY, stroke);
  // Right bowl semicircular arc on [topY, midY]
  const bcx = mx;
  const bcy = (topY + midY) * 0.5;
  const br = (midY - topY) * 0.5;
  const dBowl = px >= bcx
    ? Math.abs(Math.hypot(px - bcx, py - bcy) - br) - stroke
    : 1;
  // Diagonal leg
  const dLeg = sdCapsule(px, py, mx - h * 0.02, midY + stroke * 0.2, rx, botY, stroke);
  return Math.min(dStem, dTopBar, dMidBar, dBowl, dLeg);
}

function mix(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function blend(bg, fg, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  return [
    bg[0] * (1 - a) + fg[0] * a,
    bg[1] * (1 - a) + fg[1] * a,
    bg[2] * (1 - a) + fg[2] * a
  ];
}

function sampleColor(u, v, aa) {
  // Rich full-bleed Royal Blue background gradient (#2563EB -> #1D4ED8 -> #1E3A8A)
  const gt = Math.max(0, Math.min(1, (u + v + 2) / 4));
  let bg = [
    mix(37, 29, gt),
    mix(99, 78, gt),
    mix(235, 216, gt)
  ];
  // Subtle top-left radial glow for depth
  const glowDist = Math.hypot(u + 0.45, v + 0.55);
  const glow = Math.max(0, 1 - glowDist / 1.4) * 0.22;
  bg = blend(bg, [96, 165, 250], glow);

  // Subtle decorative ambient circle rings well within background
  const docX = 0, docY = 0;
  // Maskable-safe White Resume/Document Card (fits inside central ~70% safe zone)
  const dShadow = sdRoundBox(u, v, docX + 0.02, docY + 0.045, 0.44, 0.54, 0.10);
  if (dShadow < 0.08) {
    const shAlpha = Math.max(0, (0.08 - dShadow) / 0.14) * 0.28;
    bg = blend(bg, [15, 23, 42], shAlpha);
  }

  const dDoc = sdRoundBox(u, v, docX, docY, 0.44, 0.54, 0.10);
  const docCov = Math.max(0, Math.min(1, 0.5 - dDoc / aa));
  if (docCov > 0) {
    let docCol = [255, 255, 255];

    // Inside Document: Royal Blue "JR" Header Square
    const jrCx = -0.17, jrCy = -0.25;
    const dJrBox = sdRoundBox(u, v, jrCx, jrCy, 0.16, 0.16, 0.055);
    const jrBoxCov = Math.max(0, Math.min(1, 0.5 - dJrBox / aa));
    if (jrBoxCov > 0) {
      let badgeCol = [29, 78, 216]; // #1D4ED8
      const dLetters = Math.min(
        sdJ(u, v, jrCx - 0.062, jrCy + 0.005, 0.15, 0.021),
        sdR(u, v, jrCx + 0.068, jrCy + 0.005, 0.15, 0.021)
      );
      const letterCov = Math.max(0, Math.min(1, 0.5 - dLetters / aa));
      badgeCol = blend(badgeCol, [255, 255, 255], letterCov);
      docCol = blend(docCol, badgeCol, jrBoxCov);
    }

    // Header Title & Subtitle bars beside JR badge
    const dTitleBar = sdRoundBox(u, v, 0.18, -0.30, 0.15, 0.032, 0.016);
    const dSubBar = sdRoundBox(u, v, 0.155, -0.20, 0.125, 0.022, 0.011);
    docCol = blend(docCol, [30, 41, 59], Math.max(0, Math.min(1, 0.5 - dTitleBar / aa)));
    docCol = blend(docCol, [148, 163, 184], Math.max(0, Math.min(1, 0.5 - dSubBar / aa)));

    // Divider line
    const dDiv = sdRoundBox(u, v, 0, -0.02, 0.33, 0.008, 0.004);
    docCol = blend(docCol, [226, 232, 240], Math.max(0, Math.min(1, 0.5 - dDiv / aa)));

    // Resume section lines
    const dL1 = sdRoundBox(u, v, -0.06, 0.09, 0.27, 0.026, 0.013);
    const dL2 = sdRoundBox(u, v, -0.02, 0.20, 0.31, 0.024, 0.012);
    const dL3 = sdRoundBox(u, v, -0.08, 0.31, 0.25, 0.024, 0.012);
    const dL4 = sdRoundBox(u, v, -0.14, 0.41, 0.19, 0.024, 0.012);
    docCol = blend(docCol, [37, 99, 235], Math.max(0, Math.min(1, 0.5 - dL1 / aa)));
    docCol = blend(docCol, [148, 163, 184], Math.max(0, Math.min(1, 0.5 - dL2 / aa)));
    docCol = blend(docCol, [148, 163, 184], Math.max(0, Math.min(1, 0.5 - dL3 / aa)));
    docCol = blend(docCol, [203, 213, 225], Math.max(0, Math.min(1, 0.5 - dL4 / aa)));

    // Emerald Verification Check Badge on bottom-right corner of resume
    const chkCx = 0.25, chkCy = 0.36;
    const dBadge = sdCircle(u, v, chkCx, chkCy, 0.105);
    const badgeCov = Math.max(0, Math.min(1, 0.5 - dBadge / aa));
    if (badgeCov > 0) {
      let emCol = [16, 185, 129]; // #10B981
      const dChk = Math.min(
        sdCapsule(u, v, chkCx - 0.042, chkCy + 0.004, chkCx - 0.010, chkCy + 0.036, 0.015),
        sdCapsule(u, v, chkCx - 0.010, chkCy + 0.036, chkCx + 0.046, chkCy - 0.032, 0.015)
      );
      emCol = blend(emCol, [255, 255, 255], Math.max(0, Math.min(1, 0.5 - dChk / aa)));
      docCol = blend(docCol, emCol, badgeCov);
    }

    bg = blend(bg, docCol, docCov);
  }

  return bg;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 2.2 / size;
  // 2x2 supersampling per pixel for crisp edges
  const offsets = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (const [ox, oy] of offsets) {
        const u = ((x + 0.5 + ox) / size) * 2 - 1;
        const v = ((y + 0.5 + oy) / size) * 2 - 1;
        const c = sampleColor(u, v, aa);
        r += c[0]; g += c[1]; b += c[2];
      }
      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(r / 4);
      rgba[idx + 1] = Math.round(g / 4);
      rgba[idx + 2] = Math.round(b / 4);
      rgba[idx + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

const outDir = path.resolve(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const [name, size] of [
  ['icon-192x192.png', 192],
  ['icon-512x512.png', 512],
  ['apple-touch-icon.png', 180]
]) {
  const png = renderIcon(size);
  fs.writeFileSync(path.join(outDir, name), png);
  console.log(`Generated ${name} (${png.length} bytes)`);
}
