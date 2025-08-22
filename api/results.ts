// /api/results.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

// Body: { date: 'YYYY-MM-DD', levelIndex: number(0..4), correct: boolean }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method-not-allowed' });

    const { date, levelIndex, correct } = req.body ?? {};
    if (!date || levelIndex == null) return res.status(400).json({ ok: false, error: 'bad-request' });

    const key = `helmets:stats:${date}`;
    await kv.hincrby(key, `level:${levelIndex}:total`, 1);
    if (correct) await kv.hincrby(key, `level:${levelIndex}:correct`, 1);

    // optional: TTL for daily keys (e.g., keep 60 days)
    await kv.expire(key, 60 * 60 * 24 * 60);

    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
