// api/stats.ts
// Returns live percentages for a day: GET /api/stats?date=YYYY-MM-DD -> { date, levels: [p1..p5] }

import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';

const hasREST = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
const hasTCP  = !!process.env.REDIS_URL;

const redisREST = hasREST ? UpstashRedis.fromEnv() : null;
const redisTCP  = !hasREST && hasTCP ? new IORedis(process.env.REDIS_URL!) : null;

async function HGETALL(key: string) {
  if (redisREST) return redisREST.hgetall<Record<string, string | number>>(key);
  if (redisTCP)  return redisTCP.hgetall(key) as Promise<Record<string, string | number>>;
  throw new Error('No Redis credentials found. Provide UPSTASH_REDIS_REST_URL+TOKEN or REDIS_URL.');
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const date = url.searchParams.get('date');
    if (!date) {
      return new Response(JSON.stringify({ error: 'date required' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    const key = `results:${date}`;
    const hash = (await HGETALL(key)) || {};

    const levels = Array.from({ length: 5 }, (_, i) => {
      const total = Number(hash[`l${i}:total`] ?? 0);
      const right = Number(hash[`l${i}:right`] ?? 0);
      return total ? Math.round((right / total) * 100) : 0;
    });

    return new Response(JSON.stringify({ date, levels }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
