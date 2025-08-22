// /api/stats.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

// GET /api/stats?date=YYYY-MM-DD  -> { ok:true, date, levels:[pct0..pct4] }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const date = String(req.query.date || '');
    if (!date) return res.status(400).json({ ok: false, error: 'missing-date' });

    const key = `helmets:stats:${date}`;
    const totals = await kv.hmget<number>(key, ...[0,1,2,3,4].map(i => `level:${i}:total`));
    const rights = await kv.hmget<number>(key, ...[0,1,2,3,4].map(i => `level:${i}:correct`));

    const levels = [0,1,2,3,4].map(i => {
      const t = Number(totals[i] || 0);
      const r = Number(rights[i] || 0);
      return t ? Math.round((r / t) * 100) : 0;
    });

    return res.status(200).json({ ok: true, date, levels });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
}
