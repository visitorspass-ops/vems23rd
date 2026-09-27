// POST /api/submit  {name, text, website}   (public, no login)
import crypto from 'node:crypto';
import { redis, K, loadPictures, bump, clientIp } from '../lib/redis.js';
import { LIMITS, wordCount, totalCap, cleanConfig, isOpen, cleanNote } from '../public/wordart.js';

const clean = (s) =>
  String(s ?? '')
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = req.body || {};
  if (body.website) return res.status(201).json({ ok: true }); // honeypot: bots only

  const name = clean(body.name), text = clean(body.text), wc = wordCount(text), note = cleanNote(body.note);
  if (note.length > LIMITS.note)
    return res.status(400).json({ error: `Keep the longer message under ${LIMITS.note} characters.` });
  if (!name || name.length > LIMITS.name)
    return res.status(400).json({ error: `Enter what Vem calls you (up to ${LIMITS.name} characters).` });
  if (wc < 1 || text.length > LIMITS.phrase)
    return res.status(400).json({ error: `Describe Vem in up to ${LIMITS.phrase} characters.` });

  try {
    const rk = K.rl(clientIp(req));
    const count = await redis.incr(rk);
    if (count === 1) await redis.expire(rk, LIMITS.windowSec);
    if (count > LIMITS.perWindow)
      return res.status(429).json({ error: 'Too many submissions from this connection. Try again in a few minutes.' });

    const config = cleanConfig((await redis.get(K.config)) || {});
    if (!isOpen(config)) return res.status(409).json({ error: config.text.closed });
    const pictures = await loadPictures();
    if (!pictures.length) return res.status(409).json({ error: "The first picture hasn't been added yet." });
    const used = await redis.llen(K.msgIds);
    if (used >= totalCap(pictures)) return res.status(409).json({ error: 'Every picture is full. Thank you for stopping by!' });

    const entry = { id: crypto.randomUUID(), name, text, ...(note ? { note } : {}), at: Date.now() };
    await redis.set(K.msg(entry.id), entry);
    await redis.rpush(K.msgIds, entry.id);
    await bump();
    res.status(201).json({ id: entry.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not save your words. Try again.' });
  }
}
