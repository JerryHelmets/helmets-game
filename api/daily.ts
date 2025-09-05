// api/daily.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import fs from 'node:fs/promises';
import path from 'node:path';

/** --------- PT date helpers --------- */
function getPTISO(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const y = p.find(x=>x.type==='year')!.value;
  const m = p.find(x=>x.type==='month')!.value;
  const dd = p.find(x=>x.type==='day')!.value;
  return `${y}-${m}-${dd}`;
}
function toDayIndex(iso: string) {
  const [y,m,d] = iso.split('-').map(n=>parseInt(n,10));
  return Math.floor(Date.UTC(y,(m-1),d) / 86400000);
}
function shuffle<T>(arr: T[], seed: number) {
  const a = arr.slice();
  let s = seed;
  const rnd = () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); };
  for (let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

type PlayerPath = { name: string; path: string[]; path_level: number; position?: string; difficulty?: number; };

function sanitizeCell(s?: string) {
  if (!s) return '';
  return s.trim().replace(/^"+|"+$/g, '');
}

async function loadPlayers(): Promise<PlayerPath[]> {
  const csvPath = path.join(process.cwd(), 'public', 'data', 'players.csv');
  const text = await fs.readFile(csvPath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines.shift()!;
  const cols = header.split(',').map(s => sanitizeCell(s).toLowerCase());
  const idx = (k:string)=> cols.indexOf(k);
  const iName = idx('name'), iPath = idx('path'), iLevel = idx('path_level');
  const iPos = idx('position'), iDiff = idx('difficulty');

  const out: PlayerPath[] = [];
  for (const line of lines) {
    const parts = line.split(',');
    const name = sanitizeCell(parts[iName]);
    const pathStr = sanitizeCell(parts[iPath]);
    const lvl = parseInt(sanitizeCell(parts[iLevel]), 10);
    if (!name || !pathStr || !lvl || Number.isNaN(lvl)) continue;
    const position = sanitizeCell(parts[iPos]) || undefined;
    const difficulty = parts[iDiff] ? Number(sanitizeCell(parts[iDiff])) : undefined;
    const path = pathStr.split(/\s*,\s*/).map(s => sanitizeCell(s));
    out.push({ name, path, path_level: lvl, position, difficulty });
  }
  return out;
}

function toPathKey(pathArr: string[]) {
  return pathArr.map(s => s.trim()).join('>');
}

function pickForDate(players: PlayerPath[], dateISO: string) {
  const buckets: Record<number, Map<string, PlayerPath>> = {1:new Map(),2:new Map(),3:new Map(),4:new Map(),5:new Map()};
  players.forEach(p => {
    if (p.path_level>=1 && p.path_level<=5) {
      const k = toPathKey(p.path);
      if (!buckets[p.path_level].has(k)) buckets[p.path_level].set(k, p);
    }
  });
  const dayIdx = toDayIndex(dateISO);
  const keys: string[] = [];
  for (let lvl=1; lvl<=5; lvl++) {
    const m = buckets[lvl];
    const all = Array.from(m.keys()).sort((a,b)=> a.localeCompare(b));
    if (!all.length) continue;
    const perm = shuffle(all, 0xC0FFEE + lvl);
    const idx = dayIdx % perm.length;
    keys.push(perm[idx]);
  }
  return keys;
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

/**
 * GET /api/daily?date=YYYY-MM-DD
 * Returns { baseISO, gameNumber, keys, source }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const qDate = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : getPTISO();

    // 1) ensure baseline
    const todayISO = getPTISO();
    let baseISO = await redis.get<string>('game:baseISO');
    if (!baseISO) {
      const ok = await redis.set('game:baseISO', todayISO, { nx: true });
      baseISO = (ok === 'OK') ? todayISO : (await redis.get<string>('game:baseISO'))!;
    }

    const overrideKey = `game:${qDate}:keys:override`;
    const lockKey = `game:${qDate}:keys`;

    // 2) override wins
    let keys = await redis.get<string[]>(overrideKey);
    let source: 'override' | 'locked' | 'picked' = 'override';

    if (!Array.isArray(keys) || !keys.length) {
      // 3) otherwise locked
      keys = await redis.get<string[]>(lockKey);
      source = 'locked';
    }
    if (!Array.isArray(keys) || !keys.length) {
      // 4) otherwise pick+lock (first time)
      const players = await loadPlayers();
      const picked = pickForDate(players, qDate);
      const ok = await redis.set(lockKey, picked, { nx: true });
      keys = (ok === 'OK') ? picked : (await redis.get<string[]>(lockKey))!;
      source = 'picked';
    }

    const gameNumber = qDate < baseISO ? null : (toDayIndex(qDate) - toDayIndex(baseISO) + 1);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ baseISO, gameNumber, dateISO: qDate, keys, source });
  } catch (e:any) {
    console.error('daily API error', e);
    res.status(200).json({ baseISO: null, gameNumber: null, keys: null });
  }
}
