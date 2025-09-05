// api/daily.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import fs from 'node:fs/promises';
import path from 'node:path';

/** --------- Constants --------- */
// The date you designated as Game #1 (Pacific Time).
const BASE_START_ISO = '2025-09-03'; // Game #1
// Game number = days since base + 1
const toDayNumber = (iso: string) => {
  const toIdx = (s: string) => {
    const [y, m, d] = s.split('-').map((n) => parseInt(n, 10));
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  };
  return toIdx(iso) - toIdx(BASE_START_ISO) + 1;
};

/** --------- PT helpers --------- */
function getPTISO(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = p.find((x) => x.type === 'year')!.value;
  const m = p.find((x) => x.type === 'month')!.value;
  const dd = p.find((x) => x.type === 'day')!.value;
  return `${y}-${m}-${dd}`;
}

/** --------- CSV loading --------- */
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
  const cols = header.split(',').map((s) => sanitizeCell(s).toLowerCase());
  const idx = (k: string) => cols.indexOf(k);
  const iName = idx('name'),
    iPath = idx('path'),
    iLevel = idx('path_level'),
    iPos = idx('position'),
    iDiff = idx('difficulty');

  const out: PlayerPath[] = [];
  for (const line of lines) {
    const parts = line.split(',');
    const name = sanitizeCell(parts[iName]);
    const pathStr = sanitizeCell(parts[iPath]);
    const lvl = parseInt(sanitizeCell(parts[iLevel]), 10);
    if (!name || !pathStr || !lvl || Number.isNaN(lvl)) continue;
    const position = sanitizeCell(parts[iPos]) || undefined;
    const difficulty = parts[iDiff] ? Number(sanitizeCell(parts[iDiff])) : undefined;
    const path = pathStr.split(/\s*,\s*/).map((s) => sanitizeCell(s));
    out.push({ name, path, path_level: lvl, position, difficulty });
  }
  return out;
}

/** --------- key helpers --------- */
const toPathKey = (arr: string[]) => arr.map((s) => s.trim()).join('>');

/** --------- deterministic picker (same as before) --------- */
function pickDailyKeys(players: PlayerPath[], dateISO: string): string[] {
  const buckets: Record<number, Map<string, PlayerPath>> = {
    1: new Map(), 2: new Map(), 3: new Map(), 4: new Map(), 5: new Map()
  };
  players.forEach((p) => {
    if (p.path_level >= 1 && p.path_level <= 5) {
      const k = toPathKey(p.path);
      if (!buckets[p.path_level].has(k)) buckets[p.path_level].set(k, p);
    }
  });

  const toIdx = (iso: string) => {
    const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  };
  const dayIdx = toIdx(dateISO);

  const shuffle = <T,>(arr: T[], seed: number) => {
    const a = arr.slice();
    let s = seed;
    const rnd = () => {
      const x = Math.sin(s++) * 10000;
      return x - Math.floor(x);
    };
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const keys: string[] = [];
  for (let lvl = 1; lvl <= 5; lvl++) {
    const all = Array.from(buckets[lvl].keys()).sort((a, b) => a.localeCompare(b));
    if (!all.length) continue;
    const perm = shuffle(all, 0xC0FFEE + lvl);
    const idx = dayIdx % perm.length;
    keys.push(perm[idx]);
  }
  return keys;
}

/** --------- Redis --------- */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

/** 
 * GET /api/daily?date=YYYY-MM-DD
 * Returns:
 *  { baseISO, gameNumber, dateISO, keys, source }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const qDate = typeof req.query.date === 'string' ? req.query.date : undefined;
    const dateISO = qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : getPTISO();
    const todayISO = getPTISO();

    const overrideKey = `game:${dateISO}:keys:override`;
    const commitKey   = `game:${dateISO}:keys`;

    // 1) override always wins
    const override = await redis.get<string[] | null>(overrideKey);
    if (override && Array.isArray(override) && override.length === 5) {
      return res.status(200).json({
        baseISO: BASE_START_ISO,
        gameNumber: toDayNumber(dateISO),
        dateISO,
        keys: override,
        source: 'override'
      });
    }

    // 2) committed keys (locked) next
    const committed = await redis.get<string[] | null>(commitKey);
    if (committed && Array.isArray(committed) && committed.length === 5) {
      return res.status(200).json({
        baseISO: BASE_START_ISO,
        gameNumber: toDayNumber(dateISO),
        dateISO,
        keys: committed,
        source: 'commit'
      });
    }

    // 3) nothing stored yet
    if (dateISO < todayISO) {
      // Past date without a lock — do NOT recompute from current CSV.
      return res.status(409).json({
        error: 'uncommitted_past_game',
        message:
          'This past date has no locked keys. Set an override in the Admin page to preserve the original game.',
        baseISO: BASE_START_ISO,
        gameNumber: toDayNumber(dateISO),
        dateISO
      });
    }

    // 4) today (auto-commit on first hit), or future (preview only)
    const players = await loadPlayers();
    const picked = pickDailyKeys(players, dateISO);
    if (picked.length !== 5) {
      return res.status(500).json({ error: 'unable_to_pick_keys' });
    }

    if (dateISO === todayISO) {
      // Auto-lock today immediately so it won’t change later today
      await redis.set(commitKey, picked);
      return res.status(200).json({
        baseISO: BASE_START_ISO,
        gameNumber: toDayNumber(dateISO),
        dateISO,
        keys: picked,
        source: 'commit' // it’s committed now
      });
    }

    // Future date: preview only (do not commit)
    return res.status(200).json({
      baseISO: BASE_START_ISO,
      gameNumber: toDayNumber(dateISO),
      dateISO,
      keys: picked,
      source: 'preview'
    });
  } catch (e: any) {
    console.error('daily error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
