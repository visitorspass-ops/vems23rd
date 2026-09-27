// GET /api/lock?id=<picture id>  (public). A locked layout snapshot: positions,
// sizes and stand-in shapes only (no descriptions), so it is safe before the reveal.
import { redis, K } from '../lib/redis.js';

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'Bad picture id.' });
  try {
    const lock = await redis.get(K.lock(id));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ lock: lock || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the layout.' });
  }
}
