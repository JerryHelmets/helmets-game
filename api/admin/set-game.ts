// api/admin/set-game.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import fs from 'node:fs/promises';
import path from 'node:path';

/** ---------- Auth ---------- */
function requireAdmin(req: VercelRequest) {
  const hdr = (req.headers['authorization'] || req.headers['Authorization']) as string | undefined;
  const got = typeof hdr === 'string' && hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  const need = process.env.ADMIN_TOKEN;
  return !!need && got === need;
}

/** ---------- PT date helpers ---------- */
function getPTISO(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(d);
  const y = p.find(x=>x.type==='year')!.value;
  const m = p.find(x=>x.type==='month')!.value;
  const dd = p.find(x=>x.type==='day')!.value;
  return `${y}-${m}-${dd}`;
}

/** ---------- player loading (server) ---------- */
type PlayerPath = { name: string; path: string[]; path_level: number; position?: string; difficulty?: number; };

function sanitizeCell(s?: string) {
  if (!s) return '';
  return s.trim().replace(/^"+|"+$/g, ''); // strip stray quotes
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

/** ---------- utils ---------- */
function toPathKey(pathArr: string[]) {
  return pathArr.map(s => s.trim()).join('>');
}

function findKeyByPlayerName(players: PlayerPath[], name: string): string | null {
  const p = players.find(pp => pp.name.toLowerCase() === name.toLowerCase());
  return p ? toPathKey(p.path) : null;
}

/** ---------- Redis ---------- */
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!
});

/**
 * POST /api/admin/set-game
 * Headers: Authorization: Bearer <ADMIN_TOKEN>
 * Body JSON:
 *   { date?: "YYYY-MM-DD", dateISO?: "YYYY-MM-DD", fromCsv?: boolean, keys?: string[], names?: string[] }
 * - If fromCsv, recompute that date's 5 keys from current players.csv and store as override
 * - Else if keys supplied, use those (must be 5 strings)
 * - Else if names supplied, resolve to keys (must resolve to 5)
 * Stores at Redis key: game:<dateISO>:keys:override
 * Returns { dateISO, keys }
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  if (!requireAdmin(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const body = (typeof req.body === 'string') ? JSON.parse(req.body) : (req.body || {});
    // ✅ Accept either "date" or "dateISO". If neither is provided/valid, default to today's PT date.
    const bodyDate =
      (typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) && body.date) ||
      (typeof body?.dateISO === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.dateISO) && body.dateISO) ||
      null;

    const dateISO: string = bodyDate || getPTISO();

    let outKeys: string[] | null = null;

    if (body.fromCsv) {
      // recompute for date using your deterministic pick function
      const players = await loadPlayers();

      // deterministic picker (same as daily.ts)
      const buckets: Record<number, Map<string, PlayerPath>> = {1:new Map(),2:new Map(),3:new Map(),4:new Map(),5:new Map()};
      players.forEach(p => {
        if (p.path_level>=1 && p.path_level<=5) {
          const k = toPathKey(p.path);
          if (!buckets[p.path_level].has(k)) buckets[p.path_level].set(k, p);
        }
      });
      const toDayIndex = (iso: string) => {
        const [y,m,d] = iso.split('-').map(n=>parseInt(n,10));
        return Math.floor(Date.UTC(y,(m-1),d)/86400000);
      };
      const dayIdx = toDayIndex(dateISO);
      const shuffle = <T,>(arr:T[], seed:number) => {
        const a = arr.slice();
        let s=seed; const rnd=()=>{ const x = Math.sin(s++)*10000; return x - Math.floor(x); };
        for(let i=a.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
        return a;
      };

      const keys: string[] = [];
      for (let lvl=1; lvl<=5; lvl++){
        const m = buckets[lvl];
        const all = Array.from(m.keys()).sort((a,b)=> a.localeCompare(b));
        if (!all.length) continue;
        const perm = shuffle(all, 0xC0FFEE + lvl);
        const idx = dayIdx % perm.length;
        keys.push(perm[idx]);
      }
      if (keys.length !== 5) return res.status(400).json({ error: 'Could not compute 5 paths for that date' });
      outKeys = keys;
    } else if (Array.isArray(body.keys)) {
      if (body.keys.length !== 5) return res.status(400).json({ error: 'keys must be an array of 5 path strings' });
      outKeys = body.keys.map((k:string)=> String(k).trim());
    } else if (Array.isArray(body.names)) {
      if (body.names.length !== 5) return res.status(400).json({ error: 'names must be an array of 5 player names' });
      const players = await loadPlayers();
      const resolved = body.names.map((nm:string)=> findKeyByPlayerName(players, nm));
      if (resolved.some(k => !k)) {
        return res.status(400).json({ error: 'One or more names could not be resolved to a path key', resolved });
        }
      outKeys = resolved as string[];
    } else {
      return res.status(400).json({ error: 'Provide one of: {fromCsv:true} OR {keys:[5]} OR {names:[5]}' });
    }

    // Write override (separate key so original lock remains for audit)
    const overrideKey = `game:${dateISO}:keys:override`;
    await redis.set(overrideKey, outKeys);

    return res.status(200).json({ dateISO, keys: outKeys, source: 'override' });
  } catch (e:any) {
    console.error('admin set-game error', e);
    return res.status(500).json({ error: 'internal_error' });
  }
}
