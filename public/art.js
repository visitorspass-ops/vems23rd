// Glue: photo -> prep -> analysis -> layouts (main + glaze), cached per picture.
import { decodeMask, decodeBytes, BRUSH_W, PERSON_W, cleanSettings, hash } from './wordart.js';
import { loadImage, analyzePhoto } from './analyze.js';
import { prepPhoto } from './prep.js';
import { layoutPicture, layoutRows } from './layout.js';
import { applySnapshot } from './lock.js';
import { buildPixelMap } from './pixel.js';

const cache = new Map();

export function brushFor(pic, H, W) {
  const n = BRUSH_W * Math.round((BRUSH_W * H) / W);
  return { fine: decodeMask(pic.brushFine, n), empty: decodeMask(pic.brushEmpty, n) };
}
export function personBits(pic, img) {
  if (!pic.person) return null;
  const h = Math.round((PERSON_W * (img.naturalHeight || img.height)) / (img.naturalWidth || img.width));
  return decodeMask(pic.person, PERSON_W * h);
}
export function regionBytes(pic, img) {
  if (!pic.brushRegion) return null;
  const h = Math.round((BRUSH_W * (img.naturalHeight || img.height)) / (img.naturalWidth || img.width));
  return decodeBytes(pic.brushRegion, BRUSH_W * h);
}

// Shared by the messenger page and the admin editor.
export async function buildArt(c, S, parts, groups, onProgress) {
  const pkey = `${S.contrast}|${S.paint}|${S.palette}`;
  if (c.Pkey !== pkey) { c.P = prepPhoto(c.img, S); c.Pkey = pkey; c.Akey = null; }
  const akey = `${pkey}|${S.grid}|${S.keep}|${S.smooth}|${S.bands}|${parts.key}`;
  if (c.Akey !== akey) {
    c.Xkey = null;
    c.A = analyzePhoto(c.P.canvas, S.grid, S.keep, parts.person, S.smooth, { bands: S.bands, original: c.img, regionBrush: parts.region });
    c.A.palette = c.P.palette; c.Akey = akey; c.Lkey = null;
  }
  const xkey = S.fill === 'pixel' ? `${akey}|${S.pixelSize}|${S.pixelColors}` : 'off';
  if (c.Xkey !== xkey) { c.A.pix = S.fill === 'pixel' ? buildPixelMap(c.A, S) : null; c.Xkey = xkey; c.Lkey = null; }
  const list = groups.length ? groups : [{ key: 'vem', text: 'Vem', show: 'Vem', shape: 'Vnm', weight: 1, placeholder: true }];
  // Locked picture: positions come from the saved snapshot; only who sits where changes.
  if (parts.lock && parts.lock.W === c.A.W && parts.lock.H === c.A.H && groups.length) {
    const lk = JSON.stringify([akey, parts.lockAt, list.map((g) => [g.key, g.weight, g.star || 0])]);
    if (c.Lkey !== lk) { const res = applySnapshot(c.A, parts.lock, list, S); c.L = res.L; c.R = res.R; c.G = null; c.Lkey = lk; }
    return { img: c.img, fill: S.fill === 'pixel' && c.A.pix ? c.A.pix.canvas : c.P.canvas, pixel: S.fill === 'pixel' && !!c.A.pix, A: c.A, L: c.L, G: null, R: c.R, S, groups: list, placeholder: false, locked: true };
  }
  const pins = (parts.pins || []).map((p) => ({ ...p, g: list.findIndex((g) => g.ids && g.ids.includes(p.id)) })).filter((p) => p.g >= 0);
  const lkey = JSON.stringify([akey, S, parts.brushKey, pins, list.map((g) => [g.key, g.weight, g.star || 0])]);
  if (c.Lkey !== lkey) {
    const opts = { seed: S.seed, brush: parts.brush(c.A.H, c.A.W), pins };
    c.L = await layoutPicture(c.A, S, list, { ...opts, onProgress: (f) => onProgress && onProgress(f * (S.glaze > 0 ? 0.8 : 1)) });
    c.G = S.glaze > 0 ? await layoutPicture(c.A, S, list, { ...opts, layer: 'glaze' }) : null;
    c.R = S.detail && c.A.personBits ? layoutRows(c.A, S, list, c.L, opts) : null;
    c.Lkey = lkey;
  }
  return { img: c.img, fill: S.fill === 'pixel' && c.A.pix ? c.A.pix.canvas : c.P.canvas, pixel: S.fill === 'pixel' && !!c.A.pix, A: c.A, L: c.L, G: c.G, R: c.R, S, groups: list, placeholder: !groups.length };
}

export async function artFor(pic, photoSrc, groups, onProgress) {
  const S = cleanSettings(pic.settings);
  let c = cache.get(pic.id);
  if (!c) { c = {}; cache.set(pic.id, c); }
  if (!c.img) c.img = await loadImage(photoSrc);
  const parts = {
    person: personBits(pic, c.img), region: regionBytes(pic, c.img),
    key: hash((pic.person || '') + '#' + (pic.brushRegion || '')),
    brushKey: hash((pic.brushFine || '') + '#' + (pic.brushEmpty || '')),
    brush: (H, W) => brushFor(pic, H, W),
    pins: pic.pins || [], lock: pic._lock || null, lockAt: pic.lockAt || 0,
  };
  return buildArt(c, S, parts, groups, onProgress);
}
export const forget = (id) => cache.delete(id);
