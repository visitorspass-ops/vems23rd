// GET /api/photo?id=<picture id>  (public). Photos never change for an id, so cache hard.
import { redis, K } from '../lib/redis.js';

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return res.status(400).json({ error: 'Bad picture id.' });
  try {
    const photo = await redis.get(K.photo(id));
    if (!photo) return res.status(404).json({ error: 'Picture not found.' });
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.json({ photo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load the photo.' });
  }
}
