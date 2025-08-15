import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { date, level, correct, uid } = req.body || {};
    if (!date || typeof level !== 'number' || level < 0 || level > 4 || !uid) {
      return res.status(400).json({ error: 'bad request' });
    }

    // Simple per-IP rate limit: 60/min
    const ip = (req.headers['x-forwarded-for'] as string || '').split(',')[0] || req.socket.remoteAddress || 'ip:unknown';
    const bucket = `rl:${ip}:${Math.floor(Date.now() / 60000)}`;
    const hits = await kv.incr(bucket);
    if (hits === 1) await kv.expire(bucket, 60);
    if (hits > 60) return res.status(429).json({ error: 'rate_limited' });

    // Dedup: count only first finalize for this user/date/level
    const dedupKey = `dedup:${date}:${level}:${uid}`;
    const counted = await kv.setnx(dedupKey, '1');
    await kv.expire(dedupKey, 60 * 60 * 24 * 45);

    if (counted) {
      await kv.incr(`stats:${date}:${level}:attempts`);
      if (correct) await kv.incr(`stats:${date}:${level}:correct`);
    }
    res.status(200).json({ ok: true, counted });
  } catch {
    res.status(500).json({ error: 'server error' });
  }
}
