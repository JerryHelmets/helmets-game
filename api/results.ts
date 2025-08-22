import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'content-type': 'application/json' },
      });
    }

    const { date, index, correct } = (await req.json()) as {
      date?: string;
      index?: number;
      correct?: boolean;
    };

    if (!date || typeof index !== 'number') {
      return new Response(JSON.stringify({ error: 'Bad payload' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const key = `results:${date}`;
    // count attempts
    await redis.hincrby(key, `l${index}:total`, 1);
    // count correct
    if (correct) await redis.hincrby(key, `l${index}:right`, 1);

    // optional TTL so old days expire after 90 days:
    await redis.expire(key, 60 * 60 * 24 * 90);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
