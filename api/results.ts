// api/results.ts
// Records one level result: POST { date: "YYYY-MM-DD", index: number (0..4), correct: boolean }

import { Redis as UpstashRedis } from '@upstash/redis';
import IORedis from 'ioredis';

const hasREST = !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;
const hasTCP  = !!process.env.REDIS_URL;

const redisREST = hasREST ? UpstashRedis.fromEnv() : null;
const redisTCP  = !hasREST && hasTCP ? new IORedis(process.env.REDIS_URL!) : null;

async function HINCRBY(key: string, field: string, incr: number) {
  if (redisREST) return redisREST.hincrby(key, field, incr);
  if (redisTCP)  return redisTCP.hincrby(key, field, incr);
  throw new Error('No Redis credentials found. Provide UPSTASH_REDIS_REST_URL+TOKEN or REDIS_URL.');
}
async function EXPIRE(key: string, seconds: number) {
  if (redisREST) return redisREST.expire(key, seconds);
  if (redisTCP)  return redisTCP.expire(key, seconds);
  throw new Error('No Redis credentials found.');
}

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' }
      });
    }

    const { date, index, correct } = (await req.json()) as {
      date?: string; index?: number; correct?: boolean;
    };

    if (!date || typeof index !== 'number') {
      return new Response(JSON.stringify({ error: 'Bad payload' }), {
        status: 400, headers: { 'content-type': 'application/json' }
      });
    }

    const key = `results:${date}`;
    await HINCRBY(key, `l${index}:total`, 1);
    if (correct) await HINCRBY(key, `l${index}:right`, 1);

    // optional TTL (90 days)
    await EXPIRE(key, 60 * 60 * 24 * 90);

    return new Response(JSON.stringify({ ok: true }), {
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
