import { PERSON_W, BRUSH_W, REGION } from './wordart.js';
// Photo analysis (browser). Produces, per layout cell:
//  rgb/lum   the photo's color and brightness
//  edge      cleaned outline map (strong, connected edges only; specks removed)
//  angle/coh the local line direction (so words can follow curls and folds) and how clear it is
//  detail    how busy the area is (busy = small words, flat sky = big words)
export async function loadImage(src) {
  if (typeof src !== 'string') return src;
  const img = new Image(); img.src = src; await img.decode(); return img;
}

// Downscale an upload for storage (the only copy of the photo the site keeps).
export function toStoredPhoto(img, maxSide = 640, quality = 0.84) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    let s = 0, n = 0;
    for (let x = -r; x < W + r; x++) {
      if (x + r < W && x + r >= 0) { s += src[y * W + x + r]; n++; }
      if (x - r - 1 >= 0) { s -= src[y * W + x - r - 1]; n--; }
      if (x >= 0 && x < W) tmp[y * W + x] = s / n;
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let y = -r; y < H + r; y++) {
      if (y + r < H && y + r >= 0) { s += tmp[(y + r) * W + x]; n++; }
      if (y - r - 1 >= 0) { s -= tmp[(y - r - 1) * W + x]; n--; }
      if (y >= 0 && y < H) out[y * W + x] = s / n;
    }
  }
  return out;
}

function percentile(arr, p) {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

// person: optional cutout bits at PERSON_W x personH resolution.
// img: the prepared (painted) photo; opts.original: the untouched photo (used to find skin);
// opts.bands: tone bands; opts.regionBrush: admin-painted part labels at BRUSH_W resolution.
export function analyzePhoto(img, W, keep = 0.55, person = null, smooth = 0, opts = {}) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const H = Math.round((W * ih) / iw), N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const rgb = new Uint8ClampedArray(N * 3), lum = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
    lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
  }
  // Sobel on lightly blurred brightness + color difference, so edges between
  // equally bright but different colors (skin vs sky) still count.
  const lb = boxBlur(lum, W, H, 1);
  const cb = [0, 1, 2].map((k) => boxBlur(Float32Array.from({ length: N }, (_, i) => rgb[i * 3 + k] / 255), W, H, 1));
  const gx = new Float32Array(N), gy = new Float32Array(N), mag = new Float32Array(N);
  const at = (a, xx, yy) => a[Math.min(H - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
  for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
    const i = yy * W + xx;
    const sob = (a) => [
      at(a, xx + 1, yy - 1) + 2 * at(a, xx + 1, yy) + at(a, xx + 1, yy + 1) - at(a, xx - 1, yy - 1) - 2 * at(a, xx - 1, yy) - at(a, xx - 1, yy + 1),
      at(a, xx - 1, yy + 1) + 2 * at(a, xx, yy + 1) + at(a, xx + 1, yy + 1) - at(a, xx - 1, yy - 1) - 2 * at(a, xx, yy - 1) - at(a, xx + 1, yy - 1),
    ];
    const [lx, ly] = sob(lb);
    let cm = 0; for (const a of cb) { const [ax, ay] = sob(a); cm = Math.max(cm, Math.hypot(ax, ay)); }
    gx[i] = lx; gy[i] = ly; mag[i] = Math.max(Math.hypot(lx, ly), cm * 0.8);
  }
  // Outline: keep only strong edges (thinned to local maxima), then remove specks.
  const t = percentile(mag, 0.97 - keep * 0.17);
  const edge = new Uint8Array(N);
  for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) {
    const i = yy * W + xx; if (mag[i] < t) continue;
    const horiz = Math.abs(gx[i]) > Math.abs(gy[i]);
    const a = horiz ? mag[i - 1] : mag[i - W], b = horiz ? mag[i + 1] : mag[i + W];
    if (mag[i] >= a && mag[i] >= b) edge[i] = 1;
  }
  removeSpecks(edge, W, H, Math.max(6, Math.round(W / 30)));
  // Line direction from the smoothed structure tensor.
  const jxx = boxBlur(gx.map((v) => v * v), W, H, 3), jyy = boxBlur(gy.map((v) => v * v), W, H, 3);
  const jxy = boxBlur(Float32Array.from(gx, (v, i) => v * gy[i]), W, H, 3);
  const angle = new Float32Array(N), coh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let a = 0.5 * Math.atan2(2 * jxy[i], jxx[i] - jyy[i]) + Math.PI / 2; // along the lines
    while (a > Math.PI / 2) a -= Math.PI; while (a <= -Math.PI / 2) a += Math.PI;
    angle[i] = a;
    const tr = jxx[i] + jyy[i];
    coh[i] = tr > 1e-6 ? Math.sqrt((jxx[i] - jyy[i]) ** 2 + 4 * jxy[i] ** 2) / tr : 0;
  }
  const busy = boxBlur(mag, W, H, Math.max(2, Math.round(W / 60))), p95 = percentile(busy, 0.95) || 1;
  const detail = busy.map((v) => Math.min(1, v / p95));
  // Smoothing: round off the silhouette, soften shading, drop stray lines.
  if (person && smooth > 0) person = smoothMask(person, PERSON_W, Math.round(person.length / PERSON_W), Math.round(1 + smooth * 6));
  if (smooth > 0) {
    const ls = boxBlur(lum, W, H, Math.max(1, Math.round(smooth * 2)));
    lum.set(ls);
    removeSpecks(edge, W, H, Math.round(Math.max(6, W / 30) * (1 + smooth * 4)));
  }
  // Person cutout, sampled to the layout grid.
  const pm = new Uint8Array(N);
  if (person) {
    const pw = PERSON_W, ph = Math.round(person.length / pw);
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++)
      pm[yy * W + xx] = person[Math.min(ph - 1, Math.floor(((yy + 0.5) * ph) / H)) * pw + Math.min(pw - 1, Math.floor(((xx + 0.5) * pw) / W))];
  }
  // Tone used for light/shade decisions, optionally split into bands.
  const tone = new Float32Array(N), nb = opts.bands || 0;
  for (let i = 0; i < N; i++) tone[i] = nb >= 2 ? Math.min(nb - 1, Math.floor(lum[i] * nb)) / (nb - 1) : lum[i];
  const region = person ? splitRegions(W, H, pm, opts.original || img, detail, lum, opts.regionBrush) : new Uint8Array(N);
  // Face = skin in the top part of the figure (arms and back are other skin).
  const face = new Uint8Array(N);
  if (person) {
    let top = H, bottom = 0;
    for (let i = 0; i < N; i++) if (pm[i]) { const y = (i / W) | 0; if (y < top) top = y; if (y > bottom) bottom = y; }
    const cut = top + (bottom - top) * 0.42;
    for (let i = 0; i < N; i++) if (pm[i] && region[i] === REGION.skin && i / W < cut) face[i] = 1;
  }
  return { W, H, rgb, lum, tone, edge, angle, coh, detail, person: pm, personBits: person, region, face };
}

// Split the person into hair / skin / clothes. Skin: a standard skin-color test on
// the untouched photo. Hair: dark, textured parts (or dark parts in the top of the
// figure). Everything else is clothes. Admin brush labels (or the AI model's
// labels, stored the same way) override the guess.
function splitRegions(W, H, pm, original, detail, lum, brushBytes) {
  const N = W * H, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(original, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  let top = H, bottom = 0;
  for (let i = 0; i < N; i++) if (pm[i]) { const y = (i / W) | 0; if (y < top) top = y; if (y > bottom) bottom = y; }
  let reg = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (!pm[i]) continue;
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const Y = 0.299 * r + 0.587 * g + 0.114 * b, cb = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b, cr = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
    const skin = cr > 135 && cr < 180 && cb > 77 && cb < 130 && Y > 55 && r > g && r > b;
    const y = (i / W) | 0, upper = y < top + (bottom - top) * 0.45;
    reg[i] = skin ? REGION.skin : lum[i] < 0.33 && (detail[i] > 0.3 || upper) ? REGION.hair : REGION.clothes;
  }
  // majority filter twice to remove speckle between parts
  for (let pass = 0; pass < 2; pass++) {
    const out = reg.slice();
    for (let y = 1; y < H - 1; y++) for (let xx = 1; xx < W - 1; xx++) {
      const i = y * W + xx; if (!pm[i]) continue;
      const cnt = [0, 0, 0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[reg[i + dy * W + dx]]++;
      let best = reg[i]; for (let k = 1; k <= 3; k++) if (cnt[k] > cnt[best] + 1) best = k;
      out[i] = best;
    }
    reg = out;
  }
  if (brushBytes) {
    const bh = Math.round(brushBytes.length / BRUSH_W);
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      const i = y * W + xx; if (!pm[i]) continue;
      const v = brushBytes[Math.min(bh - 1, Math.floor(((y + 0.5) * bh) / H)) * BRUSH_W + Math.min(BRUSH_W - 1, Math.floor(((xx + 0.5) * BRUSH_W) / W))];
      if (v) reg[i] = v;
    }
  }
  return reg;
}

// Blur the 0/1 mask and threshold it again: rounds corners and removes jagged edges.
export function smoothMask(bits, W, H, r) {
  const f = boxBlur(Float32Array.from(bits), W, H, r), out = new Uint8Array(bits.length);
  for (let i = 0; i < out.length; i++) out[i] = f[i] > 0.5 ? 1 : 0;
  return out;
}

// Remove edge fragments smaller than `min` cells (8-connected).
export function removeSpecks(bits, W, H, min) {
  const seen = new Uint8Array(W * H), stack = [], comp = [];
  for (let s = 0; s < bits.length; s++) {
    if (!bits[s] || seen[s]) continue;
    stack.length = 0; comp.length = 0; stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop(); comp.push(i);
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (bits[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (comp.length < min) for (const i of comp) bits[i] = 0;
  }
}
