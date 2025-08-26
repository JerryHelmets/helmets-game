// api/stats.ts
import { Redis } from '@upstash/redis';

export const config = { runtime: 'edge' };

// Accept either standard or KV-style env names
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

export default async function handler(req: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    if (!date) {
      return new Response(JSON.stringify({ ok: false, error: 'missing date' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const redis = getRedis();
    const key = `helmets:stats:${date}`;

    // Hash fields we maintain: total0..4, correct0..4
    const data = (await redis.hgetall<Record<string, string>>(key)) || {};

    const levels: number[] = [];
    for (let i = 0; i < 5; i++) {
      const total = Number(data[`total${i}`] || 0);
      const correct = Number(data[`correct${i}`] || 0);
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
      levels.push(pct);
    }

    return new Response(
      JSON.stringify({ ok: true, date, levels, source: 'redis' }),
      {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}
