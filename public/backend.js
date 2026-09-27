// Talks to the Vercel API. The preview swaps this for an in-memory fake.
let key = '';
try { key = sessionStorage.getItem('vemAdminKey') || ''; } catch {}
const photoCache = new Map(), lockCache = new Map();

async function json(r) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Request failed (${r.status}).`);
  return d;
}
const post = (url, body, headers = {}) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

export const backend = {
  needsKey: true,
  canDownload: true,
  hasKey: () => !!key,
  getState: async (v) => json(await fetch('/api/state' + (v ? '?v=' + encodeURIComponent(v) : ''), { cache: 'no-store' })),
  // Photos never change for a given id, so each is fetched once.
  getPhoto(id) {
    if (!photoCache.has(id)) photoCache.set(id, fetch('/api/photo?id=' + encodeURIComponent(id)).then(json).then((d) => d.photo));
    return photoCache.get(id);
  },
  // Locked layouts change only when re-locked (lockAt changes).
  getLock(id, at) {
    const k = id + '@' + at;
    if (!lockCache.has(k)) lockCache.set(k, fetch('/api/lock?id=' + encodeURIComponent(id)).then(json).then((d) => d.lock));
    return lockCache.get(k);
  },
  submit: async (body) => json(await post('/api/submit', body)),
  admin: async (action, payload = {}) => json(await post('/api/admin', { action, ...payload }, { 'x-admin-key': key })),
  adminState: () => backend.admin('adminState'),
  async unlock(k) {
    if (k) key = k;
    const r = await backend.admin('ping');
    try { sessionStorage.setItem('vemAdminKey', key); } catch {}
    return r;
  },
  signOut() { key = ''; try { sessionStorage.removeItem('vemAdminKey'); } catch {} },
  setKey(k) { key = k; try { sessionStorage.setItem('vemAdminKey', key); } catch {} },
};
