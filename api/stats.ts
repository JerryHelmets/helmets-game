import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const date = req.query.date as string;
  if (!date) return res.status(400).json({ error: 'missing date' });

  try {
    const levels = await Promise.all(
      [0,1,2,3,4].map(async (i) => {
        const [attempts, correct] = await Promise.all([
          kv.get<number>(`stats:${date}:${i}:attempts`),
          kv.get<number>(`stats:${date}:${i}:correct`),
        ]);
        const a = attempts || 0, c = correct || 0;
        return a ? Math.round((c / a) * 100) : 0;
      })
    );
    res.status(200).json({ date, levels });
  } catch {
    res.status(500).json({ error: 'server error' });
  }
}
