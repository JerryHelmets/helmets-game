import { NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'edge';

const redis = Redis.fromEnv();

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 });

    const key = `results:${date}`;
    const hash = await redis.hgetall<Record<string, number>>(key);

    const levels = Array.from({ length: 5 }, (_, i) => {
      const t = Number(hash?.[`l${i}:total`] ?? 0);
      const r = Number(hash?.[`l${i}:right`] ?? 0);
      return t ? Math.round((r / t) * 100) : 0;
    });

    return NextResponse.json({ date, levels });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fail' }, { status: 500 });
  }
}
