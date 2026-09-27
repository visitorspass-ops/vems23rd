import { Redis } from '@upstash/redis';

// Works with either env-var naming the Vercel/Upstash integration creates.
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

export const K = {
  order: 'vem:pictureOrder',            // JSON array of picture ids, in fill order
  pic: (id) => `vem:pic:${id}`,         // {id, name, cap, settings, brushFine, brushEmpty, person, at}
  photo: (id) => `vem:photo:${id}`,     // downscaled JPEG data URL (never changes)
  msgIds: 'vem:msgIds',                 // message ids in submission order
  msg: (id) => `vem:msg:${id}`,         // {id, name, text, at}
  version: 'vem:version',               // bumped on every change (cheap polling)
  config: 'vem:config',                 // timing, reveal, page text (see cleanConfig)
  keyHash: 'vem:adminKeyHash',          // {salt, hash} once the admin sets their own key
  trashIds: 'vem:trashIds',             // deleted descriptions (restorable)
  lock: (id) => `vem:lock:${id}`,       // locked layout snapshot for a picture
  rl: (ip) => `vem:rl:${ip}`,
  adminFail: (ip) => `vem:adminfail:${ip}`,
};

async function mgetChunked(keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 500) out.push(...(await redis.mget(...keys.slice(i, i + 500))));
  return out.filter(Boolean);
}
export async function loadPictures() {
  const order = (await redis.get(K.order)) || [];
  return order.length ? mgetChunked(order.map(K.pic)) : [];
}
export async function loadMessages() {
  const ids = await redis.lrange(K.msgIds, 0, -1);
  return ids.length ? mgetChunked(ids.map(K.msg)) : [];
}
export const bump = () => redis.incr(K.version);
export const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

export async function loadTrash() {
  const ids = await redis.lrange(K.trashIds, 0, -1);
  return ids.length ? mgetChunked(ids.map(K.msg)) : [];
}
