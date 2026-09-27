// Admin page: tune how each photo becomes a word portrait, queue pictures
// in fill order, and moderate descriptions.
import { LIMITS, wordCount, DEFAULT_SETTINGS, BRUSH_W, PERSON_W, REGION, cleanSettings, cleanConfig, encodeMask, decodeMask, encodeBytes, decodeBytes, assign, currentIndex, groupsFor, groupKey, shapeOf, normalize } from './wordart.js';
import { loadImage, toStoredPhoto } from './analyze.js';
import { drawArt, sizeCanvas, fontsLoaded, exportPNG, PRINT } from './render.js';
import { makeSnapshot } from './lock.js';
import { forget, buildArt } from './art.js';
import { initWallSettings } from './admin-wall.js';
import { segmentPerson, segmentParts } from './person.js';

const SAMPLE = ['walking sunshine', 'kindest soul ever', 'future big boss', 'fiercely loyal friend', 'brave and bright',
  'queen of kindness', 'soft but strong', 'heart of gold', 'always shows up', 'smart and funny', 'pure good vibes',
  'best hugs ever', 'quietly unstoppable', 'warm like home', 'true blue friend', 'gentle and wise', 'our little star',
  'simply the best', 'sunshine in person', 'loves so deeply'];
const REGION_TINT = { [REGION.hair]: [120, 60, 200], [REGION.skin]: [240, 140, 60], [REGION.clothes]: [40, 160, 90], [REGION.accessory]: [30, 160, 220] };
const NUM = ['grid', 'maxWord', 'minWord', 'keep', 'outline', 'follow', 'underlay', 'darkness', 'personLine', 'personDetail',
  'hairDark', 'tonal', 'smooth', 'contrast', 'paint', 'palette', 'bands', 'glaze', 'highlights', 'jitter', 'glow', 'grain',
  'pixelSize', 'pixelColors', 'colorMatch', 'rowSize', 'faceRow', 'displace', 'accentMin'];
const CHIPS = { mode: 'data-mode', paper: 'data-paper', person: 'data-person', fill: 'data-fill', type: 'data-type', regions: 'data-regions', gapFill: 'data-gapfill', colors: 'data-colors', bgColors: 'data-bgcolors', detail: 'data-detail' };

export function initAdmin(backend, { canSegment = true, canDownload = true } = {}) {
  const $ = (id) => document.getElementById(id);
  let state = { pictures: [], messages: [] };
  let pending = [], ed = null, brush = 'fine', painting = false, tab = 'preview', runId = 0, timer = null, lastArt = null;

  // ---- unlock ----
  async function unlock() {
    try {
      const r = await backend.unlock($('key').value);
      $('lock').hidden = true; $('panel').hidden = false;
      $('ownKeyWarn').hidden = !!(r && r.ownKey); load();
    } catch (e) { $('lockStatus').textContent = e.message; $('lockStatus').classList.add('error'); }
  }
  if ($('signOut')) $('signOut').onclick = () => { backend.signOut(); location.reload(); };
  if (backend.needsKey) {
    $('unlock').onclick = unlock;
    $('key').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
    if (backend.hasKey()) unlock();
  } else { $('lock').hidden = true; $('panel').hidden = false; $('ownKeyWarn').hidden = true; if ($('signOut')) $('signOut').hidden = true; }
  $('printTools').hidden = !canDownload;

  async function load() {
    state = await backend.adminState(); state.messages.forEach((m) => (m.star = m.star || 0));
    renderQueue(); renderMessages(); renderPending(); renderTrash(); renderStats(); wall.load(state.config);
  }
  const wall = initWallSettings(backend, { onSaved: () => load() });

  // ---- uploads ----
  $('files').onchange = async (e) => {
    for (const f of e.target.files) {
      try { const url = URL.createObjectURL(f), img = await loadImage(url); pending.push({ name: f.name, photo: toStoredPhoto(img) }); URL.revokeObjectURL(url); }
      catch { $('edStatus').textContent = `Skipped ${f.name}: not a readable image.`; }
    }
    e.target.value = ''; renderPending();
    if (!ed && pending.length) openEditor({ ...pending[0], pendingIndex: 0 });
  };
  function renderPending() {
    const list = $('pending'); list.replaceChildren();
    pending.forEach((p, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip';
      b.textContent = `New: ${p.name}`; b.setAttribute('aria-pressed', String(!!ed && ed.pendingIndex === i));
      b.onclick = () => openEditor({ ...p, pendingIndex: i }); list.append(b);
    });
  }

  // ---- editor ----
  async function openEditor(src) {
    const img = await loadImage(src.photo), iw = img.naturalWidth, ih = img.naturalHeight;
    const bh = Math.round((BRUSH_W * ih) / iw), ph = Math.round((PERSON_W * ih) / iw);
    ed = {
      ...src, img, bh, ph, S: cleanSettings(src.settings || DEFAULT_SETTINGS), cap: src.cap || LIMITS.capDefault,
      fine: decodeMask(src.brushFine, BRUSH_W * bh), empty: decodeMask(src.brushEmpty, BRUSH_W * bh),
      region: decodeBytes(src.brushRegion, BRUSH_W * bh), person: decodeMask(src.person, PERSON_W * ph),
      personVer: 0, brushVer: 0, pins: (src.pins || []).map((q) => ({ ...q })), lockAt: src.lockAt || 0, _lock: null,
    };
    if (ed.id && ed.lockAt) ed._lock = await backend.getLock(ed.id, ed.lockAt);
    renderPinList(); updateLockUI();
    $('editor').hidden = false;
    $('edTitle').textContent = ed.id ? `Editing ${ed.name}` : `New picture: ${ed.name}`;
    $('save').textContent = ed.id ? 'Save changes' : 'Add to queue';
    syncControls(); renderPending(); schedule(0);
    if (!src.person && canSegment) autoPerson();
    $('editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function syncControls() {
    for (const k of NUM) if ($(k)) $(k).value = ed.S[k];
    $('ink').value = ed.S.ink; $('cap').value = ed.cap;
    for (const [k, attr] of Object.entries(CHIPS))
      document.querySelectorAll(`[${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === String(ed.S[k]))));
    const show = (sel, on) => document.querySelectorAll(sel).forEach((el) => (el.hidden = !on));
    show('.ink-only', ed.S.mode === 'ink'); show('.person-only', ed.S.person !== 'off');
    show('.hair-only', ed.S.person === 'hair'); show('.regions-only', ed.S.regions); show('.pixel-only', ed.S.fill === 'pixel'); show('.rows-only', ed.S.detail); show('.bwb-only', ed.S.colors === 'bwb');
  }
  for (const k of NUM) if ($(k)) $(k).addEventListener('input', () => { ed.S[k] = Number($(k).value); schedule(); });
  $('ink').addEventListener('input', () => { ed.S.ink = $('ink').value; schedule(); });
  $('cap').addEventListener('input', () => { ed.cap = Math.round(Number($('cap').value)); });
  for (const [k, attr] of Object.entries(CHIPS))
    document.querySelectorAll(`[${attr}]`).forEach((b) => (b.onclick = () => {
      const v = b.getAttribute(attr); ed.S[k] = v === 'true' ? true : v === 'false' ? false : v; syncControls(); schedule();
    }));
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('brushTools').hidden = tab !== 'brush'; $('pinTools').hidden = tab !== 'pins'; schedule(0);
  }));
  document.querySelectorAll('[data-brush]').forEach((b) => (b.onclick = () => {
    brush = b.dataset.brush;
    document.querySelectorAll('[data-brush]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));

  // Find the person (and, when possible, her hair/skin/clothes/accessories).
  async function autoPerson() {
    if (!canSegment) { $('edStatus').textContent = 'Automatic detection runs on the real site. Here, paint with the brushes.'; return; }
    const target = ed; $('autoPerson').disabled = true;
    $('edStatus').textContent = 'Finding the person and her parts (first time downloads the AI models)...';
    try {
      let res = null;
      try { res = await segmentParts(target.img, target.bh); } catch { res = null; }
      if (ed !== target) return;
      if (res) { ed.person = res.person; ed.region = res.region; $('edStatus').textContent = 'Found her hair, skin, clothes and accessories. Check them in the Brush tab.'; }
      else { ed.person = await segmentPerson(target.img); ed.region.fill(0); $('edStatus').textContent = 'Person found (parts are guessed from color). Check the Brush tab.'; }
      ed.personVer++; schedule(0);
    } catch { $('edStatus').textContent = 'Could not run detection. Paint the person with the brush instead.'; }
    finally { $('autoPerson').disabled = false; }
  }
  $('autoPerson').onclick = autoPerson;

  function schedule(ms = 350) { clearTimeout(timer); timer = setTimeout(renderEditor, ms); }
  const edWidth = () => Math.min($('edBox').clientWidth || 480, 620);
  const parts = () => ({
    person: ed.person.some((v) => v) ? ed.person : null,
    region: ed.region.some((v) => v) ? ed.region : null,
    key: `${ed.personVer}`, brushKey: `${ed.brushVer}`,
    brush: () => ({ fine: ed.fine, empty: ed.empty }),
    pins: ed.pins, lock: ed._lock, lockAt: ed.lockAt,
  });
  // The real descriptions on the picture being edited (admin sees the words even before the reveal).
  function editorGroups() {
    if (!ed.id) return [];
    const idx = state.pictures.findIndex((p) => p.id === ed.id);
    return idx < 0 ? [] : groupsFor(idx, state.messages, assign(state.pictures, state.messages));
  }

  async function renderEditor() {
    if (!ed) return;
    const run = ++runId, S = cleanSettings(ed.S);
    $('edBusy').hidden = false; $('edBusy').textContent = 'Preparing...';
    await fontsLoaded();
    let groups = editorGroups();
    if (!groups.length) groups = SAMPLE.map((t) => ({ key: groupKey(t), text: t, show: t, shape: shapeOf(t), names: ['Sample'], ids: [], weight: 1, star: 0 }));
    const art = await buildArt(ed, S, parts(), groups, (f) => run === runId && ($('edBusy').textContent = `Arranging words ${Math.round(f * 100)}%`));
    if (run !== runId) return;
    lastArt = art; $('edBusy').hidden = true;
    if (tab === 'brush') return drawBrush();
    if (tab === 'pixels') return drawPixels(art);
    drawArt($('ed'), art, edWidth());
    if (tab === 'pins') drawPinMarks(art);
    $('edInfo').textContent = S.person !== 'off' && !parts().person
      ? 'No person marked yet, so words fill the whole picture. Use Find the person, or paint her in the Brush tab.'
      : `${art.L.placements.length} accent words${art.R ? ` and ${art.R.runs.length} rows of tiny text` : ''}${art.G ? `, plus ${art.G.placements.length} glaze words` : ''}. Starred descriptions get the biggest spots. The site uses the real descriptions, repeated to fill the space.`;
  }

  // The pixelated color patches the words are matched to.
  function drawPixels(art) {
    const w = edWidth(), h = (w * art.A.H) / art.A.W, ctx = sizeCanvas($('ed'), w, h);
    ctx.imageSmoothingEnabled = false; ctx.drawImage(art.fill, 0, 0, w, h);
    $('edInfo').textContent = art.pixel
      ? `${art.A.pix.pal.length} color patches. Words are placed where all their letters sit on one patch, and take its color.`
      : 'Pick "Match words to pixel colors" under Words to use color patches.';
  }

  function drawBrush() {
    const w = edWidth(), h = (w * ed.bh) / BRUSH_W, ctx = sizeCanvas($('ed'), w, h);
    ctx.drawImage(ed.img, 0, 0, w, h);
    const A = lastArt && lastArt.A;
    ctx.imageSmoothingEnabled = false;
    // the person cutout (always current)
    const pc = document.createElement('canvas'); pc.width = PERSON_W; pc.height = ed.ph;
    const px = pc.getContext('2d'), pimg = px.createImageData(PERSON_W, ed.ph);
    for (let i = 0; i < ed.person.length; i++) if (ed.person[i]) pimg.data.set([255, 255, 255, ed.S.regions ? 70 : 170], i * 4);
    px.putImageData(pimg, 0, 0); ctx.drawImage(pc, 0, 0, w, h);
    // automatic part guess (from the last analysis), faint
    if (ed.S.regions && A && A.personBits) {
      const c = document.createElement('canvas'); c.width = A.W; c.height = A.H;
      const x = c.getContext('2d'), img = x.createImageData(A.W, A.H);
      for (let i = 0; i < A.W * A.H; i++) if (A.person[i] && REGION_TINT[A.region[i]]) img.data.set([...REGION_TINT[A.region[i]], 90], i * 4);
      x.putImageData(img, 0, 0); ctx.drawImage(c, 0, 0, w, h);
    }
    const m = document.createElement('canvas'); m.width = BRUSH_W; m.height = ed.bh;
    const mx = m.getContext('2d'), img = mx.createImageData(BRUSH_W, ed.bh);
    for (let i = 0; i < ed.fine.length; i++) {
      if (ed.fine[i]) img.data.set([47, 85, 212, 150], i * 4);
      else if (ed.empty[i]) img.data.set([200, 40, 40, 150], i * 4);
      else if (ed.S.regions && ed.region[i] && REGION_TINT[ed.region[i]]) img.data.set([...REGION_TINT[ed.region[i]], 170], i * 4);
    }
    mx.putImageData(img, 0, 0); ctx.drawImage(m, 0, 0, w, h);
    $('edInfo').textContent = ed.S.regions
      ? 'Purple = hair, orange = skin, green = clothes, cyan = accessories. Blue = fine detail, red = keep empty. Drag to paint.'
      : 'White = the person. Blue = fine detail (small words). Red = keep empty. Drag to paint.';
  }

  function paint(e) {
    if (tab !== 'brush') return;
    const r = $('ed').getBoundingClientRect(), size = Number($('brushSize').value);
    const stamp = (W, H, rad, fn) => {
      const k = r.width / W, cx = Math.floor((e.clientX - r.left) / k), cy = Math.floor((e.clientY - r.top) / k);
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        const x = cx + dx, y = Math.round(cy + dy);
        if (x >= 0 && y >= 0 && x < W && y < H && dx * dx + dy * dy <= rad * rad) fn(y * W + x);
      }
    };
    if (brush === 'person' || brush === 'scene') {
      stamp(PERSON_W, ed.ph, size * 2.5, (i) => (ed.person[i] = brush === 'person' ? 1 : 0)); ed.personVer++;
    } else if (brush.startsWith('r-')) {
      const v = REGION[brush.slice(2)] ?? 0;
      stamp(BRUSH_W, ed.bh, size, (i) => (ed.region[i] = v)); ed.personVer++;
    } else {
      stamp(BRUSH_W, ed.bh, size, (i) => { ed.fine[i] = brush === 'fine' ? 1 : 0; ed.empty[i] = brush === 'empty' ? 1 : 0; }); ed.brushVer++;
    }
    drawBrush(); schedule(700); // instant feedback; full re-analysis once you pause
  }
  $('ed').addEventListener('pointerdown', (e) => { if (tab !== 'brush') return; painting = true; $('ed').setPointerCapture(e.pointerId); paint(e); });
  $('ed').addEventListener('pointermove', (e) => { if (painting) paint(e); });
  $('ed').addEventListener('pointerup', () => (painting = false));
  $('ed').addEventListener('pointercancel', () => (painting = false));
  $('clearBrush').onclick = () => { ed.fine.fill(0); ed.empty.fill(0); ed.region.fill(0); ed.brushVer++; ed.personVer++; schedule(0); };

  // ---- pins: put a chosen description exactly where you click ----
  let pinDir = 0;
  document.querySelectorAll('[data-pindir]').forEach((b) => (b.onclick = () => {
    pinDir = b.dataset.pindir === 'v' ? -Math.PI / 2 : 0;
    document.querySelectorAll('[data-pindir]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  function renderPinList() {
    const sel = $('pinWhich'); sel.replaceChildren();
    const groups = ed ? editorGroups() : [];
    if (!groups.length) { const o = document.createElement('option'); o.textContent = 'No descriptions on this picture yet'; o.value = ''; sel.append(o); }
    for (const g of groups) { const o = document.createElement('option'); o.value = g.ids[0]; o.textContent = `“${g.text}” (${g.names[0]})`; sel.append(o); }
    const list = $('pinList'); list.replaceChildren();
    (ed ? ed.pins : []).forEach((pin, i) => {
      const m = state.messages.find((x) => x.id === pin.id);
      const row = document.createElement('div'); row.className = 'row';
      const t = document.createElement('span'); t.className = 'small'; t.textContent = `${m ? '“' + m.text + '”' : 'removed description'}, size ${pin.s}, ${pin.ang ? 'vertical' : 'horizontal'}`;
      row.append(t, btn('Remove', () => { ed.pins.splice(i, 1); renderPinList(); schedule(0); }, true));
      list.append(row);
    });
  }
  function drawPinMarks(art) {
    const ctx = $('ed').getContext('2d'), k = edWidth() / art.A.W;
    ctx.save(); ctx.strokeStyle = '#d4a017'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    for (const pin of ed.pins) { ctx.beginPath(); ctx.arc((pin.x + 0.5) * k, (pin.y + 0.5) * k, 10, 0, 7); ctx.stroke(); }
    ctx.restore();
  }
  $('ed').addEventListener('click', (e) => {
    if (tab !== 'pins' || !lastArt || !$('pinWhich').value) return;
    if (ed.lockAt) return ($('edStatus').textContent = 'Unlock the layout to add pins.');
    const r = $('ed').getBoundingClientRect(), k = r.width / lastArt.A.W;
    const x = Math.floor((e.clientX - r.left) / k), y = Math.floor((e.clientY - r.top) / k);
    ed.pins = ed.pins.filter((q) => q.id !== $('pinWhich').value);
    ed.pins.push({ id: $('pinWhich').value, x, y, s: Number($('pinSize').value), ang: pinDir });
    renderPinList(); schedule(0);
  });

  // ---- lock / reshuffle ----
  function updateLockUI() {
    $('lockState').textContent = ed.lockAt ? `Locked on ${new Date(ed.lockAt).toLocaleString()}. New descriptions take spots without moving anything.` : 'Unlocked: words re-arrange as descriptions arrive.';
    $('lockBtn').textContent = ed.lockAt ? 'Unlock layout' : 'Lock layout';
    $('lockBtn').disabled = !ed.id; $('reshuffle').disabled = !!ed.lockAt;
  }
  $('lockBtn').onclick = async () => {
    if (!ed.id) return;
    try {
      if (ed.lockAt) { await backend.admin('unlockImage', { id: ed.id }); ed.lockAt = 0; ed._lock = null; }
      else {
        if (!lastArt || lastArt.locked) return;
        if (!editorGroups().length && !confirm('This picture has no descriptions yet, so the sample words would be locked. Lock anyway?')) return;
        const r = await backend.admin('lockImage', { id: ed.id, snapshot: makeSnapshot(lastArt) });
        ed.lockAt = r.lockAt; ed._lock = await backend.getLock(ed.id, ed.lockAt);
      }
      forget(ed.id); updateLockUI(); await load(); schedule(0);
    } catch (e) { $('edStatus').textContent = e.message; }
  };
  $('reshuffle').onclick = () => { ed.S.seed = Math.floor(Math.random() * 1e9) + 1; schedule(0); $('edStatus').textContent = 'New arrangement. Save to keep it.'; };

  // ---- print / export ----
  const psel = $('printPreset');
  for (const [k, v] of Object.entries(PRINT)) { const o = document.createElement('option'); o.value = k; o.textContent = v.label; psel.append(o); }
  $('exportPng').onclick = () => {
    if (!lastArt) return;
    const caption = $('printCaption').checked ? `${state.config ? state.config.text.title : 'Words for Vem'}  ·  ${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}` : '';
    exportPNG(lastArt, PRINT[psel.value].px, { caption }).toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${(ed.name || 'portrait').replace(/\.\w+$/, '')}-${psel.value}.png`; a.click(); });
  };
  $('closeEd').onclick = () => { ed = null; $('editor').hidden = true; renderPending(); };
  $('save').onclick = async () => {
    if (!Number.isInteger(ed.cap) || ed.cap < LIMITS.capMin || ed.cap > LIMITS.capMax)
      return ($('edStatus').textContent = `Descriptions per picture must be ${LIMITS.capMin} to ${LIMITS.capMax}.`);
    const payload = {
      settings: cleanSettings(ed.S), cap: ed.cap, brushFine: encodeMask(ed.fine), brushEmpty: encodeMask(ed.empty),
      brushRegion: ed.region.some((v) => v) ? encodeBytes(ed.region) : '',
      person: ed.person.some((v) => v) ? encodeMask(ed.person) : '',
      pins: ed.pins,
    };
    $('save').disabled = true; $('edStatus').textContent = 'Saving...';
    try {
      if (ed.id) { await backend.admin('updateImage', { id: ed.id, ...payload }); forget(ed.id); }
      else { await backend.admin('addImage', { name: ed.name, photo: ed.photo, ...payload }); pending.splice(ed.pendingIndex, 1); }
      $('edStatus').textContent = 'Saved.'; ed = null; $('editor').hidden = true; await load();
      if (pending.length) openEditor({ ...pending[0], pendingIndex: 0 });
    } catch (e) { $('edStatus').textContent = e.message; }
    finally { $('save').disabled = false; }
  };

  // ---- queue ----
  function btn(label, fn, danger = false) { const b = document.createElement('button'); b.type = 'button'; b.className = 'ghost' + (danger ? ' danger' : ''); b.textContent = label; b.onclick = fn; return b; }
  const act = async (fn) => { try { await fn(); await load(); } catch (e) { alert(e.message); } };
  function renderQueue() {
    const list = $('images'); list.replaceChildren();
    if (!state.pictures.length) { list.textContent = 'No pictures yet. Add photos above.'; return; }
    const a = assign(state.pictures, state.messages), c = currentIndex(state.pictures, state.messages);
    state.pictures.forEach((pic, i) => {
      const n = a.filter((x) => x === i).length, row = document.createElement('div'); row.className = 'item';
      const th = document.createElement('img'); th.className = 'thumb'; th.alt = ''; backend.getPhoto(pic.id).then((u) => (th.src = u));
      const info = document.createElement('div'); info.className = 'grow';
      const status = n >= pic.cap ? 'full' : i === c ? 'filling now' : i < c ? 'full' : 'waiting';
      info.textContent = `Picture ${i + 1} (${pic.name || 'untitled'}): ${n} of ${pic.cap} descriptions, ${status}${pic.lockAt ? ', layout locked' : ''}${(pic.pins || []).length ? `, ${pic.pins.length} pinned` : ''}.`;
      row.append(th, info,
        btn('Edit look', async () => openEditor({ ...pic, photo: await backend.getPhoto(pic.id) })),
        btn('Move up', () => act(() => backend.admin('moveImage', { id: pic.id, dir: 'up' }))),
        btn('Move down', () => act(() => backend.admin('moveImage', { id: pic.id, dir: 'down' }))),
        btn('Delete', () => confirm('Delete this picture? Its descriptions move to the next pictures.') && act(() => backend.admin('deleteImage', { id: pic.id })), true));
      list.append(row);
    });
  }

  // ---- descriptions ----
  function renderMessages() {
    const list = $('messages'); list.replaceChildren();
    $('msgCount').textContent = `${state.messages.length} total`;
    if (!state.messages.length) { list.textContent = 'No descriptions yet.'; return; }
    const a = assign(state.pictures, state.messages);
    state.messages.map((m, k) => ({ m, p: a[k] })).reverse().forEach(({ m, p }) => {
      const row = document.createElement('div'); row.className = 'item';
      const info = document.createElement('div'); info.className = 'grow';
      const who = document.createElement('strong'); who.textContent = m.name;
      const text = document.createElement('div'); text.textContent = `“${m.text}”`;
      const meta = document.createElement('div'); meta.className = 'small';
      meta.textContent = `${new Date(m.at).toLocaleString()}, ${p >= 0 ? 'Picture ' + (p + 1) : 'waiting for a picture'}`;
      if (m.editedAt) meta.textContent += ' (edited)';
      // sentence-like descriptions are flagged so they're easy to shorten
      if (wordCount(m.text) > LIMITS.longWords) text.append(Object.assign(document.createElement('span'), { className: 'chip-long', textContent: 'Long', title: 'More than a short phrase: consider shortening it' }));
      info.append(who, text);
      if (m.note) info.append(Object.assign(document.createElement('div'), { className: 'note-preview', textContent: m.note }));
      info.append(meta);
      // Stars: chosen people get the big spaces. Click to cycle Normal -> Featured -> Top.
      const star = m.star || 0, labels = ['☆ Normal', '★ Featured', '★★ Top'];
      const sb = btn(labels[star], () => act(() => backend.admin('setStar', { id: m.id, star: (star + 1) % 3 })));
      sb.setAttribute('aria-label', `Priority: ${labels[star].replace(/[☆★]/g, '').trim()}. Click to change.`);
      if (star) sb.classList.add('starred');
      row.append(info, btn('Edit', () => editRow(row, m)), sb, btn('Delete', () => act(() => backend.admin('deleteMessage', { id: m.id })), true));
      list.append(row);
    });
  }
  // Moderation: fix a description or the sender's name in place.
  function editRow(row, m) {
    row.replaceChildren();
    const n = document.createElement('input'); n.value = m.name; n.maxLength = LIMITS.name; n.setAttribute('aria-label', 'Name');
    const t = document.createElement('input'); t.value = m.text; t.maxLength = LIMITS.phrase; t.setAttribute('aria-label', 'Description');
    const nt = document.createElement('textarea'); nt.value = m.note || ''; nt.maxLength = LIMITS.note; nt.rows = 3; nt.placeholder = 'Longer message (optional)'; nt.setAttribute('aria-label', 'Longer message');
    const box = document.createElement('div'); box.className = 'grow'; box.style.display = 'grid'; box.style.gap = '.4rem'; box.append(n, t, nt);
    const msg = document.createElement('span'); msg.className = 'small';
    row.append(box, btn('Save', async () => {
      try { await backend.admin('editMessage', { id: m.id, name: n.value, text: t.value, note: nt.value }); await load(); } catch (e) { msg.textContent = e.message; }
    }), btn('Cancel', () => renderMessages()), msg);
    t.focus();
  }

  // ---- trash ----
  function renderTrash() {
    const list = $('trash'); list.replaceChildren();
    const trash = state.trash || [];
    $('trashCount').textContent = trash.length ? `${trash.length} in trash` : 'empty';
    $('emptyTrash').disabled = !trash.length;
    for (const m of [...trash].reverse()) {
      const row = document.createElement('div'); row.className = 'item';
      const info = document.createElement('div'); info.className = 'grow';
      const who = document.createElement('strong'); who.textContent = m.name;
      const text = document.createElement('div'); text.textContent = `“${m.text}”`;
      info.append(who, text);
      row.append(info, btn('Restore', () => act(() => backend.admin('restoreMessage', { id: m.id }))));
      list.append(row);
    }
  }
  $('emptyTrash').onclick = () => confirm('Permanently delete everything in the trash?') && act(() => backend.admin('emptyTrash'));

  // ---- stats ----
  const STOP = new Set(['the', 'and', 'a', 'of', 'so', 'to', 'in', 'my', 'our', 'is', 'very', 'ever', 'with', 'for', 'at', 'on']);
  function renderStats() {
    const a = assign(state.pictures, state.messages), el = $('stats'); el.replaceChildren();
    const add = (label, value) => { const d = document.createElement('div'); d.className = 'stat'; const b = document.createElement('strong'); b.textContent = value; const s2 = document.createElement('span'); s2.textContent = label; d.append(b, s2); el.append(d); };
    add('descriptions', state.messages.length);
    add('people', new Set(state.messages.map((m) => normalize(m.name))).size);
    add('longer messages', state.messages.filter((m) => m.note).length);
    state.pictures.forEach((p, i) => add(`on Picture ${i + 1}`, `${a.filter((x) => x === i).length} / ${p.cap}`));
    const words = new Map(), descs = new Map();
    for (const m of state.messages) {
      descs.set(normalize(m.text), (descs.get(normalize(m.text)) || 0) + 1);
      for (const w of normalize(m.text).split(' ')) if (w && !STOP.has(w)) words.set(w, (words.get(w) || 0) + 1);
    }
    const top = (map) => [...map].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([w, n]) => `${w} (${n})`).join(', ') || 'none yet';
    $('topWords').textContent = top(words); $('topDescs').textContent = top(descs);
  }

  // ---- export people and descriptions ----
  const rows = () => {
    const a = assign(state.pictures, state.messages);
    return state.messages.map((m, k) => ({ name: m.name, description: m.text, message: m.note || '', picture: a[k] >= 0 ? a[k] + 1 : '', priority: ['Normal', 'Featured', 'Top'][m.star || 0], submitted: new Date(m.at).toISOString() }));
  };
  const download = (name, type, data) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); };
  $('dlCsv').onclick = () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`, r = rows();
    download('vem-descriptions.csv', 'text/csv', '\ufeff' + ['Name,Description,Message,Picture,Priority,Submitted', ...r.map((x) => [x.name, x.description, x.message, x.picture, x.priority, x.submitted].map(q).join(','))].join('\r\n'));
  };
  $('dlJson').onclick = () => download('vem-descriptions.json', 'application/json', JSON.stringify(rows(), null, 2));

  // ---- backup / restore ----
  $('backup').onclick = async () => {
    try { const b = await backend.admin('backup'); download(`vem-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', JSON.stringify(b)); }
    catch (e) { alert(e.message); }
  };
  $('restoreFile').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!confirm('Restore this backup? It replaces ALL current pictures, descriptions and settings.')) return;
    try { await backend.admin('restore', { backup: JSON.parse(await f.text()) }); await load(); alert('Backup restored.'); }
    catch (err) { alert(err.message || 'Could not read that file.'); }
  };
  $('dlCsv').hidden = $('dlJson').hidden = $('backup').hidden = !canDownload;

  $('copyTsv').onclick = async () => {
    const a = assign(state.pictures, state.messages), safe = (s) => String(s).replace(/[\t\r\n]+/g, ' ');
    const lines = ['Name\tDescription\tMessage\tPicture\tPriority\tSubmitted', ...state.messages.map((m, k) => [safe(m.name), safe(m.text), safe(m.note || ''), a[k] >= 0 ? a[k] + 1 : '', ['Normal', 'Featured', 'Top'][m.star || 0], new Date(m.at).toISOString()].join('\t'))];
    try { await navigator.clipboard.writeText(lines.join('\n')); $('copyTsv').textContent = 'Copied'; } catch { $('copyTsv').textContent = 'Clipboard blocked'; }
    setTimeout(() => ($('copyTsv').textContent = 'Copy as TSV for Google Sheets'), 2000);
  };

  window.addEventListener('resize', () => ed && schedule());
  if (!backend.needsKey) load();
  return { load, openEditor };
}
