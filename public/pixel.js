// Pixel color map (browser). Pixelates the person into blocks and snaps each
// block to one of a few colors (k-means in Lab space, so "same color" matches
// what the eye sees). The layout then looks for spots where a whole word sits
// on one color, and the letters are filled from this map, so every word keeps
// the exact color of the patch it sits on.
import { rng, rampColor } from './wordart.js';

function toLab(r, g, b) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = h(x); y = h(y); z = h(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// Returns {label: Uint8Array per cell (255 = not in the person), pal: [[r,g,b]], canvas}
export function buildPixelMap(A, S) {
  const { W, H, rgb, region } = A, N = W * H, inP = (i) => (A.personBits ? A.person[i] : 1);
  const K = Math.max(2, Math.min(16, S.pixelColors)), B = Math.max(1, Math.round(S.pixelSize)), r = rng(5);
  // 1. block average color (per block and per person part, so parts don't bleed)
  const bw = Math.ceil(W / B), acc = new Map();
  for (let i = 0; i < N; i++) {
    if (!inP(i)) continue;
    const x = i % W, y = (i - x) / W, key = ((((y / B) | 0) * bw + ((x / B) | 0)) << 3) | region[i];
    let a = acc.get(key); if (!a) acc.set(key, (a = [0, 0, 0, 0]));
    a[0] += rgb[i * 3]; a[1] += rgb[i * 3 + 1]; a[2] += rgb[i * 3 + 2]; a[3]++;
  }
  const keys = [...acc.keys()], cols = keys.map((k) => { const a = acc.get(k); return [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  if (S.colors === 'bwb') return rampMap(A, S, keys, cols, bw, B, K, inP);
  const labs = cols.map((c) => toLab(...c));
  if (!labs.length) return null;
  // 2. k-means on block colors (Lab), seeded across the lightness range
  const order = labs.map((l, i) => i).sort((a, b) => labs[a][0] - labs[b][0]);
  let cent = Array.from({ length: Math.min(K, labs.length) }, (_, k) => [...labs[order[Math.floor(((k + 0.5) / K) * order.length)]]]);
  const near = (l) => { let bd = Infinity, bk = 0; cent.forEach((c, k) => { const d = (l[0] - c[0]) ** 2 + (l[1] - c[1]) ** 2 + (l[2] - c[2]) ** 2; if (d < bd) { bd = d; bk = k; } }); return bk; };
  let asg = new Array(labs.length).fill(0);
  for (let it = 0; it < 12; it++) {
    asg = labs.map(near);
    const s = cent.map(() => [0, 0, 0, 0]);
    labs.forEach((l, j) => { const t = s[asg[j]]; t[0] += l[0]; t[1] += l[1]; t[2] += l[2]; t[3]++; });
    cent = cent.map((c, k) => (s[k][3] ? [s[k][0] / s[k][3], s[k][1] / s[k][3], s[k][2] / s[k][3]] : [...labs[Math.floor(r() * labs.length)]]));
  }
  // palette color = average RGB of the blocks in each cluster
  const pal = cent.map(() => [0, 0, 0, 0]);
  cols.forEach((c, j) => { const p = pal[asg[j]]; p[0] += c[0]; p[1] += c[1]; p[2] += c[2]; p[3]++; });
  const palRGB = pal.map((p) => (p[3] ? [p[0] / p[3], p[1] / p[3], p[2] / p[3]] : [128, 128, 128]));
  const blockLabel = new Map(keys.map((k, j) => [k, asg[j]]));
  // 3. label every cell with its block's color; draw the pixel image
  const label = new Uint8Array(N).fill(255), c = document.createElement('canvas'); c.width = W; c.height = H;
  const x2 = c.getContext('2d'), img = x2.createImageData(W, H);
  for (let i = 0; i < N; i++) {
    let col;
    if (inP(i)) {
      const x = i % W, y = (i - x) / W, lb = blockLabel.get(((((y / B) | 0) * bw + ((x / B) | 0)) << 3) | region[i]);
      label[i] = lb; col = palRGB[lb];
    } else col = [rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]];
    img.data.set([col[0], col[1], col[2], 255], i * 4);
  }
  x2.putImageData(img, 0, 0);
  return { label, pal: palRGB, canvas: c };
}

// Black / blue / white mode: each block's brightness picks a shade on the ramp.
// Brightness is stretched to the person's own range first, so every photo uses
// the full ramp from near-black to near-white.
function rampMap(A, S, keys, cols, bw, B, K, inP) {
  const { W, H, region } = A, N = W * H;
  const lums = cols.map((c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255);
  const sorted = [...lums].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.03)], hi = sorted[Math.floor(sorted.length * 0.97)] || 1;
  const pal = Array.from({ length: K }, (_, k) => rampColor(k / (K - 1)));
  const blockLabel = new Map(keys.map((key, j) => [key, Math.round(Math.min(1, Math.max(0, (lums[j] - lo) / Math.max(0.05, hi - lo))) * (K - 1))]));
  const label = new Uint8Array(N).fill(255), c = document.createElement('canvas'); c.width = W; c.height = H;
  const x2 = c.getContext('2d'), img = x2.createImageData(W, H);
  for (let i = 0; i < N; i++) {
    let col;
    if (inP(i)) {
      const x = i % W, y = (i - x) / W, lb = blockLabel.get(((((y / B) | 0) * bw + ((x / B) | 0)) << 3) | region[i]);
      label[i] = lb; col = pal[lb];
      A.tone[i] = lb / (K - 1); // pixel blocks come first: they drive light and shade too
    } else col = [A.rgb[i * 3], A.rgb[i * 3 + 1], A.rgb[i * 3 + 2]];
    img.data.set([col[0], col[1], col[2], 255], i * 4);
  }
  x2.putImageData(img, 0, 0);
  return { label, pal, canvas: c };
}

// The whole photo in the same shades (used when the background should match).
export function rampPhoto(img, K) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
  const id = x.getImageData(0, 0, w, h), d = id.data, pal = Array.from({ length: K }, (_, k) => rampColor(k / (K - 1)));
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255, p = pal[Math.round(l * (K - 1))];
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
  }
  x.putImageData(id, 0, 0);
  return c;
}
