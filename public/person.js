// Person cutout (admin, browser).
//  - segmentPerson(): runs Google's MediaPipe selfie-segmentation model in the
//    browser (loaded from jsDelivr on first use, about 12 MB, admin page only)
//  - refineMask(): smooths the model's rough 256x256 output, removes specks and
//    small holes, so the white silhouette has clean curves
//  - contourSegments(): traces the silhouette edge as smooth line segments
import { PERSON_W, BRUSH_W, REGION } from './wordart.js';
import { removeSpecks } from './analyze.js';

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/';
let seg = null;
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
}
export async function segmentPerson(img) {
  if (!seg) {
    if (!window.SelfieSegmentation) await loadScript(MP + 'selfie_segmentation.js');
    seg = new window.SelfieSegmentation({ locateFile: (f) => MP + f });
    seg.setOptions({ modelSelection: 0 }); // general model (256x256)
    await seg.initialize();
  }
  const mask = await new Promise((res) => { seg.onResults((r) => res(r.segmentationMask)); seg.send({ image: img }); });
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const PH = Math.round((PERSON_W * h) / w);
  const c = document.createElement('canvas'); c.width = PERSON_W; c.height = PH;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.drawImage(mask, 0, 0, PERSON_W, PH);
  const d = x.getImageData(0, 0, PERSON_W, PH).data, conf = new Float32Array(PERSON_W * PH);
  // The mask carries confidence in alpha on some GPUs and in red on others.
  let useAlpha = false;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { useAlpha = true; break; }
  for (let i = 0; i < conf.length; i++) conf[i] = d[i * 4 + (useAlpha ? 3 : 0)] / 255;
  return refineMask(conf, PERSON_W, PH);
}

function blur3(f, W, H) {
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += f[yy * W + xx]; n++; }
    }
    o[y * W + x] = s / n;
  }
  return o;
}

export function refineMask(conf, W, H) {
  const f = blur3(conf, W, H), bits = new Uint8Array(W * H);
  for (let i = 0; i < bits.length; i++) bits[i] = f[i] > 0.5 ? 1 : 0;
  removeSpecks(bits, W, H, Math.round(W * H * 0.004));               // stray blobs
  const holes = bits.map((v) => 1 - v); removeSpecks(holes, W, H, Math.round(W * H * 0.004));
  for (let i = 0; i < bits.length; i++) if (!holes[i]) bits[i] = 1;  // fill small holes
  return bits;
}

// Marching squares on a lightly blurred mask -> smooth segments [x1,y1,x2,y2,...] in mask cells.
export function contourSegments(bits, W, H) {
  const f = blur3(Float32Array.from(bits), W, H), t = 0.5, out = [];
  const lerp = (a, b) => (t - a) / (b - a || 1e-6);
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = f[y * W + x], b = f[y * W + x + 1], c = f[(y + 1) * W + x + 1], d = f[(y + 1) * W + x];
    const k = (a > t) | ((b > t) << 1) | ((c > t) << 2) | ((d > t) << 3);
    if (k === 0 || k === 15) continue;
    const T = [x + lerp(a, b), y], R = [x + 1, y + lerp(b, c)], B = [x + lerp(d, c), y + 1], L = [x, y + lerp(a, d)];
    const segs = { 1: [L, T], 2: [T, R], 3: [L, R], 4: [R, B], 5: [L, T, R, B], 6: [T, B], 7: [L, B], 8: [B, L], 9: [T, B], 10: [T, R, B, L], 11: [R, B], 12: [R, L], 13: [T, R], 14: [L, T] }[k];
    for (let i = 0; i < segs.length; i += 2) out.push(segs[i][0], segs[i][1], segs[i + 1][0], segs[i + 1][1]);
  }
  return Float32Array.from(out);
}

// Hair / skin / clothes / accessories with Google's multi-class selfie model
// (MediaPipe Tasks, loaded on first use from jsDelivr and Google's model storage).
// Returns {person, region} or throws if the model can't load.
const TASKS = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1'; // version checked on npm
const MULTI = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
let multi = null;
export async function segmentParts(img, bh) {
  if (!multi) {
    const vision = await import(/* webpackIgnore: true */ `${TASKS}/vision_bundle.mjs`);
    const files = await vision.FilesetResolver.forVisionTasks(`${TASKS}/wasm`);
    multi = await vision.ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MULTI }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
    });
  }
  const res = multi.segment(img), cm = res.categoryMask, mw = cm.width, mh = cm.height, cls = cm.getAsUint8Array();
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, PH = Math.round((PERSON_W * h) / w);
  // person = any non-background class, refined like the single-class cutout
  const conf = new Float32Array(PERSON_W * PH);
  for (let y = 0; y < PH; y++) for (let x = 0; x < PERSON_W; x++)
    conf[y * PERSON_W + x] = cls[Math.min(mh - 1, Math.floor(((y + 0.5) * mh) / PH)) * mw + Math.min(mw - 1, Math.floor(((x + 0.5) * mw) / PERSON_W))] > 0 ? 1 : 0;
  const person = refineMask(conf, PERSON_W, PH);
  // classes: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 others (accessories)
  const map = [0, REGION.hair, REGION.skin, REGION.skin, REGION.clothes, REGION.accessory];
  const region = new Uint8Array(BRUSH_W * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < BRUSH_W; x++)
    region[y * BRUSH_W + x] = map[cls[Math.min(mh - 1, Math.floor(((y + 0.5) * mh) / bh)) * mw + Math.min(mw - 1, Math.floor(((x + 0.5) * mw) / BRUSH_W))]] || 0;
  cm.close && cm.close();
  return { person, region };
}
