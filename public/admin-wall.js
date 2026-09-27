// Admin: wall settings (timing, reveal, page text, hover names, slideshow),
// share links, and your private admin key.
import { cleanConfig, DEFAULT_CONFIG, isRevealed, isOpen } from './wordart.js';

const toLocal = (t) => { if (t == null) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromLocal = (v) => (v ? new Date(v).getTime() : null);
const TEXT_FIELDS = ['title', 'intro', 'nameLabel', 'textLabel', 'textHint', 'noteLabel', 'example', 'thanks', 'closed', 'hidden', 'vemWelcome'];

export function initWallSettings(backend, { onSaved } = {}) {
  const $ = (id) => document.getElementById(id);
  let cfg = cleanConfig(DEFAULT_CONFIG);

  function load(c) {
    cfg = cleanConfig(c || {});
    $('cfgOpensAt').value = toLocal(cfg.opensAt); $('cfgClosesAt').value = toLocal(cfg.closesAt); $('cfgRevealAt').value = toLocal(cfg.revealAt);
    $('cfgSlide').value = cfg.slideSeconds;
    for (const k of TEXT_FIELDS) $('txt-' + k).value = cfg.text[k];
    chips();
  }
  function chips() {
    document.querySelectorAll('[data-cfg-open]').forEach((b) => b.setAttribute('aria-pressed', String(String(cfg.open) === b.dataset.cfgOpen)));
    document.querySelectorAll('[data-cfg-hover]').forEach((b) => b.setAttribute('aria-pressed', String(String(cfg.hoverNames) === b.dataset.cfgHover)));
    const rev = isRevealed(cfg), op = isOpen(cfg);
    $('wallStatus').textContent = `Right now: ${op ? 'open for descriptions' : 'closed'}, and ${rev ? 'the words are visible' : 'the words are hidden (names show in their places)'}.`;
    $('revealNow').textContent = cfg.revealed ? 'Hide the words (reveal mode)' : 'Reveal the words now';
  }
  document.querySelectorAll('[data-cfg-open]').forEach((b) => (b.onclick = () => { cfg.open = b.dataset.cfgOpen === 'true'; chips(); }));
  document.querySelectorAll('[data-cfg-hover]').forEach((b) => (b.onclick = () => { cfg.hoverNames = b.dataset.cfgHover === 'true'; chips(); }));
  $('revealNow').onclick = async () => {
    const turningOn = cfg.revealed; // currently revealed -> hide
    if (!turningOn && !confirm('Reveal every description to everyone now?')) return;
    cfg.revealed = !cfg.revealed; if (cfg.revealed) cfg.revealAt = null;
    await save();
  };
  async function save() {
    cfg.opensAt = fromLocal($('cfgOpensAt').value); cfg.closesAt = fromLocal($('cfgClosesAt').value);
    const ra = fromLocal($('cfgRevealAt').value);
    if (ra !== cfg.revealAt) { cfg.revealAt = ra; if (ra && ra > Date.now()) cfg.revealed = false; }
    cfg.slideSeconds = Number($('cfgSlide').value);
    for (const k of TEXT_FIELDS) cfg.text[k] = $('txt-' + k).value;
    try { await backend.admin('setConfig', { config: cleanConfig(cfg) }); $('wallSaved').textContent = 'Saved.'; onSaved && onSaved(); }
    catch (e) { $('wallSaved').textContent = e.message; }
    setTimeout(() => ($('wallSaved').textContent = ''), 3000);
  }
  $('saveWall').onclick = save;
  $('resetText').onclick = () => { for (const k of TEXT_FIELDS) $('txt-' + k).value = DEFAULT_CONFIG.text[k]; };

  // Share links
  const base = location.origin && location.origin !== 'null' ? location.origin + '/' : '(your site address)/';
  const links = { linkVisitors: base, linkShow: base + '?view=show', linkVem: base + '?view=vem' };
  for (const [id, url] of Object.entries(links)) {
    $(id).textContent = url;
    $(id + 'Copy').onclick = async () => { try { await navigator.clipboard.writeText(url); $(id + 'Copy').textContent = 'Copied'; } catch { $(id + 'Copy').textContent = 'Copy blocked'; } setTimeout(() => ($(id + 'Copy').textContent = 'Copy'), 1500); };
  }

  // Your admin key: only a salted hash is stored, so nobody (not even the host) can read it.
  $('genKey').onclick = () => {
    const a = new Uint8Array(18); crypto.getRandomValues(a);
    $('newKey').value = Array.from(a, (b) => 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 55]).join('');
    $('newKey').type = 'text';
  };
  $('saveKey').onclick = async () => {
    const k = $('newKey').value;
    if (k.length < 16) return ($('keyStatus').textContent = 'Use at least 16 characters.');
    if (!confirm('Save this as your admin key? Write it down first: it cannot be shown again or recovered.')) return;
    try {
      await backend.admin('changeKey', { newKey: k });
      backend.setKey(k); $('newKey').value = ''; $('newKey').type = 'password';
      $('keyStatus').textContent = 'Saved. Only this key opens the admin page now.'; $('ownKeyWarn').hidden = true;
    } catch (e) { $('keyStatus').textContent = e.message; }
  };
  return { load };
}
