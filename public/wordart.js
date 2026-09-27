// Shared rules, used by the browser AND the API.
// Descriptions are assigned to pictures in submission order: each picture
// holds `cap` descriptions, then the next picture in the queue takes over.
// Every picture is always fully covered: its descriptions repeat at many
// sizes, so it looks complete from the very first description.

export const LIMITS = {
  name: 40,
  phrase: 60,         // max characters of a description (no word limit; long ones can be edited)
  note: 1000,         // optional longer message
  longWords: 4,      // admin list flags descriptions longer than this as 'Long'
  capMin: 5, capMax: 300, capDefault: 40,
  perWindow: 3,
  windowSec: 600,
  photoMaxBytes: 450_000,
};

export const DEFAULT_SETTINGS = {
  mode: 'color',      // 'color' = words take the photo's colors; 'ink' = one ink color
  paper: 'auto',      // background behind the words: 'auto' | 'dark' | 'light'
  ink: '#4a2c1d',     // ink mode only
  grid: 240,          // layout cells across; more = more, smaller words
  maxWord: 0.09,      // largest word height, as a share of the width
  minWord: 2,         // smallest word height, in cells
  keep: 0.55,         // how many photo edges to protect as outlines (0-1)
  outline: 0.2,       // strength of outlines drawn in the background (0 = none)
  follow: 0.8,        // share of words turned upright in regions whose shapes run vertically (0-1)
  underlay: 0.3,      // pixel colors softly behind the letters, so gaps are tinted not white (0-0.6)
  darkness: 0.55,     // ink mode: areas darker than this get words
  // 'words' = original photo background, the person (and what she wears/holds) in words
  // 'white' = words in the background, person left white; 'hair' = like white but dark hair/clothes in words
  // 'off'   = words everywhere
  person: 'words',
  // photo prep
  contrast: 0.4,      // local contrast boost (0-1)
  paint: 0.25,        // gentle painterly smoothing (0-1); the pixel blocks do the simplifying
  palette: 0,         // extra paint-color reduction before pixelation (0 = off)
  bands: 0,           // extra tone bands (0 = off; the pixel blocks already give clear steps)
  // person parts
  regions: true,      // style hair, skin, clothes and accessories differently
  // words
  fill: 'pixel',      // 'pixel' = words matched to pixelated color patches; 'photo' = letters show the painted photo; 'flat' = one color per word
  pixelSize: 3,       // pixel block size, in layout cells
  pixelColors: 7,     // number of shades in the color ramp
  colorMatch: 0.9,    // how strictly a word must sit on one color (0-1)
  colors: 'bwb',      // 'bwb' = only shades of black, blue and white; 'photo' = the photo's own colors
  bgColors: 'photo',  // 'photo' = background stays the original photo; 'match' = background in the same shades
  // two layers: rows of tiny text carry the shading, accent words sit on top
  detail: true,       // continuous rows of tiny text across the person
  rowSize: 2,         // text row height, in layout cells
  faceRow: 0.7,       // face rows are this much finer than the rest
  displace: 0,        // nudge rows up/down with brightness for a 3D feel (0 = straight rows)
  accentMin: 5,       // smallest accent word, in cells (smaller spaces go to the rows)
  seed: 7,            // arrangement seed (Reshuffle picks a new one)
  gapFill: true,      // after matching, fill leftover gaps anywhere (letters still take the pixel colors)
  type: 'serif',      // 'serif' | 'condensed' (condensed = uppercase, packs tighter)
  glaze: 0,           // faint layer of tiny words underneath (0-1); the text rows replace it
  highlights: 0.5,    // leave the brightest spots empty (0-1)
  jitter: 0.3,        // small per-word variation in color/brightness (0-1)
  // finish
  glow: 0.4,          // soft edge where the person meets the photo (0-1)
  grain: 0.2,         // paper grain over the person (0-1)
  smooth: 0.5,        // smooths the person: rounder silhouette, softer shading, fewer stray lines (0-1)
  tonal: 0.7,         // dark areas get dense, bold words; light areas sparse, fine ones (0-1)
  personLine: 0.7,    // strength of the traced silhouette outline
  personDetail: 0.35, // faint feature lines inside the person (eyes, lips, folds)
  hairDark: 0.28,     // 'hair' mode: parts of the person darker than this get words
};

// Brush strokes are stored at a fixed resolution, independent of the grid setting.
export const BRUSH_W = 120;
// Person cutout mask resolution (width). Height follows the photo's shape.
export const PERSON_W = 320;
// Person part labels (region brush + automatic split).
export const REGION = { none: 0, hair: 1, skin: 2, clothes: 3, accessory: 4 };

// Uint8 array <-> base64 (region brush strokes, one byte per cell).
export function encodeBytes(a) { let s = ''; for (const b of a) s += String.fromCharCode(b); return btoa(s); }
export function decodeBytes(b64, n) { const out = new Uint8Array(n); if (!b64) return out; const s = atob(b64); for (let i = 0; i < Math.min(n, s.length); i++) out[i] = s.charCodeAt(i); return out; }

export const personH = (w, h) => Math.round((PERSON_W * h) / w);

// Black -> navy -> blue -> light blue -> white. Shades are sampled along this ramp.
export const BWB_RAMP = [[8, 10, 16], [16, 28, 58], [28, 58, 118], [46, 98, 184], [110, 156, 224], [190, 212, 242], [246, 248, 251]];
export function rampColor(t) {
  const x = Math.min(1, Math.max(0, t)) * (BWB_RAMP.length - 1), i = Math.min(BWB_RAMP.length - 2, Math.floor(x)), f = x - i;
  return BWB_RAMP[i].map((v, k) => v + (BWB_RAMP[i + 1][k] - v) * f);
}

// Stand-in shape for a description: same length and letter widths, different
// letters. Layout is always computed from this shape, so a description's spot is
// the same before and after the reveal, and the words themselves never leave
// the server until the reveal.
const SHAPE = {};
for (const c of 'iljtfrI!|.,:;\'') SHAPE[c] = 'l';
for (const c of 'acenosuvxz') SHAPE[c] = 'n';
for (const c of 'bdhk') SHAPE[c] = 'h';
for (const c of 'gpqy') SHAPE[c] = 'p';
for (const c of 'mwMW') SHAPE[c] = 'm';
export function shapeOf(text) {
  return Array.from(String(text).trim().replace(/\s+/g, ' ')).map((c) =>
    c === ' ' ? ' ' : SHAPE[c] || (/[A-Z]/.test(c) ? 'N' : /[0-9]/.test(c) ? '0' : /[\u0080-\uffff]/.test(c) ? 'm' : 'n')).join('');
}

// ---- wall settings (timing, reveal, page text) ----
export const DEFAULT_CONFIG = {
  open: true,             // accepting descriptions
  opensAt: null,          // optional start (ms since epoch)
  closesAt: null,         // optional end
  revealAt: null,         // optional scheduled reveal
  revealed: true,         // manual reveal switch (false = reveal mode on)
  hoverNames: true,       // show who wrote each description on hover
  slideSeconds: 12,       // party slideshow speed
  text: {
    title: 'Words for Vem',
    intro: 'Describe how you see Vem in a few words. Every description becomes part of her portrait. Hover or tap any word to see who wrote it, and read their messages.',
    nameLabel: 'What does Vem call you?',
    textLabel: 'How do you see Vem?',
    noteLabel: 'A longer message for Vem (optional)',
    noteHint: 'shown when someone hovers or taps your words',
    formTitle: 'Add your words',
    sendLabel: 'Add my words',
    empty: "The first picture hasn't been added yet. Check back soon.",
    example: 'walking sunshine',
    textHint: 'Short phrases work best. Longer ones may be shortened to fit the portrait.',
    thanks: 'Added. Thank you!',
    closed: 'Descriptions are closed. Thank you to everyone who took part!',
    hidden: 'The words stay secret until the reveal. For now, each name sits where that person\'s words will appear.',
    vemWelcome: 'Hi Vem! Your friends had a lot to say about you.',
  },
};
const clip = (v, n, d) => (typeof v === 'string' ? v.slice(0, n) : d);
const time = (v) => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null);
export function cleanConfig(c = {}) {
  const d = DEFAULT_CONFIG, t = c.text || {};
  return {
    open: c.open === undefined ? d.open : !!c.open,
    opensAt: time(c.opensAt), closesAt: time(c.closesAt), revealAt: time(c.revealAt),
    revealed: c.revealed === undefined ? d.revealed : !!c.revealed,
    hoverNames: c.hoverNames === undefined ? d.hoverNames : !!c.hoverNames,
    slideSeconds: Math.min(120, Math.max(3, Math.round(+c.slideSeconds || d.slideSeconds))),
    text: Object.fromEntries(Object.keys(d.text).map((k) => [k, clip(t[k], ['intro', 'hidden', 'vemWelcome', 'closed', 'textHint', 'noteHint', 'empty'].includes(k) ? 400 : 80, d.text[k])])),
  };
}
export const isRevealed = (c, now = Date.now()) => !!c.revealed || (c.revealAt != null && now >= c.revealAt);
export function isOpen(c, now = Date.now()) {
  if (!c.open) return false;
  if (c.opensAt != null && now < c.opensAt) return false;
  if (c.closesAt != null && now >= c.closesAt) return false;
  return true;
}

// Long messages keep line breaks (at most one blank line in a row).
export const cleanNote = (s) => String(s ?? '')
  .replace(/\r\n?/g, '\n')
  .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
  .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Everything one person sent (matched by name, since there are no accounts).
export const personKey = (name) => normalize(name);
export function personSummary(messages, name) {
  const key = personKey(name), mine = messages.filter((m) => personKey(m.name) === key);
  return {
    name: mine.length ? mine[0].name : name,
    descriptions: mine.map((m) => m.text).filter((t) => typeof t === 'string'),
    notes: mine.map((m) => m.note).filter(Boolean),
    // everything they sent, oldest first, with when it was sent
    entries: mine.map((m) => ({ text: m.text, note: m.note || '', at: m.at })).sort((a, b) => a.at - b.at),
  };
}

export const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
export const normalize = (s) => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1-bit masks <-> base64 (brush strokes).
export function encodeMask(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function decodeMask(b64, n) {
  const out = new Uint8Array(n);
  if (!b64) return out;
  const s = atob(b64);
  for (let i = 0; i < n; i++) out[i] = (s.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return out;
}

// Which picture each description belongs to (-1 = no room).
export function assign(pictures, messages) {
  let i = 0, used = 0;
  return messages.map(() => {
    while (i < pictures.length && used >= pictures[i].cap) { i++; used = 0; }
    if (i >= pictures.length) return -1;
    used++; return i;
  });
}
export const totalCap = (pictures) => pictures.reduce((s, p) => s + p.cap, 0);
export function currentIndex(pictures, messages) {
  const a = assign(pictures, messages);
  for (let k = a.length - 1; k >= 0; k--) if (a[k] >= 0) return a[k];
  return 0;
}

// Identical descriptions merge into one group; more senders = more weight.
// Before the reveal, messages carry no text: only `shape` and `gkey` (a hash of
// the normalized text, so identical descriptions still merge). `show` is what
// gets drawn: the words once revealed, otherwise the sender's name.
export const groupKey = (text) => 'k' + hash(normalize(text)).toString(36);
export function groupsFor(picIdx, messages, assignment) {
  const map = new Map();
  messages.forEach((m, k) => {
    if (assignment[k] !== picIdx) return;
    const key = m.gkey || groupKey(m.text);
    if (!map.has(key)) {
      const shown = typeof m.text === 'string' ? m.text.trim() : m.name;
      map.set(key, { key, text: shown, show: shown, hidden: typeof m.text !== 'string', shape: m.shape || shapeOf(m.text), names: [], ids: [], weight: 0, star: 0 });
    }
    const g = map.get(key); g.names.push(m.name); g.ids.push(m.id); g.weight++;
    g.star = Math.max(g.star, m.star || 0); // 1 = featured, 2 = top: they get the big spaces first
  });
  return [...map.values()];
}

export function cleanSettings(s = {}) {
  const d = DEFAULT_SETTINGS, num = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);
  return {
    mode: s.mode === 'ink' ? 'ink' : 'color',
    paper: ['light', 'dark'].includes(s.paper) ? s.paper : 'auto',
    ink: /^#[0-9a-f]{6}$/i.test(s.ink || '') ? s.ink.toLowerCase() : d.ink,
    grid: Math.round(num(s.grid, 160, 320, d.grid)),
    maxWord: num(s.maxWord, 0.03, 0.18, d.maxWord),
    minWord: Math.round(num(s.minWord, 2, 6, d.minWord)),
    keep: num(s.keep, 0, 1, d.keep),
    outline: num(s.outline, 0, 1, d.outline),
    follow: num(s.follow, 0, 1, d.follow),
    underlay: num(s.underlay, 0, 0.6, d.underlay),
    darkness: num(s.darkness, 0.15, 0.9, d.darkness),
    person: ['words', 'white', 'hair', 'off'].includes(s.person) ? s.person : d.person,
    smooth: num(s.smooth, 0, 1, d.smooth),
    contrast: num(s.contrast, 0, 1, d.contrast),
    paint: num(s.paint, 0, 1, d.paint),
    palette: (v => (v < 2 ? 0 : v))(Math.round(num(s.palette, 0, 16, d.palette))),
    bands: (v => (v < 2 ? 0 : v))(Math.round(num(s.bands, 0, 8, d.bands))),
    regions: s.regions === undefined ? d.regions : !!s.regions,
    fill: ['flat', 'photo', 'pixel'].includes(s.fill) ? s.fill : d.fill,
    pixelSize: Math.round(num(s.pixelSize, 1, 12, d.pixelSize)),
    pixelColors: Math.round(num(s.pixelColors, 2, 16, d.pixelColors)),
    colorMatch: num(s.colorMatch, 0, 1, d.colorMatch),
    gapFill: s.gapFill === undefined ? d.gapFill : !!s.gapFill,
    seed: Math.round(num(s.seed, 1, 1e9, d.seed)),
    colors: s.colors === 'photo' ? 'photo' : 'bwb',
    bgColors: s.bgColors === 'match' ? 'match' : 'photo',
    detail: s.detail === undefined ? d.detail : !!s.detail,
    rowSize: num(s.rowSize, 1.5, 5, d.rowSize),
    faceRow: num(s.faceRow, 0.4, 1, d.faceRow),
    displace: num(s.displace, 0, 1, d.displace),
    accentMin: Math.round(num(s.accentMin, 2, 12, d.accentMin)),
    type: s.type === 'condensed' ? 'condensed' : 'serif',
    glaze: num(s.glaze, 0, 1, d.glaze),
    highlights: num(s.highlights, 0, 1, d.highlights),
    jitter: num(s.jitter, 0, 1, d.jitter),
    glow: num(s.glow, 0, 1, d.glow),
    grain: num(s.grain, 0, 1, d.grain),
    tonal: num(s.tonal, 0, 1, d.tonal),
    personLine: num(s.personLine, 0, 1, d.personLine),
    personDetail: num(s.personDetail, 0, 1, d.personDetail),
    hairDark: num(s.hairDark, 0.05, 0.6, d.hairDark),
  };
}
