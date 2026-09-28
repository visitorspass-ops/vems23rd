// Drawing (browser).
import { FAMILIES, fontCss, LINE_H } from './layout.js';
import { PERSON_W } from './wordart.js';
import { contourSegments } from './person.js';
import { nearestPalette } from './prep.js';
import { rampPhoto } from './pixel.js';

export const PAPERS = { dark: '#15161b', light: '#f3f1ec' };

export function paperFor(A, S) {
  if (S.paper !== 'auto') return S.paper;
  if (S.person === 'words' && A.personBits) return 'light';
  if (A._paper) return A._paper;
  let s = 0; for (let i = 0; i < A.lum.length; i++) s += A.lum[i];
  return (A._paper = s / A.lum.length > 0.33 ? 'light' : 'dark');
}

export function sizeCanvas(canvas, w, h, dpr = window.devicePixelRatio || 1) {
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
const hex = (h) => { const v = parseInt(h.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };

// Flat mode: one color per word, snapped to the paint palette, readable on the paper.
function flatColor(p, S, paper, A) {
  let [r, g, b] = S.mode === 'ink' ? hex(S.ink) : A.palette ? nearestPalette(A.palette, p.color) : p.color;
  if (S.mode !== 'ink') {
    const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (paper === 'dark' && l < 0.28) { const m = Math.min(3, 0.28 / Math.max(0.02, l)); r = r * m + 18; g = g * m + 18; b = b * m + 18; }
    if (paper === 'light') { const k = l > 0.7 ? 0.62 / l : 0.8; r *= k; g *= k; b *= k; }
  }
  const jt = 1 + 0.18 * S.jitter * p.j;
  return `rgb(${Math.min(255, r * jt) | 0},${Math.min(255, g * jt) | 0},${Math.min(255, b * jt) | 0})`;
}

// Draws the shown text (words, or the sender's name before the reveal) inside the
// box the layout reserved for the description's stand-in shape.
function drawText(ctx, p, k, txt) {
  ctx.font = fontCss(p.f, p.s * k);
  ctx.save(); ctx.translate((p.x + 0.5) * k, (p.y + 0.5) * k); ctx.rotate(p.ang);
  const maxW = p.mw ? Math.max(1, p.mw * k * 1.02) : undefined, chars = Array.from(txt);
  if (p.br && p.br.length && chars.length === Array.from(p.sh).length) {
    // wrapped description: break the real words at the same places as the layout's shape
    const lines = [], cuts = [-1, ...p.br, chars.length];
    for (let i = 0; i < cuts.length - 1; i++) lines.push(chars.slice(cuts[i] + 1, cuts[i + 1]).join(''));
    const lh = p.s * k * LINE_H;
    lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lh, maxW));
  } else if (p.br && p.br.length) {
    // before the reveal the block shows a name: center it in the block
    ctx.fillText(txt, 0, 0, maxW);
  } else ctx.fillText(txt, 0, 0, maxW);
  ctx.restore();
}

// Words either in flat colors, or as windows onto the painted photo.
function drawWords(ctx, list, k, width, h, S, paper, A, fill, alphaOf, dpr, showOf) {
  if (!list.length) return;
  if ((S.fill === 'photo' || S.fill === 'pixel') && fill && S.mode !== 'ink') {
    const off = document.createElement('canvas');
    const ox = sizeCanvas(off, width, h, dpr);
    ox.textAlign = 'center'; ox.textBaseline = 'middle'; ox.fillStyle = '#000';
    for (const p of list) { ox.globalAlpha = alphaOf(p) * (1 - 0.3 * S.jitter * Math.abs(p.j)); drawText(ox, p, k, showOf(p.g)); }
    ox.globalAlpha = 1; ox.globalCompositeOperation = 'source-in';
    // pixel mode keeps the patch colors nearly exact (a touch darker so light patches stay readable)
    ox.filter = S.fill === 'pixel' ? (paper === 'light' ? 'brightness(0.9)' : 'brightness(1.15)')
      : paper === 'light' ? 'brightness(0.8) saturate(1.2)' : 'brightness(1.35) saturate(1.15)';
    ox.imageSmoothingEnabled = S.fill !== 'pixel';
    ox.drawImage(fill, 0, 0, width, h); ox.filter = 'none';
    ctx.globalAlpha = 1; ctx.drawImage(off, 0, 0, width, h);
    return;
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of list) { ctx.globalAlpha = alphaOf(p); ctx.fillStyle = flatColor(p, S, paper, A); drawText(ctx, p, k, showOf(p.g)); }
  ctx.globalAlpha = 1;
}

// Detail rows: text flowed into rows, each letter colored from the pixel blocks.
function drawRows(ctx, R, k, width, h, S, paper, fill, dim, dpr, showOf) {
  if (!R || !R.runs.length) return;
  const off = document.createElement('canvas'), ox = sizeCanvas(off, width, h, dpr);
  ox.textAlign = 'left'; ox.textBaseline = 'middle'; ox.fillStyle = '#000';
  for (const run of R.runs) {
    ox.save(); ox.beginPath(); ox.rect(run.x0 * k, run.y * k, (run.x1 - run.x0) * k, run.h * k); ox.clip();
    const px = run.h * R.size * k;
    for (const it of run.items) {
      ox.globalAlpha = dim(it.g);
      ox.font = fontCss(it.f, px);
      const t = showOf(it.g);
      ox.fillText(t, it.x * k, (run.y + run.h / 2 + it.dy) * k, Math.max(1, (it.w - run.h * 0.6) * k));
    }
    ox.restore();
  }
  ox.globalAlpha = 1; ox.globalCompositeOperation = 'source-in';
  ox.imageSmoothingEnabled = S.fill !== 'pixel';
  ox.filter = paper === 'light' ? 'brightness(0.92)' : 'brightness(1.15)';
  ox.drawImage(fill, 0, 0, width, h); ox.filter = 'none';
  ctx.globalAlpha = 1; ctx.drawImage(off, 0, 0, width, h);
}

function personShape(A, paper) {
  if (A._pshape && A._pshapeKey === paper) return A._pshape;
  const pw = PERSON_W, ph = Math.round(A.personBits.length / pw), c = document.createElement('canvas');
  c.width = pw; c.height = ph;
  const x = c.getContext('2d'), img = x.createImageData(pw, ph), [r, g, b] = hex(PAPERS[paper]);
  for (let i = 0; i < A.personBits.length; i++) if (A.personBits[i]) img.data.set([r, g, b, 255], i * 4);
  x.putImageData(img, 0, 0); A._pshape = c; A._pshapeKey = paper;
  return c;
}

function drawPersonLines(ctx, A, S, width, h, paper) {
  const color = S.mode === 'ink' ? S.ink : paper === 'dark' ? '#e9e4dc' : '#3b342e';
  if (S.personDetail > 0) {
    const key = 'f' + S.mode + S.ink;
    if (A._pfeatKey !== key) {
      const { W, H, edge, person } = A, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'), img = x.createImageData(W, H), [r, g, b] = hex(S.mode === 'ink' ? S.ink : '#3b342e');
      for (let i = 0; i < W * H; i++) if (edge[i] && person[i]) img.data.set([r, g, b, 255], i * 4);
      x.putImageData(img, 0, 0); A._pfeat = c; A._pfeatKey = key;
    }
    ctx.globalAlpha = Math.min(1, S.personDetail * 1.1); ctx.imageSmoothingEnabled = true;
    ctx.filter = `blur(${Math.max(0.4, width / A.W / 3)}px)`; ctx.drawImage(A._pfeat, 0, 0, width, h); ctx.filter = 'none';
  }
  if (S.personLine > 0) {
    const bits = A.personBits, pw = PERSON_W, ph = Math.round(bits.length / pw);
    if (!A._pseg) A._pseg = contourSegments(bits, pw, ph);
    const k = width / pw, seg = A._pseg;
    ctx.globalAlpha = S.personLine; ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1, width / 380);
    ctx.beginPath();
    for (let i = 0; i < seg.length; i += 4) { ctx.moveTo((seg[i] + 0.5) * k, (seg[i + 1] + 0.5) * k); ctx.lineTo((seg[i + 2] + 0.5) * k, (seg[i + 3] + 0.5) * k); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

let noise = null;
function drawGrain(ctx, A, S, width, h, dpr) {
  if (!noise) {
    noise = document.createElement('canvas'); noise.width = noise.height = 160;
    const x = noise.getContext('2d'), img = x.createImageData(160, 160);
    for (let i = 0; i < 160 * 160; i++) { const v = 150 + Math.random() * 105; img.data.set([v, v, v, 255], i * 4); }
    x.putImageData(img, 0, 0);
  }
  const t = document.createElement('canvas'), tx = sizeCanvas(t, width, h, dpr);
  tx.fillStyle = tx.createPattern(noise, 'repeat'); tx.fillRect(0, 0, width, h);
  if (A.personBits && S.person !== 'off') { tx.globalCompositeOperation = 'destination-in'; tx.imageSmoothingEnabled = true; tx.drawImage(personShape(A, 'light'), 0, 0, width, h); }
  ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = S.grain * 0.22; ctx.drawImage(t, 0, 0, width, h);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

// art = {A, L (main), G (glaze), S, img (original), fill (painted)}; focus: group index.
export function drawArt(canvas, art, width, { focus = null, placeholder = false, dpr } = {}) {
  const { A, L, G, R, S, img, fill } = art;
  const k = width / A.W, h = A.H * k;
  const ctx = sizeCanvas(canvas, width, h, dpr), paper = paperFor(A, S), d = dpr || window.devicePixelRatio || 1;
  const wordsOnPerson = S.person === 'words' && A.personBits;
  ctx.imageSmoothingEnabled = true;

  if (wordsOnPerson) {
    let bg = img;                                              // untouched photo...
    if (S.bgColors === 'match' && S.colors === 'bwb') {        // ...or the same black/blue/white shades
      if (!A._bgRamp || A._bgRampK !== S.pixelColors) { A._bgRamp = rampPhoto(img, S.pixelColors); A._bgRampK = S.pixelColors; }
      bg = A._bgRamp;
    }
    ctx.drawImage(bg, 0, 0, width, h);
    const shape = personShape(A, paper);
    if (S.glow > 0) {                                          // soft edge into the photo
      ctx.globalAlpha = S.glow * 0.9; ctx.filter = `blur(${Math.max(1, S.glow * width / 70)}px)`;
      ctx.drawImage(shape, 0, 0, width, h); ctx.filter = 'none'; ctx.globalAlpha = 1;
    }
    ctx.drawImage(shape, 0, 0, width, h);
    if (S.underlay > 0) {                                       // soft tone of her own colors
      const t = document.createElement('canvas'), tx = sizeCanvas(t, width, h, d);
      // pixel mode: the color patches themselves (lightly softened) sit behind the words
      tx.filter = `blur(${art.pixel ? Math.max(0.5, k * 0.6) : Math.max(1, Math.round(k * 2))}px)`;
      tx.imageSmoothingEnabled = true; tx.drawImage(fill || img, 0, 0, width, h); tx.filter = 'none';
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(shape, 0, 0, width, h);
      ctx.globalCompositeOperation = paper === 'light' ? 'multiply' : 'screen'; ctx.globalAlpha = S.underlay;
      ctx.drawImage(t, 0, 0, width, h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
  } else {
    ctx.fillStyle = PAPERS[paper]; ctx.fillRect(0, 0, width, h);
    if (S.underlay > 0) {
      ctx.globalCompositeOperation = paper === 'light' ? 'multiply' : 'screen'; ctx.globalAlpha = S.underlay;
      ctx.filter = `${S.mode === 'ink' ? 'grayscale(1) ' : ''}blur(${Math.max(1, Math.round(k * 2))}px)`;
      ctx.drawImage(fill || img, 0, 0, width, h); ctx.filter = 'none'; ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    if (A.personBits && S.person !== 'off') ctx.drawImage(personShape(A, 'light'), 0, 0, width, h);
  }
  if (A.personBits && S.person !== 'off') drawPersonLines(ctx, A, S, width, h, paper);

  const dim = (p) => (placeholder ? 0.45 : 1) * (focus == null || focus === p.g ? 1 : 0.12);
  const showOf = (g) => { const t = art.groups[g] ? art.groups[g].show : ''; return S.type === 'condensed' ? t.toUpperCase() : t; };
  if (G && S.glaze > 0) drawWords(ctx, G.placements, k, width, h, S, paper, A, fill, () => S.glaze * 0.85 * (focus == null ? 1 : 0.3), d, showOf);
  if (R) drawRows(ctx, R, k, width, h, S, paper, fill, (g) => (placeholder ? 0.45 : 1) * (focus == null || focus === g ? 1 : 0.15), d, showOf);
  drawWords(ctx, L.placements, k, width, h, S, paper, A, fill, dim, d, showOf);
  if (S.grain > 0) drawGrain(ctx, A, S, width, h, d);
}

// Print presets: width in pixels at the stated resolution (portrait sheets).
export const PRINT = {
  a4: { label: 'A4 (300 dpi)', px: 2480 }, a3: { label: 'A3 (300 dpi)', px: 3508 },
  a2: { label: 'A2 (200 dpi)', px: 3307 }, web: { label: 'Screen (2400 px)', px: 2400 },
};
// High-resolution PNG, optionally with a caption line (title and date) underneath.
export function exportPNG(art, width = 2400, { caption = '' } = {}) {
  const c = document.createElement('canvas');
  drawArt(c, art, width, { dpr: 1 });
  if (!caption) return c;
  const band = Math.round(width * 0.06), out = document.createElement('canvas');
  out.width = c.width; out.height = c.height + band;
  const x = out.getContext('2d');
  x.fillStyle = '#fbfaf7'; x.fillRect(0, 0, out.width, out.height); x.drawImage(c, 0, 0);
  x.fillStyle = '#1c2233'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `500 ${Math.round(band * 0.36)}px "Playfair Display", Georgia, serif`;
  x.fillText(caption, out.width / 2, c.height + band / 2, out.width * 0.9);
  return out;
}

// Which description is under this point: accent words first, then the text rows.
export function hitGroup(art, px, py, width) {
  const { A, L, R } = art, k = width / A.W, cx = Math.floor(px / k), cy = Math.floor(py / k);
  if (R && cx >= 0 && cy >= 0 && cx < A.W && cy < A.H && L.owner[cy * A.W + cx] < 0 && R.owner[cy * A.W + cx] >= 0) return R.owner[cy * A.W + cx];
  for (let r = 0; r <= 2; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= A.W || y >= A.H) continue;
    const o = L.owner[y * A.W + x];
    if (o >= 0) return L.placements[o].g;
  }
  return null;
}

let fontsPromise = null;
export function fontsLoaded() {
  if (!fontsPromise) fontsPromise = Promise.race([
    Promise.all(Object.values(FAMILIES).flatMap((f) => [f.lo, f.hi].map((w) => document.fonts.load(`${w} 24px "${f.family}"`)))).catch(() => {}),
    new Promise((r) => setTimeout(r, 5000)),
  ]);
  return fontsPromise;
}
