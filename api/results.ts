// api/results.ts
import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

function getRedis() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.UPSTASH_REDIS_REST_KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Upstash Redis REST URL/TOKEN not set (check Vercel env vars and redeploy)'
    );
  }
  return new Redis({ url, token });
}

type Body = {
  date: string;          // "YYYY-MM-DD" (Pacific)
  levelIndex: number;    // 0..4
  correct: boolean;      // true/false
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const json = (await req.json()) as Partial<Body>;
    const date = String(json.date || '');
    const levelIndex = Number(json.levelIndex);
    const correct = Boolean(json.correct);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return bad('invalid date');
    if (!Number.isInteger(levelIndex) || levelIndex < 0 || levelIndex > 4)
      return bad('invalid levelIndex');

    const redis = getRedis();
    const key = `helmets:stats:${date}`;
    const totalField = `total${levelIndex}`;
    const correctField = `correct${levelIndex}`;

    // Atomically increment totals (and correct if applicable)
    const p = redis.pipeline();
    p.hincrby(key, totalField, 1);
    if (correct) p.hincrby(key, correctField, 1);
    // keep data around ~1 year (refresh on every write)
    p.expire(key, 60 * 60 * 24 * 400);
    await p.exec();

    // Return fresh percentages for all 5 levels
    const all = (await redis.hgetall<Record<string, string>>(key)) || {};
    const levels: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = Number(all[`total${i}`] || 0);
      const c = Number(all[`correct${i}`] || 0);
      levels.push(t > 0 ? Math.round((c / t) * 100) : 0);
    }

    return new Response(
      JSON.stringify({ ok: true, date, levels }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

function bad(msg: string) {
  return new Response(JSON.stringify({ ok: false, error: msg }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}
