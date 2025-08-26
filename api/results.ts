// api/results.ts
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv(); // reads UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { 'content-type': 'application/json' }
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
    await redis.hincrby(key, `l${index}:total`, 1);
    if (correct) await redis.hincrby(key, `l${index}:right`, 1);
    await redis.expire(key, 60 * 60 * 24 * 90); // optional TTL: 90 days

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500, headers: { 'content-type': 'application/json' }
    });
  }
}
