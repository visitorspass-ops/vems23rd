// Word placement (browser). Fills the allowed area with the descriptions,
// largest words first, using each word's real letter shapes for collision so
// small words tuck into the gaps.
//  - words never cross the outline map (keeps the curves)
//  - only horizontal or vertical; each person part picks ONE direction
//    (hair usually vertical, face and clothes horizontal) for a calm look
//  - tone drives size, weight and density: dark = big, bold, dense
//  - person parts get their own style (hair dense/bold, skin tiny/airy,
//    clothes medium, accessories an accent script)
//  - the brightest highlights stay empty
//  - an optional "glaze" pass lays tiny faint words underneath
import { rng, hash, BRUSH_W, REGION } from './wordart.js';

export const FAMILIES = {
  play: { family: 'Playfair Display', lo: 400, hi: 900 },
  gara: { family: 'EB Garamond', lo: 400, hi: 800 },
  osw: { family: 'Oswald', lo: 300, hi: 700 },
  lob: { family: 'Lobster', lo: 400, hi: 400 },
};
export const fontCss = (f, px) => `${f.w} ${px}px "${FAMILIES[f.fam].family}", Georgia, serif`;

const OS = 2; // glyphs rasterized at 2x the cell grid, then pooled
export const LINE_H = 1.05; // line spacing for multi-line descriptions, in font sizes
const glyphCache = new Map();
let gctx = null;
function glyph(text, f, size, ang) {
  const key = `${text}|${f.fam}|${f.w}|${size}|${ang}`;
  let g = glyphCache.get(key);
  if (g) return g;
  if (!gctx) gctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const ctx = gctx;
  ctx.font = fontCss(f, size * OS);
  // Multi-line blocks: lines separated by \n, stacked and centered.
  const lines = text.split('\n'), lh = size * OS * LINE_H;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)), th = size * OS * 1.1 + (lines.length - 1) * lh;
  const R = Math.ceil(Math.hypot(tw, th) / 2) + 2;
  ctx.canvas.width = ctx.canvas.height = 2 * R;
  ctx.font = fontCss(f, size * OS);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000';
  ctx.translate(R, R); ctx.rotate(ang);
  lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
  const data = ctx.getImageData(0, 0, 2 * R, 2 * R).data;
  const cells = Math.ceil((2 * R) / OS), pts = [];
  for (let cy = 0; cy < cells; cy++) for (let cx = 0; cx < cells; cx++) {
    let a = 0;
    for (let dy = 0; dy < OS; dy++) for (let dx = 0; dx < OS; dx++) {
      const px = cx * OS + dx, py = cy * OS + dy;
      if (px < 2 * R && py < 2 * R) a = Math.max(a, data[(py * 2 * R + px) * 4 + 3]);
    }
    if (a > 20) pts.push(cx - (cells >> 1), cy - (cells >> 1));
  }
  g = Int16Array.from(pts);
  g.mw = tw / OS; // text width in cells, so the drawn words fit the same box
  if (glyphCache.size > 20000) glyphCache.clear();
  glyphCache.set(key, g);
  return g;
}
export { glyph };

// Split a description into n balanced lines at spaces. Returns the text with \n
// and the break positions (character indices), so the shown words split identically.
export function wrapLines(text, n) {
  const chars = Array.from(text);
  if (n <= 1) return { text, br: [] };
  const spaces = chars.map((c, i) => (c === ' ' ? i : -1)).filter((i) => i > 0);
  if (spaces.length < n - 1) return { text, br: [] };
  const br = [];
  for (let k = 1; k < n; k++) {
    const target = (chars.length * k) / n;
    let best = -1;
    for (const sp of spaces) if (!br.includes(sp) && (best < 0 || Math.abs(sp - target) < Math.abs(best - target))) best = sp;
    br.push(best);
  }
  br.sort((a, b) => a - b);
  return { text: chars.map((c, i) => (br.includes(i) ? '\n' : c)).join(''), br };
}
// Preferred number of lines for a description of this length (up to 3).
export const linesFor = (len) => (len <= 16 ? 1 : len <= 34 ? 2 : 3);

// Per-part style: size multiplier, extra darkness (weight), density boost.
const STYLE = {
  [REGION.none]: { size: 1, weight: 0, dense: 0 },
  [REGION.hair]: { size: 1, weight: 0.25, dense: 0.6 },
  [REGION.skin]: { size: 0.5, weight: -0.35, dense: -0.2 },
  [REGION.clothes]: { size: 0.85, weight: 0, dense: 0.2 },
  [REGION.accessory]: { size: 0.8, weight: 0, dense: 0.3 },
};

function pickFont(S, reg, tone, s, maxS, r) {
  if (reg === REGION.accessory) return { fam: 'lob', w: 400 };
  const condensed = S.type === 'condensed';
  if (!condensed && reg !== REGION.skin && s >= maxS * 0.6 && tone < 0.45 && r() < 0.35) return { fam: 'lob', w: 400 };
  const fam = condensed ? 'osw' : s <= 3 ? 'gara' : 'play', F = FAMILIES[fam];
  const dark = Math.min(1, Math.max(0, 1 - tone + (S.regions ? STYLE[reg].weight : 0)));
  return { fam, w: Math.round((F.lo + (F.hi - F.lo) * dark) / 100) * 100 };
}

// groups: [{text, weight}]; brush: {fine, empty} at BRUSH_W. layer: 'main' | 'glaze'.
export async function layoutPicture(A, S, groups, { seed = 1, brush = null, layer = 'main', pins = [], onProgress, budgetMs = 14 } = {}) {
  const { W, H, tone, edge, angle, coh, detail, rgb, region } = A, N = W * H;
  const r = rng(((S.seed || seed) ^ hash(groups.map((g) => g.key || g.shape).join('|'))) + (layer === 'glaze' ? 99 : 0));
  const occ = new Uint8Array(N), owner = new Int32Array(N).fill(-1), placements = [];
  const ink = S.mode === 'ink', useReg = S.regions && A.personBits;
  const caps = S.type === 'condensed';
  const pix = S.fill === 'pixel' && A.pix && layer === 'main' ? A.pix : null;
  const twoLayer = S.detail && layer === 'main' && !!A.personBits;

  const bw = brush ? BRUSH_W : 0, bh = brush ? Math.round((BRUSH_W * H) / W) : 0;
  const bAt = (arr, i) => { const x = i % W, y = (i - x) / W; return arr[Math.min(bh - 1, Math.floor((y * bh) / H)) * bw + Math.min(bw - 1, Math.floor((x * bw) / W))]; };

  // Where words may go, and the largest word allowed at each cell.
  const allowed = new Uint8Array(N), cap = new Float32Array(N);
  const maxS = Math.max(S.minWord + 1, Math.round(S.maxWord * W));
  const hiCut = 0.97 - S.highlights * 0.17; // brightness above this stays empty
  for (let i = 0; i < N; i++) {
    if (brush && bAt(brush.empty, i)) continue;
    if (ink && tone[i] > S.darkness) continue;
    if (A.personBits) {
      if (S.person === 'words' && !A.person[i]) continue;
      if ((S.person === 'white' || S.person === 'hair') && A.person[i] && !(S.person === 'hair' && A.lum[i] < S.hairDark)) continue;
    }
    if (S.highlights > 0 && A.lum[i] > hiCut && !(useReg && region[i] === REGION.hair)) continue;
    // Two-layer mode: the face is left to the fine text rows.
    if (twoLayer && A.face[i]) continue;
    allowed[i] = 1;
    let d = detail[i];
    if (brush && bAt(brush.fine, i)) d = 1;
    let c = maxS * (1 - 0.85 * Math.pow(d, 0.7));
    if (ink) c *= 0.45 + 0.55 * Math.min(1, ((S.darkness - tone[i]) / Math.max(0.05, S.darkness)) * 1.6);
    else if (S.tonal > 0) c *= 1 - S.tonal * 0.6 * tone[i];
    if (useReg) c *= STYLE[region[i]].size;
    cap[i] = Math.max(S.minWord, c);
  }
  // Starred words may go anywhere on her figure except the face.
  const starOK = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (brush && bAt(brush.empty, i)) continue;
    if (S.highlights > 0 && A.lum[i] > hiCut) continue; // white-on-white would vanish
    if (A.personBits ? (S.person === 'words' ? A.person[i] && !A.face[i] : allowed[i]) : allowed[i]) starOK[i] = 1;
  }
  // Edge cells are kept clear so outlines stay visible (starred words may cover fine ones).
  const hardEdge = new Uint8Array(N);
  if (S.outline > 0 || A.personBits) for (let i = 0; i < N; i++) if (edge[i] && (S.outline > 0 || A.person[i])) hardEdge[i] = 1;

  // One direction per person part: vertical if its shapes mostly run up and down.
  const vertReg = new Uint8Array(5);
  if (useReg) {
    const v = [0, 0, 0, 0, 0], n = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) if (allowed[i] && coh[i] > 0.25) { n[region[i]]++; if (Math.abs(angle[i]) > Math.PI / 4) v[region[i]]++; }
    for (let k = 0; k < 5; k++) vertReg[k] = n[k] > 30 && v[k] / n[k] > 0.5 ? 1 : 0;
    vertReg[REGION.skin] = 0; // faces read best horizontally
  }

  // Weighted deck so every description appears, popular ones more often.
  const deck = [];
  groups.forEach((g, gi) => { for (let k = 0; k < Math.min(8, g.weight); k++) deck.push(gi); });
  let di = Math.floor(r() * deck.length);
  const nextGroup = () => deck[(di++) % deck.length];

  // Chosen people first: 'top' (star 2) and 'featured' (star 1) descriptions get
  // the largest sizes before anyone else. Top ones also get an extra-large size.
  const topG = [], featG = [];
  groups.forEach((g, gi) => { if (g.star === 2) topG.push(gi); else if (g.star === 1) featG.push(gi); });
  const levels = []; // {s, deck, star}
  const minS = twoLayer ? Math.max(S.minWord, S.accentMin) : S.minWord;
  // how many big placements each chosen description is owed (top: 2, featured: 1)
  const owed = new Map([...topG.map((g) => [g, 2]), ...featG.map((g) => [g, 1])]);
  // everyone else is owed one readable spot too; long descriptions are hardest, so they go first
  const everyone = groups.map((g, i) => i).filter((i) => !owed.has(i)).sort((a, b) => groups[b].shape.length - groups[a].shape.length);
  const owedAll = new Map(everyone.map((g) => [g, 1]));
  const readable = Math.max(minS, 6);
  if (layer === 'glaze') levels.push({ s: S.minWord, deck: null });
  else {
    if (owed.size) for (const f of [1.1, 0.95, 0.8, 0.68, 0.56, 0.45]) {
      const sz = Math.round(maxS * f);
      if (sz >= minS) levels.push({ s: sz, deck: 'owed', star: true });
    }
    for (const f of [0.75, 0.62, 0.5, 0.42, 0.34, 0.28]) {
      const sz = Math.max(readable, Math.round(maxS * f));
      if (!levels.some((l) => l.deck === 'all' && l.s === sz)) levels.push({ s: sz, deck: 'all', star: true });
    }
    for (let s = maxS; s >= minS; s = s > minS + 1 ? Math.round(s * 0.8) : s - 1)
      levels.push({ s, deck: levels.filter((l) => !l.star).length < 2 && owed.size ? [...topG, ...topG, ...featG, ...deck] : null });
  }
  // Pixel mode: after the color-matched passes, one last pass fills gaps anywhere
  // (not needed when the text rows fill the gaps).
  const gapPass = pix && S.gapFill && !twoLayer ? levels.length : -1;
  if (gapPass >= 0) levels.push({ s: S.minWord, deck: null });
  const sizes = levels.map((l) => l.s);

  // Pinned descriptions go exactly where the admin put them, before anything else.
  for (const pin of layer === 'main' ? pins : []) {
    if (pin.g == null || !groups[pin.g]) continue;
    const text = caps ? groups[pin.g].shape.toUpperCase() : groups[pin.g].shape;
    const f = pickFont(S, useReg ? region[pin.y * W + pin.x] : 0, tone[pin.y * W + pin.x] || 0.3, pin.s, maxS, r);
    const pts = glyph(text, f, pin.s, pin.ang), idx = placements.length;
    let R = 0, G = 0, B = 0, n = 0;
    for (let p = 0; p < pts.length; p += 2) {
      const x = pin.x + pts[p], y = pin.y + pts[p + 1];
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = y * W + x; occ[j] = 1; owner[j] = idx; R += rgb[j * 3]; G += rgb[j * 3 + 1]; B += rgb[j * 3 + 2]; n++;
    }
    placements.push({ g: pin.g, sh: text, mw: pts.mw, x: pin.x, y: pin.y, s: pin.s, ang: pin.ang, f, color: n ? [R / n, G / n, B / n] : [0, 0, 0], j: 0, pinned: true });
    if (owed.has(pin.g)) owed.set(pin.g, 0);
  }
  let last = performance.now(), done = 0;
  for (let si = 0; si < sizes.length; si++) {
    const s = sizes[si], anywhere = si === gapPass, lv = levels[si];
    // starred levels only hand out descriptions that are still owed a big spot, in order
    const book = lv.deck === 'all' ? owedAll : owed;
    let lp = 0, owedList = lv.deck === 'owed' || lv.deck === 'all' ? [...book.keys()].filter((g) => book.get(g) > 0) : null;
    if (owedList && !owedList.length) continue;
    const pickG = () => (owedList ? owedList[lp++ % owedList.length] : lv.deck ? lv.deck[Math.floor(r() * lv.deck.length)] : nextGroup());
    const stride = layer === 'glaze' ? 2 : s <= 3 ? 1 : Math.max(1, Math.floor(s * 0.45));
    const cand = [];
    for (let y = 0; y < H; y += stride) for (let x = 0; x < W; x += stride) {
      const xx = Math.min(W - 1, x + Math.floor(r() * stride)), yy = Math.min(H - 1, y + Math.floor(r() * stride));
      const i = yy * W + xx;
      if (lv.star ? starOK[i] && !occ[i] : allowed[i] && !occ[i] && !hardEdge[i] && cap[i] >= s) cand.push(i); // starred words ignore the busy-area size limit
    }
    for (let k = cand.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [cand[k], cand[j]] = [cand[j], cand[k]]; }

    for (const i of cand) {
      if (occ[i]) continue;
      const reg = useReg ? region[i] : 0, t = tone[i];
      // Tonal density: lighter areas skip more spots (glaze layer ignores this).
      if (layer === 'main' && !anywhere && !lv.star && S.tonal > 0 && !ink) {
        const dense = useReg ? STYLE[reg].dense : 0;
        if (r() < Math.max(0, S.tonal * Math.pow(t, 1.5) * 0.9 - dense * 0.4)) continue;
      }
      const cx = i % W, cy = (i - cx) / W;
      const gi = pickG(), raw = groups[gi].shape, text = caps ? raw.toUpperCase() : raw;
      // long descriptions try a wrapped block first (preferred lines, then fewer)
      const want = linesFor(Array.from(raw).length), variants = [];
      for (let n = want; n >= 1; n--) { const w = wrapLines(text, n); if (n === 1 || w.br.length) variants.push(w); }
      let ang = 0;
      if (S.follow > 0) {
        if (useReg ? vertReg[reg] && r() < S.follow : coh[i] > 0.3 && Math.abs(angle[i]) > Math.PI / 4 && r() < S.follow * 0.7) ang = -Math.PI / 2;
      }
      const f = layer === 'glaze' ? { fam: caps ? 'osw' : 'gara', w: caps ? 300 : 400 } : pickFont(S, reg, t, s, maxS, r);
      // Starred words try both directions and may cross more fine edges (curls).
      const angles = lv.star ? [ang, ang ? 0 : -Math.PI / 2] : [ang];
      const tries = [];
      for (const v of lv.star ? variants : variants.slice(0, 1)) for (const a2 of angles) tries.push([v, a2]);
      let pts = null, n = 0, used = variants[0];
      for (const [v, a2] of tries) {
        const g2 = glyph(v.text, f, s, a2);
        let ok = g2.length > 0, edgeHits = 0, tooBig = 0, off = 0;
        const lc = pix ? pix.label[i] : 255;
        for (let p = 0; p < g2.length && ok; p += 2) {
          const x = cx + g2[p], y = cy + g2[p + 1];
          if (x < 0 || y < 0 || x >= W || y >= H) { ok = false; break; }
          const j = y * W + x;
          if (occ[j] || (lv.star ? !starOK[j] : !allowed[j] || hardEdge[j])) { ok = false; break; }
          if (useReg && lv.deck !== 'all' && region[j] !== reg && A.person[j]) { ok = false; break; } // stay within one part (guaranteed spots may span parts)
          if (edge[j]) edgeHits++;
          if (cap[j] < s * 0.7) tooBig++;
          if (pix && pix.label[j] !== lc) off++;
        }
        const nn = g2.length / 2;
        if (!ok || (!lv.star && edgeHits > Math.max(1, nn * 0.03)) || (!lv.star && tooBig > nn * 0.15)) continue;
        // Same-color rule: the word must sit (almost) entirely on one color patch.
        if (pix && !anywhere && !lv.star && off > nn * (1 - S.colorMatch) * 0.6) continue;
        pts = g2; n = nn; ang = a2; used = v; break;
      }
      if (!pts) continue;
      const idx = placements.length;
      let R = 0, G = 0, B = 0;
      for (let p = 0; p < pts.length; p += 2) {
        const j = (cy + pts[p + 1]) * W + cx + pts[p];
        occ[j] = 1; owner[j] = idx; R += rgb[j * 3]; G += rgb[j * 3 + 1]; B += rgb[j * 3 + 2];
      }
      placements.push({ g: gi, sh: used.text, br: used.br, lines: used.br.length + 1, mw: pts.mw, x: cx, y: cy, s, ang, f, color: [R / n, G / n, B / n], j: r() * 2 - 1 });
      if (owedList && book.get(gi) > 0) {
        book.set(gi, book.get(gi) - 1);
        owedList = owedList.filter((g) => book.get(g) > 0);
        if (!owedList.length) break;
      }
      if (performance.now() - last > budgetMs) { await new Promise((res) => setTimeout(res, 0)); last = performance.now(); }
    }
    done++;
    onProgress && onProgress(done / sizes.length);
  }
  return { placements, owner };
}

// ---- detail layer: continuous rows of tiny text across the person ----
// The descriptions are strung together like a paragraph and flowed into
// horizontal rows that fill every part of her figure not taken by an accent
// word. Rows are finer on the face. Shading comes from each letter's color and
// weight (taken from the pixel blocks), not from gaps.
let mctx = null;
function unitWidth(text, f) {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  mctx.font = fontCss(f, 100);
  return mctx.measureText(text).width / 100;
}
export function layoutRows(A, S, groups, accent, { seed = 1, brush = null } = {}) {
  const { W, H, region, tone } = A, N = W * H, r = rng((S.seed || seed) * 31 + 7);
  const owner = new Int32Array(N).fill(-1), runs = [];
  if (!A.personBits) return { runs, owner };
  const caps = S.type === 'condensed', fam = caps ? 'osw' : 'gara';
  // keep a 1-cell gap around accent words
  const block = new Uint8Array(N);
  if (accent) for (let i = 0; i < N; i++) if (accent.owner[i] >= 0) {
    const x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) block[yy * W + xx] = 1; }
  }
  const bw = brush ? BRUSH_W : 0, bh = brush ? Math.round((BRUSH_W * H) / W) : 0;
  const empty = (i) => { if (!brush) return 0; const x = i % W, y = (i - x) / W; return brush.empty[Math.min(bh - 1, Math.floor((y * bh) / H)) * bw + Math.min(bw - 1, Math.floor((x * bw) / W))]; };
  const ok = (i, face) => A.person[i] && !block[i] && !empty(i) && !!A.face[i] === face;
  // stream of descriptions (weighted, starred ones a little more often)
  const deck = [];
  groups.forEach((g, gi) => { for (let k = 0; k < Math.min(8, g.weight) + (g.star || 0); k++) deck.push(gi); });
  for (let k = deck.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [deck[k], deck[j]] = [deck[j], deck[k]]; }
  let di = 0;
  const sep = '  ·  ', widths = groups.map((g) => unitWidth((caps ? g.shape.toUpperCase() : g.shape) + sep, { fam, w: 500 }));
  for (const face of [false, true]) {
    const h = S.rowSize * (face ? S.faceRow : 1);
    for (let y = 0; y + h <= H; y += h) {
      const yc = Math.min(H - 1, Math.floor(y + h / 2));
      let x = 0;
      while (x < W) {
        while (x < W && !ok(yc * W + x, face)) x++;
        const x0 = x;
        while (x < W && ok(yc * W + x, face)) x++;
        if (x - x0 < 2) continue;
        const run = { y, h, x0, x1: x, items: [] }, size = h * 0.92;
        let xs = x0 - r() * widths[deck[di % deck.length]] * size; // stagger so words don't line up in columns
        while (xs < x) {
          const g = deck[di++ % deck.length], w = widths[g] * size, cxm = Math.min(W - 1, Math.max(0, Math.round(xs + w / 2)));
          const t = tone[yc * W + Math.min(x - 1, Math.max(x0, cxm))], F = FAMILIES[fam];
          const wt = Math.round((F.lo + (F.hi - F.lo) * Math.min(1, 1.15 - t)) / 100) * 100; // darker = bolder
          const dy = S.displace ? (0.5 - t) * S.displace * h * 0.8 : 0;
          run.items.push({ g, x: xs, w, f: { fam, w: wt }, dy });
          for (let cx = Math.max(x0, Math.floor(xs)); cx < Math.min(x, Math.ceil(xs + w)); cx++)
            for (let cy = Math.floor(y); cy < Math.min(H, Math.ceil(y + h)); cy++) owner[cy * W + cx] = g;
          xs += w;
        }
        runs.push(run);
      }
    }
  }
  return { runs, owner, caps, size: 0.92 };
}
