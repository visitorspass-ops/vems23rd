// Visitor page: the live word portrait plus the form. No login.
// Views: normal (default), ?view=show (party slideshow), ?view=vem (Vem's gallery).
import { LIMITS, wordCount, assign, currentIndex, groupsFor, totalCap, DEFAULT_CONFIG, personKey, personSummary } from './wordart.js';
import { drawArt, hitGroup, fontsLoaded, exportPNG } from './render.js';
import { artFor } from './art.js';

const fmt = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function initMessenger(backend, { pollMs = 8000, view: startView } = {}) {
  const $ = (id) => document.getElementById(id);
  const art = $('art'), box = $('box'), tip = $('tip');
  let state = { version: 0, pictures: [], messages: [], config: DEFAULT_CONFIG, revealed: true, open: true };
  const view = { idx: 0, picked: false, focus: null, mine: null, cur: null, run: 0, mode: startView || new URLSearchParams(location.search).get('view') || 'main', slideTimer: null };
  const fontsReady = fontsLoaded();

  async function refresh(force = false) {
    try {
      const d = await backend.getState(force ? 0 : state.version);
      if (!d.unchanged) { state = d; update(); }
    } catch { /* keep the last good view; next poll retries */ }
  }
  const cur = () => (state.pictures.length ? currentIndex(state.pictures, state.messages) : -1);

  function update() {
    applyText();
    const c = cur();
    if (!view.picked) view.idx = Math.max(0, c);
    view.idx = Math.min(view.idx, Math.max(0, c));
    if (view.mode === 'vem') return renderVem();
    renderTabs(c); build(); updateForm();
  }

  // Page text comes from the admin's settings.
  function applyText() {
    const t = state.config.text;
    document.title = t.title;
    $('title').textContent = t.title; $('intro').textContent = t.intro;
    $('nameLabel').textContent = t.nameLabel; $('textLabel').textContent = t.textLabel; $('noteLabel').textContent = t.noteLabel;
    $('exampleHint').textContent = `${LIMITS.minWords} to ${LIMITS.maxWords} words, like "${t.example}"`;
    const hidden = !state.revealed;
    $('hiddenNote').hidden = !hidden || view.mode !== 'main';
    $('hiddenNote').textContent = hidden ? t.hidden + (state.config.revealAt ? ` The words appear on ${fmt(state.config.revealAt)}.` : '') : '';
  }

  function renderTabs(c) {
    const tabs = $('tabs'); tabs.replaceChildren();
    if (c < 1 || view.mode === 'show') return;
    for (let i = 0; i <= c; i++) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = `Picture ${i + 1}`;
      b.setAttribute('aria-selected', String(i === view.idx));
      b.onclick = () => { view.idx = i; view.picked = true; view.mine = null; renderTabs(c); build(); };
      tabs.append(b);
    }
  }

  async function artForIdx(i, onProgress) {
    const pic = state.pictures[i];
    if (pic.lockAt && !pic._lock) pic._lock = await backend.getLock(pic.id, pic.lockAt);
    const groups = groupsFor(i, state.messages, assign(state.pictures, state.messages));
    await fontsReady;
    return artFor(pic, await backend.getPhoto(pic.id), groups, onProgress);
  }

  async function build() {
    const has = state.pictures.length > 0;
    $('empty').hidden = has; art.hidden = !has;
    if (!has) { $('meter').textContent = ''; return; }
    const run = ++view.run, pic = state.pictures[view.idx];
    $('busy').hidden = false;
    try {
      const res = await artForIdx(view.idx, (f) => { $('busy').textContent = `Arranging words ${Math.round(f * 100)}%`; });
      if (run !== view.run) return;
      view.cur = res; draw();
      const n = res.placeholder ? 0 : res.groups.reduce((s, g) => s + g.weight, 0);
      $('meter').textContent = view.mode === 'show' ? state.config.text.title : n ? `${n} of ${pic.cap} descriptions on this picture.` : 'No descriptions yet. Be the first!';
    } catch { $('meter').textContent = 'Could not load this picture. Refresh to try again.'; }
    finally { if (run === view.run) $('busy').hidden = true; }
  }

  function width() {
    if (view.mode === 'show' && view.cur) {
      const A = view.cur.A, maxH = window.innerHeight - 70;
      return Math.min(window.innerWidth - 24, (maxH * A.W) / A.H);
    }
    return Math.min(box.clientWidth || 360, 760);
  }
  function draw() {
    if (!view.cur || !box.clientWidth) return;
    drawArt(art, view.cur, width(), { focus: view.focus ?? view.mine, placeholder: view.cur.placeholder });
  }

  // ---- person card: every short description and long message from the people
  // behind a word. Built with textContent only, so nothing anyone typed becomes HTML.
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function fillCard(target, artObj, g, full) {
    target.replaceChildren();
    const grp = artObj.groups[g], anon = !state.config.hoverNames;
    const people = [...new Map((grp.names || []).map((n) => [personKey(n), n])).values()];
    if (grp.hidden) {
      target.append(el('strong', null, anon ? `${people.length} ${people.length === 1 ? 'friend' : 'friends'}` : people.join(', ')));
      const notes = state.messages.filter((m) => people.some((n) => personKey(n) === personKey(m.name)) && m.hasNote).length;
      target.append(el('span', null, (state.config.revealAt ? `Their words appear on ${fmt(state.config.revealAt)}.` : 'Their words appear at the reveal.') + (notes ? ` ${notes === 1 ? 'A longer message is' : 'Longer messages are'} waiting too.` : '')));
      return;
    }
    target.append(el('strong', 'card-word', `“${grp.show}”`));
    const cut = (t) => (full || t.length <= 180 ? t : t.slice(0, 170).trimEnd() + '…');
    let more = false;
    people.slice(0, full ? people.length : 3).forEach((n) => {
      const p = personSummary(state.messages, n), sec = el('div', 'card-person');
      sec.append(el('span', 'card-name', anon ? 'A friend' : p.name));
      const other = p.descriptions.filter((d) => d.trim().toLowerCase() !== grp.show.trim().toLowerCase());
      if (other.length) sec.append(el('span', 'card-descs', 'Also: ' + other.map((d) => `“${d}”`).join(', ')));
      for (const note of p.notes) { sec.append(el('p', 'card-note', cut(note))); if (note.length > 180) more = true; }
      target.append(sec);
    });
    if (!full && people.length > 3) { target.append(el('span', 'card-more', `and ${people.length - 3} more`)); more = true; }
    if (!full && (more || people.some((n) => personSummary(state.messages, n).notes.length))) target.append(el('span', 'card-more', 'Click or tap to read everything'));
  }
  // Click/tap: open the full card (the only way to see it on phones).
  const dialog = $('personCard');
  function openCard(artObj, g) {
    fillCard($('personCardBody'), artObj, g, true);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  }
  $('personCardClose').onclick = () => (dialog.close ? dialog.close() : dialog.removeAttribute('open'));
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  function hover(canvas, container, getArt, getWidth, onFocus) {
    const move = (e) => {
      const a = getArt(); if (!a || a.placeholder) return;
      const r = canvas.getBoundingClientRect();
      const g = hitGroup(a, e.clientX - r.left, e.clientY - r.top, getWidth());
      onFocus(g);
      if (g == null) { tip.hidden = true; return; }
      fillCard(tip, a, g, false);
      if (tip.parentElement !== container) container.append(tip);
      tip.hidden = false;
      const b = container.getBoundingClientRect();
      let x = e.clientX - b.left + 14, y = e.clientY - b.top + 14;
      if (x + tip.offsetWidth > container.clientWidth) x -= tip.offsetWidth + 28;
      if (y + tip.offsetHeight > container.clientHeight) y -= tip.offsetHeight + 28;
      tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerdown', move);
    canvas.addEventListener('click', (e) => {
      const a = getArt(); if (!a || a.placeholder || view.mode === 'show') return;
      const r = canvas.getBoundingClientRect(), g = hitGroup(a, e.clientX - r.left, e.clientY - r.top, getWidth());
      if (g != null) { tip.hidden = true; openCard(a, g); }
    });
    canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { onFocus(null); tip.hidden = true; } });
  }
  hover(art, box, () => view.cur, width, (g) => { if (g !== view.focus) { view.focus = g; draw(); } });

  // ---- form ----
  const nameEl = $('name'), textEl = $('text'), noteEl = $('note'), status = $('status'), send = $('send');
  noteEl.addEventListener('input', () => { $('noteCount').textContent = `${noteEl.value.length} / ${LIMITS.note}`; });
  const setStatus = (t, err = false) => { status.textContent = t; status.classList.toggle('error', err); };
  textEl.addEventListener('input', () => { $('count').textContent = `${wordCount(textEl.value)} / ${LIMITS.maxWords} words`; });
  function updateForm() {
    const c = state.config;
    let reason = '';
    if (!state.pictures.length) reason = 'Descriptions open once the first picture is added.';
    else if (!state.open) reason = c.opensAt && state.now < c.opensAt ? `Descriptions open on ${fmt(c.opensAt)}.` : c.text.closed;
    else if (state.messages.length >= totalCap(state.pictures)) reason = 'Every picture is full. Thank you for stopping by!';
    send.disabled = !!reason;
    $('form').classList.toggle('closed', !!reason && state.pictures.length > 0 && !state.open);
    if (reason) setStatus(reason); else if (status.dataset.auto) setStatus('');
    status.dataset.auto = reason ? '1' : '';
    if (c.closesAt && state.open && !reason) setStatus(`Open until ${fmt(c.closesAt)}.`), (status.dataset.auto = '1');
  }
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameEl.value.trim(), text = textEl.value.trim().replace(/\s+/g, ' '), wc = wordCount(text);
    if (!name) return setStatus(`Please fill in: ${state.config.text.nameLabel}`, true);
    if (wc < LIMITS.minWords || wc > LIMITS.maxWords) return setStatus(`Describe Vem in ${LIMITS.minWords} to ${LIMITS.maxWords} words.`, true);
    if (text.length > LIMITS.phrase) return setStatus(`Keep it under ${LIMITS.phrase} characters.`, true);
    if (noteEl.value.length > LIMITS.note) return setStatus(`Keep the longer message under ${LIMITS.note} characters.`, true);
    send.disabled = true; setStatus('Adding...');
    try {
      const d = await backend.submit({ name, text, note: noteEl.value, website: ($('website') || {}).value || '' });
      await refresh(true);
      const k = state.messages.findIndex((m) => m.id === d.id), a = assign(state.pictures, state.messages)[k];
      if (a >= 0) {
        view.idx = a; view.picked = true;
        renderTabs(cur()); await build();
        const g = view.cur.groups.findIndex((x) => x.ids && x.ids.includes(d.id));
        view.mine = g >= 0 ? g : null; draw();
        setStatus(state.revealed ? `${state.config.text.thanks} Your words are highlighted on Picture ${a + 1}.` : `${state.config.text.thanks} Your name marks where your words will appear on Picture ${a + 1}.`);
        setTimeout(() => { view.mine = null; draw(); }, 6000);
      } else setStatus(state.config.text.thanks);
      textEl.value = ''; textEl.dispatchEvent(new Event('input')); noteEl.value = ''; noteEl.dispatchEvent(new Event('input'));
    } catch (err) { setStatus(err.message, true); }
    finally { updateForm(); }
  });

  // ---- party slideshow: full screen, cycles pictures, refreshes live ----
  function startShow() {
    clearInterval(view.slideTimer);
    view.slideTimer = setInterval(() => {
      const c = cur(); if (c < 1) return;
      view.idx = (view.idx + 1) % (c + 1); view.picked = true; build();
    }, state.config.slideSeconds * 1000);
    box.onclick = () => { const c = cur(); if (c >= 1) { view.idx = (view.idx + 1) % (c + 1); build(); } };
  }

  // ---- Vem's view: a welcome message and every picture ----
  async function renderVem() {
    const g = $('gallery'), t = state.config.text;
    g.replaceChildren();
    const h = document.createElement('p'); h.className = 'lede'; h.textContent = t.vemWelcome; g.append(h);
    if (!state.revealed) {
      const p = document.createElement('p'); p.className = 'empty';
      p.textContent = state.config.revealAt ? `Your surprise opens on ${fmt(state.config.revealAt)}.` : 'Your surprise is almost ready.';
      g.append(p); return;
    }
    const c = cur();
    for (let i = 0; i <= c; i++) {
      const wrap = document.createElement('div'); wrap.className = 'canvas-box'; wrap.style.marginBottom = '1.5rem';
      const cv = document.createElement('canvas'); wrap.append(cv); g.append(wrap);
      const a = await artForIdx(i); let focus = null;
      const w = () => Math.min(wrap.clientWidth || 360, 760);
      const d = () => drawArt(cv, a, w(), { focus });
      d(); hover(cv, wrap, () => a, w, (f) => { if (f !== focus) { focus = f; d(); } });
    }
  }

  // ---- high-res save (real site only) ----
  if ($('savePng')) {
    $('savePng').hidden = !backend.canDownload;
    $('savePng').onclick = () => {
      if (!view.cur) return;
      exportPNG(view.cur).toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `vem-picture-${view.idx + 1}.png`; a.click(); });
    };
  }

  function setView(mode) {
    view.mode = mode; clearInterval(view.slideTimer); box.onclick = null;
    document.body.dataset.view = mode;
    $('gallery').hidden = mode !== 'vem';
    for (const id of ['mainHead', 'form', 'section']) $(id).hidden = mode === 'vem' || (mode === 'show' && id !== 'section');
    if (mode === 'show') startShow();
    update();
  }

  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 150); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, pollMs);
  refresh(true).then(() => setView(view.mode));
  return { refresh, draw, build, setView };
}
