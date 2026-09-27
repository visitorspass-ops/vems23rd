// GET /api/state?v=<version>  (public)
// Before the reveal, descriptions are NOT sent: only each one's stand-in shape
// (same length/letter widths, different letters) and a grouping key, so the
// page can show each sender's name in the spot their words will take.
// Long messages are also held back until the reveal.
import { redis, K, loadPictures, loadMessages } from '../lib/redis.js';
import { cleanConfig, isRevealed, isOpen, shapeOf, groupKey } from '../public/wordart.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    const version = Number((await redis.get(K.version)) || 0);
    const config = cleanConfig((await redis.get(K.config)) || {}), now = Date.now();
    const revealed = isRevealed(config, now);
    // time-based changes (opening, closing, reveal) must reach pollers too
    const v = `${version}.${revealed ? 1 : 0}${isOpen(config, now) ? 1 : 0}`;
    if (req.query.v && req.query.v === v) return res.json({ unchanged: true, version: v });
    const [pictures, messages] = await Promise.all([loadPictures(), loadMessages()]);
    res.json({
      version: v, now, revealed, open: isOpen(config, now), config,
      pictures: pictures.map(({ id, name, cap, settings, brushFine, brushEmpty, person, brushRegion, pins, lockAt }) =>
        ({ id, name, cap, settings, brushFine, brushEmpty, person, brushRegion, pins: pins || [], lockAt: lockAt || 0 })),
      messages: messages.map((m) => ({
        id: m.id, name: m.name, at: m.at, star: m.star || 0,
        shape: shapeOf(m.text), gkey: groupKey(m.text),
        ...(revealed ? { text: m.text, ...(m.note ? { note: m.note } : {}) } : { hasNote: !!m.note }),
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the portrait right now.' });
  }
}
