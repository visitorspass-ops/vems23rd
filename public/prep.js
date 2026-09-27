// Photo preparation (browser), run once per picture before any words are placed:
//  1. local contrast  - deepens eyes/brows/lips, lifts highlights
//  2. painterly smoothing (Kuwahara) - flattens skin texture into clean patches, keeps edges
//  3. palette reduction (k-means) - a small set of "paint" colors for a cohesive look
// The result feeds both the analysis (so words follow clean tones) and the
// letter fill (words show these painted colors through their shapes).
import { rng } from './wordart.js';

function integral(src, W, H) {
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let run = 0;
    for (let x = 0; x < W; x++) { run += src[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + run; }
  }
  return I;
}
const rect = (I, W, x0, y0, x1, y1) => { const w = W + 1; return I[y1 * w + x1] - I[y0 * w + x1] - I[y1 * w + x0] + I[y0 * w + x0]; };

function blurLum(L, W, H, r) {
  const I = integral(L, W, H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(W, x + r + 1), y1 = Math.min(H, y + r + 1);
    out[y * W + x] = rect(I, W, x0, y0, x1, y1) / ((x1 - x0) * (y1 - y0));
  }
  return out;
}

export function prepPhoto(img, S, maxSide = 640) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, sc = Math.min(1, maxSide / Math.max(iw, ih));
  const W = Math.round(iw * sc), H = Math.round(ih * sc), N = W * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0, W, H);
  const id = x.getImageData(0, 0, W, H), d = id.data;
  let R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) { R[i] = d[i * 4]; G[i] = d[i * 4 + 1]; B[i] = d[i * 4 + 2]; }
  const lumOf = (i) => 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];

  // 1. local contrast (unsharp mask on brightness, applied to all channels)
  if (S.contrast > 0) {
    const L = Float32Array.from({ length: N }, (_, i) => lumOf(i));
    const Lb = blurLum(L, W, H, Math.round(W / 40));
    for (let i = 0; i < N; i++) {
      const l2 = Math.min(255, Math.max(0, L[i] + S.contrast * 1.2 * (L[i] - Lb[i])));
      const k = L[i] > 1 ? l2 / L[i] : 1;
      R[i] = Math.min(255, R[i] * k); G[i] = Math.min(255, G[i] * k); B[i] = Math.min(255, B[i] * k);
    }
  }

  // 2. Kuwahara: each pixel takes the mean of whichever of its 4 neighboring
  //    quadrants is most uniform, so flat areas smooth out but edges stay crisp.
  const rad = Math.round(S.paint * 6);
  if (rad > 0) {
    const L = Float32Array.from({ length: N }, (_, i) => lumOf(i)), L2 = L.map((v) => v * v);
    const IR = integral(R, W, H), IG = integral(G, W, H), IB = integral(B, W, H), IL = integral(L, W, H), IL2 = integral(L2, W, H);
    const R2 = new Float32Array(N), G2 = new Float32Array(N), B2 = new Float32Array(N);
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
      let best = Infinity, bi = null;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const x0 = Math.max(0, xx + dx * rad), y0 = Math.max(0, y + dy * rad);
        const x1 = Math.min(W, x0 + rad + 1), y1 = Math.min(H, y0 + rad + 1), n = (x1 - x0) * (y1 - y0);
        const m = rect(IL, W, x0, y0, x1, y1) / n, v = rect(IL2, W, x0, y0, x1, y1) / n - m * m;
        if (v < best) { best = v; bi = [x0, y0, x1, y1, n]; }
      }
      const [x0, y0, x1, y1, n] = bi, i = y * W + xx;
      R2[i] = rect(IR, W, x0, y0, x1, y1) / n; G2[i] = rect(IG, W, x0, y0, x1, y1) / n; B2[i] = rect(IB, W, x0, y0, x1, y1) / n;
    }
    R = R2; G = G2; B = B2;
  }

  // 3. palette: k-means on a sample of pixels, then snap every pixel to its nearest color
  let palette = null;
  if (S.palette >= 2) {
    const r = rng(11), K = S.palette, samples = [];
    for (let t = 0; t < 6000; t++) { const i = Math.floor(r() * N); samples.push([R[i], G[i], B[i]]); }
    // k-means++ style start: spread initial colors by brightness
    samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    let cent = Array.from({ length: K }, (_, k) => [...samples[Math.floor(((k + 0.5) / K) * samples.length)]]);
    const near = (p) => { let bd = Infinity, bk = 0; for (let k = 0; k < K; k++) { const c2 = cent[k], dd = (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2 + (p[2] - c2[2]) ** 2; if (dd < bd) { bd = dd; bk = k; } } return bk; };
    for (let it = 0; it < 10; it++) {
      const acc = cent.map(() => [0, 0, 0, 0]);
      for (const p of samples) { const k = near(p), a = acc[k]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; }
      cent = cent.map((c2, k) => (acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c2));
    }
    palette = cent;
    const p = [0, 0, 0];
    for (let i = 0; i < N; i++) { p[0] = R[i]; p[1] = G[i]; p[2] = B[i]; const k = near(p); R[i] = cent[k][0]; G[i] = cent[k][1]; B[i] = cent[k][2]; }
  }

  for (let i = 0; i < N; i++) { d[i * 4] = R[i]; d[i * 4 + 1] = G[i]; d[i * 4 + 2] = B[i]; d[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  return { canvas: c, palette };
}

export function nearestPalette(palette, c) {
  let bd = Infinity, best = c;
  for (const p of palette) { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = p; } }
  return best;
}
