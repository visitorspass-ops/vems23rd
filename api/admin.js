// POST /api/admin  (header x-admin-key)
// Only the holder of the admin key can call this. The key starts as the
// ADMIN_KEY environment variable; once you set your own key here, only a salted
// hash of it is stored and the environment key stops working.
import crypto from 'node:crypto';
import { redis, K, bump, clientIp, loadPictures, loadMessages, loadTrash } from '../lib/redis.js';
import { LIMITS, cleanSettings, cleanConfig, wordCount, cleanNote } from '../public/wordart.js';

const ID = /^[0-9a-f-]{36}$/;
const B64 = /^[A-Za-z0-9+/=]*$/;
const bad = (msg) => Object.assign(new Error(msg), { user: true });
const clean = (s) => String(s ?? '').replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

async function keyMatches(given) {
  if (typeof given !== 'string' || !given) return false;
  const stored = await redis.get(K.keyHash);
  if (stored && stored.salt) {
    const h = crypto.scryptSync(given, Buffer.from(stored.salt, 'hex'), 32);
    return same(h, Buffer.from(stored.hash, 'hex'));
  }
  const expected = process.env.ADMIN_KEY;
  if (!expected) return false;
  return same(crypto.createHash('sha256').update(given).digest(), crypto.createHash('sha256').update(expected).digest());
}

function lookFields(p) {
  const cap = Number(p.cap);
  if (!Number.isInteger(cap) || cap < LIMITS.capMin || cap > LIMITS.capMax) throw bad(`Descriptions per picture must be ${LIMITS.capMin} to ${LIMITS.capMax}.`);
  for (const k of ['brushFine', 'brushEmpty', 'person', 'brushRegion']) {
    const v = typeof p[k] === 'string' ? p[k] : '';
    if (v.length > 60000 || !B64.test(v)) throw bad('Brush or cutout data is invalid.');
  }
  const pins = Array.isArray(p.pins) ? p.pins.slice(0, 40).map((q) => ({
    id: String(q.id || ''), x: Math.round(+q.x), y: Math.round(+q.y), s: Math.round(+q.s), ang: +q.ang === 0 ? 0 : -Math.PI / 2,
  })).filter((q) => ID.test(q.id) && q.x >= 0 && q.y >= 0 && q.x < 400 && q.y < 700 && q.s >= 2 && q.s <= 80) : [];
  return { cap, settings: cleanSettings(p.settings), brushFine: p.brushFine || '', brushEmpty: p.brushEmpty || '', person: p.person || '', brushRegion: p.brushRegion || '', pins };
}

// Rebuild the message list in submission order (used after restore/undo).
async function reorder(ids) {
  const msgs = (await Promise.all(ids.map((id) => redis.get(K.msg(id))))).filter(Boolean).sort((a, b) => a.at - b.at);
  await redis.del(K.msgIds);
  if (msgs.length) await redis.rpush(K.msgIds, ...msgs.map((m) => m.id));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const failKey = K.adminFail(clientIp(req));
    if (Number((await redis.get(failKey)) || 0) >= 10) return res.status(429).json({ error: 'Too many wrong keys. Wait 15 minutes.' });
    if (!(await keyMatches(req.headers['x-admin-key']))) {
      const n = await redis.incr(failKey);
      if (n === 1) await redis.expire(failKey, 900);
      return res.status(401).json({ error: 'Admin key is missing or wrong.' });
    }
    await redis.del(failKey);
    const { action, ...p } = req.body || {};
    switch (action) {
      case 'ping': return res.json({ ok: true, ownKey: !!(await redis.get(K.keyHash)) });

      // Full data for the admin page (real descriptions even before the reveal).
      case 'adminState': {
        const [pictures, messages, trash, config] = await Promise.all([loadPictures(), loadMessages(), loadTrash(), redis.get(K.config)]);
        return res.json({
          config: cleanConfig(config || {}), trash,
          pictures: pictures.map(({ photo, ...rest }) => ({ ...rest, pins: rest.pins || [], lockAt: rest.lockAt || 0 })),
          messages,
        });
      }

      case 'changeKey': {
        const next = String(p.newKey || '');
        if (next.length < 16) return res.status(400).json({ error: 'Use at least 16 characters (the Generate button makes a strong one).' });
        const salt = crypto.randomBytes(16);
        await redis.set(K.keyHash, { salt: salt.toString('hex'), hash: crypto.scryptSync(next, salt, 32).toString('hex'), at: Date.now() });
        return res.json({ ok: true });
      }

      case 'setConfig': {
        await redis.set(K.config, cleanConfig(p.config)); await bump();
        return res.json({ ok: true });
      }

      case 'addImage': {
        const photo = String(p.photo || '');
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo) || photo.length > LIMITS.photoMaxBytes * 1.37)
          return res.status(400).json({ error: 'Photo must be a JPEG under about 450 KB (the admin page resizes it for you).' });
        const id = crypto.randomUUID();
        await redis.set(K.photo(id), photo);
        await redis.set(K.pic(id), { id, name: String(p.name || '').slice(0, 80), ...lookFields(p), at: Date.now() });
        const order = (await redis.get(K.order)) || [];
        order.push(id); await redis.set(K.order, order); await bump();
        return res.status(201).json({ id });
      }

      case 'updateImage': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad picture id.' });
        const cur = await redis.get(K.pic(p.id));
        if (!cur) return res.status(404).json({ error: 'Picture not found.' });
        await redis.set(K.pic(p.id), { ...cur, ...lookFields(p) }); await bump();
        return res.json({ ok: true });
      }

      // Lock: store the arrangement (positions and stand-in shapes, no descriptions).
      case 'lockImage': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad picture id.' });
        const snap = p.snapshot;
        if (!snap || !Array.isArray(snap.accent) || !Array.isArray(snap.rows) || JSON.stringify(snap).length > 900000)
          return res.status(400).json({ error: 'Layout snapshot is invalid or too large.' });
        const cur = await redis.get(K.pic(p.id));
        if (!cur) return res.status(404).json({ error: 'Picture not found.' });
        const at = Date.now();
        await redis.set(K.lock(p.id), { ...snap, at });
        await redis.set(K.pic(p.id), { ...cur, lockAt: at }); await bump();
        return res.json({ ok: true, lockAt: at });
      }
      case 'unlockImage': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad picture id.' });
        const cur = await redis.get(K.pic(p.id));
        if (!cur) return res.status(404).json({ error: 'Picture not found.' });
        await redis.del(K.lock(p.id));
        await redis.set(K.pic(p.id), { ...cur, lockAt: 0 }); await bump();
        return res.json({ ok: true });
      }

      case 'moveImage': {
        const order = (await redis.get(K.order)) || [];
        const i = order.indexOf(p.id), j = i + (p.dir === 'up' ? -1 : 1);
        if (i < 0 || j < 0 || j >= order.length) return res.status(400).json({ error: "Can't move that picture." });
        [order[i], order[j]] = [order[j], order[i]];
        await redis.set(K.order, order); await bump();
        return res.json({ ok: true });
      }
      case 'deleteImage': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad picture id.' });
        const order = ((await redis.get(K.order)) || []).filter((x) => x !== p.id);
        await redis.set(K.order, order);
        await redis.del(K.pic(p.id), K.photo(p.id), K.lock(p.id)); await bump();
        return res.json({ ok: true });
      }

      // Moderation: fix a description, the sender's name, and/or their longer message.
      case 'editMessage': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad description id.' });
        const m = await redis.get(K.msg(p.id));
        if (!m) return res.status(404).json({ error: 'Description not found.' });
        const name = clean(p.name), text = clean(p.text), wc = wordCount(text);
        if (!name || name.length > LIMITS.name) return res.status(400).json({ error: `Name must be 1 to ${LIMITS.name} characters.` });
        if (wc < 1 || wc > LIMITS.maxWords || text.length > LIMITS.phrase) return res.status(400).json({ error: `Description must be up to ${LIMITS.maxWords} words and ${LIMITS.phrase} characters.` });
        const note = cleanNote(p.note);
        if (note.length > LIMITS.note) return res.status(400).json({ error: `The longer message must be under ${LIMITS.note} characters.` });
        const next = { ...m, name, text, editedAt: Date.now() };
        if (note) next.note = note; else delete next.note;
        await redis.set(K.msg(p.id), next); await bump();
        return res.json({ ok: true });
      }
      case 'setStar': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad description id.' });
        const star = Number(p.star);
        if (![0, 1, 2].includes(star)) return res.status(400).json({ error: 'Priority must be 0, 1 or 2.' });
        const m = await redis.get(K.msg(p.id));
        if (!m) return res.status(404).json({ error: 'Description not found.' });
        await redis.set(K.msg(p.id), { ...m, star }); await bump();
        return res.json({ ok: true });
      }

      // Trash: deleting moves a description to the trash; it can be restored.
      case 'deleteMessage': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad description id.' });
        await redis.lrem(K.msgIds, 0, p.id); await redis.rpush(K.trashIds, p.id); await bump();
        return res.json({ ok: true });
      }
      case 'restoreMessage': {
        if (!ID.test(p.id || '')) return res.status(400).json({ error: 'Bad description id.' });
        await redis.lrem(K.trashIds, 0, p.id);
        await reorder([...(await redis.lrange(K.msgIds, 0, -1)), p.id]); await bump();
        return res.json({ ok: true });
      }
      case 'emptyTrash': {
        const ids = await redis.lrange(K.trashIds, 0, -1);
        if (ids.length) await redis.del(...ids.map(K.msg));
        await redis.del(K.trashIds); await bump();
        return res.json({ ok: true, removed: ids.length });
      }

      // Backup: everything (photos included) as one file. Restore replaces everything.
      case 'backup': {
        const [pictures, messages, trash, config] = await Promise.all([loadPictures(), loadMessages(), loadTrash(), redis.get(K.config)]);
        const full = await Promise.all(pictures.map(async (pic) => ({ ...pic, photo: await redis.get(K.photo(pic.id)), lock: await redis.get(K.lock(pic.id)) })));
        return res.json({ kind: 'words-for-vem-backup', savedAt: Date.now(), config: cleanConfig(config || {}), pictures: full, messages, trash });
      }
      case 'restore': {
        const b = p.backup;
        if (!b || b.kind !== 'words-for-vem-backup' || !Array.isArray(b.pictures) || !Array.isArray(b.messages)) return res.status(400).json({ error: 'That is not a backup file from this site.' });
        const oldPics = (await redis.get(K.order)) || [], oldMsgs = [...(await redis.lrange(K.msgIds, 0, -1)), ...(await redis.lrange(K.trashIds, 0, -1))];
        const dels = [...oldPics.flatMap((id) => [K.pic(id), K.photo(id), K.lock(id)]), ...oldMsgs.map(K.msg), K.msgIds, K.trashIds];
        for (let i = 0; i < dels.length; i += 200) await redis.del(...dels.slice(i, i + 200));
        for (const pic of b.pictures) {
          if (!ID.test(pic.id || '')) continue;
          const { photo, lock, ...rest } = pic;
          if (photo) await redis.set(K.photo(pic.id), photo);
          if (lock) await redis.set(K.lock(pic.id), lock);
          await redis.set(K.pic(pic.id), rest);
        }
        await redis.set(K.order, b.pictures.map((x) => x.id).filter((id) => ID.test(id)));
        for (const m of b.messages) if (ID.test(m.id || '')) { await redis.set(K.msg(m.id), m); await redis.rpush(K.msgIds, m.id); }
        for (const m of b.trash || []) if (ID.test(m.id || '')) { await redis.set(K.msg(m.id), m); await redis.rpush(K.trashIds, m.id); }
        await redis.set(K.config, cleanConfig(b.config || {})); await bump();
        return res.json({ ok: true });
      }

      default: return res.status(400).json({ error: 'Unknown action.' });
    }
  } catch (e) {
    if (e.user) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Server error. Check the function logs in Vercel.' });
  }
}
