import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'edge';

const redis = Redis.fromEnv();

export async function POST(req: Request) {
  try {
    const { date, index, correct } = await req.json() as {
      date: string; index: number; correct: boolean;
    };
    if (!date || index == null) {
      return NextResponse.json({ error: 'bad payload' }, { status: 400 });
    }

    const key = `results:${date}`;            // one hash per game day
    await redis.hincrby(key, `l${index}:total`, 1);
    if (correct) await redis.hincrby(key, `l${index}:right`, 1);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fail' }, { status: 500 });
  }
}
