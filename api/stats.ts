// api/stats.ts
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    if (!date) {
      return new Response(JSON.stringify({ error: 'date required' }), {
        status: 400, headers: { 'content-type': 'application/json' }
      });
    }

    const key = `results:${date}`;
    const hash = (await redis.hgetall<Record<string, string | number>>(key)) || {};

    const levels = Array.from({ length: 5 }, (_, i) => {
      const t = Number(hash[`l${i}:total`] ?? 0);
      const r = Number(hash[`l${i}:right`] ?? 0);
      return t ? Math.round((r / t) * 100) : 0;
    });

    return new Response(JSON.stringify({ date, levels }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
