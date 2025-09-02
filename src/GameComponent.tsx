import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import Papa from 'papaparse';
import './GameComponent.css';

interface PlayerPath { name: string; path: string[]; path_level: number; position?: string; difficulty?: number; }
interface RawPlayerRow {
  name: string; college: string; position: string; teams: string; difficulty: string; path: string; path_level: string;
}
interface Guess { guess: string; correct: boolean; }
type StoredGuesses = { date: string; guesses: (Guess | null)[]; score: number; awardedPoints: number[]; };

type PathSnapshot = { path: string[]; path_level: number };

const LS_GUESSES = 'helmets-guesses';
const LS_HISTORY = 'helmets-history';
const LS_STARTED = 'helmets-started';
const LS_BASE_PREFIX = 'helmets-basepoints-';
const LS_START_PREFIX = 'helmets-levelstart-';
const LS_SNAPSHOTS = 'helmets-snapshots';
const LS_GAME_START = 'helmets-number-start';

const REVEAL_HOLD_MS = 2000;
const FINAL_REVEAL_HOLD_MS = 500;
const MAX_BASE_POINTS = 60;        // you already moved to 60s/60pts
const TICK_MS = 1000;
const COUNTDOWN_START_DELAY_MS = 500;

/* ---------- PACIFIC TIME helpers ---------- */
function getPTDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return { y, m, d };
}
function toPTISO(date: Date) { const { y, m, d } = getPTDateParts(date); return `${y}-${m}-${d}`; }
function todayPTISO() { return toPTISO(new Date()); }
function isoToMDYYYY(iso: string) { const [y,m,d]=iso.split('-'); return `${parseInt(m,10)}/${parseInt(d,10)}/${y}`; }
function isoToMDYY(iso: string) { const [y,m,d]=iso.split('-'); return `${parseInt(m,10)}/${parseInt(d,10)}/${y.slice(-2)}`; }
function getLastNDatesPT(n: number) {
  const base = new Date(); const out: string[] = [];
  for (let i = 0; i < n; i++) { const d = new Date(base); d.setDate(base.getDate() - i); out.push(toPTISO(d)); }
  return out;
}

/* ---------- daily selection ---------- */
function toDayIndex(iso: string) {
  const [y,m,d] = iso.split('-').map(x=>parseInt(x,10));
  const t = Date.UTC(y, (m-1), d);
  return Math.floor(t / 86400000);
}

function pickDailyPaths(players: PlayerPath[], dateISO: string) {
  const dayIdx = toDayIndex(dateISO);
  const buckets: Record<number, Map<string, PlayerPath>> = {1:new Map(),2:new Map(),3:new Map(),4:new Map(),5:new Map()};
  players.forEach(p => {
    if (p.path_level>=1 && p.path_level<=5) {
      const k = p.path.join('>');
      if (!buckets[p.path_level].has(k)) buckets[p.path_level].set(k,p);
    }
  });
  const seedRand = (s: number) => () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); };
  const shuffle = <T,>(arr: T[], seed: number) => {
    const a = arr.slice(); const rnd = seedRand(seed);
    for (let i=a.length-1;i>0;i--){ const j = Math.floor(rnd()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  };

  const sel: PlayerPath[] = [];
  for (let lvl=1; lvl<=5; lvl++) {
    const m = buckets[lvl];
    const keys = Array.from(m.keys()).sort((a,b)=> a.localeCompare(b));
    if (!keys.length) continue;
    const perm = shuffle(keys, 0xC0FFEE + lvl);
    const idx = dayIdx % perm.length;
    sel.push(m.get(perm[idx])!);
  }
  return sel;
}

function buildAnswerLists(players: PlayerPath[], targets: PathSnapshot[]) {
  return targets.map(t =>
    players.filter(p => p.path.join('>')===t.path.join('>')).map(p=>p.name).sort()
  );
}

const isComplete = (guesses: (Guess | null)[], total: number) =>
  guesses.length===total && guesses.every(Boolean);

/* ---------- numbering helpers ---------- */
function getOrInitStartDate(today: string): {start: string, newlySet: boolean} {
  const existing = localStorage.getItem(LS_GAME_START);
  if (existing) return { start: existing, newlySet: false };
  localStorage.setItem(LS_GAME_START, today);
  return { start: today, newlySet: true };
}
const cmpISO = (a: string, b: string) => a.localeCompare(b);

/* ---------- snapshots ---------- */
function readSnapshots(): Record<string, PathSnapshot[]> {
  try { return JSON.parse(localStorage.getItem(LS_SNAPSHOTS) || '{}'); } catch { return {}; }
}
function writeSnapshots(m: Record<string, PathSnapshot[]>) {
  localStorage.setItem(LS_SNAPSHOTS, JSON.stringify(m));
}
function makeSnapshotFromTargets(targets: PlayerPath[]): PathSnapshot[] {
  return targets.map(t => ({ path: t.path, path_level: t.path_level }));
}
function reconstructTargets(players: PlayerPath[], snaps: PathSnapshot[]): PathSnapshot[] {
  // We only need path + level for gameplay/answers. Return the same shape.
  return snaps.map(s => ({ path: s.path.slice(), path_level: s.path_level }));
}

const GameComponent: React.FC = () => {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const dateParam = params.get('date');
  const todayPT = todayPTISO();

  // numbering anchor (today = Game #1)
  const [{start: gameStartISO, newlySet}, setStartInfo] = useState<{start:string,newlySet:boolean}>({start: todayPT, newlySet: false});
  useEffect(() => { setStartInfo(getOrInitStartDate(todayPT)); }, [todayPT]);

  // purge old local history/snapshots if numbering was just created now
  useEffect(() => {
    if (!newlySet) return;
    try {
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      Object.keys(history).forEach((k) => { if (cmpISO(k, gameStartISO) < 0) delete history[k]; });
      localStorage.setItem(LS_HISTORY, JSON.stringify(history));

      const snaps = readSnapshots();
      Object.keys(snaps).forEach(k => { if (cmpISO(k, gameStartISO) < 0) delete snaps[k]; });
      writeSnapshots(snaps);
    } catch {/* ignore */}
  }, [newlySet, gameStartISO]);

  const gameDate = dateParam || todayPT;
  const gameDateHeader = isoToMDYYYY(gameDate);
  const gameDateMMDDYY = isoToMDYY(gameDate);

  const gameNumber = cmpISO(gameDate, gameStartISO) >= 0
    ? (toDayIndex(gameDate) - toDayIndex(gameStartISO) + 1)
    : null;

  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess | null)[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const prevScoreRef = useRef(0);
  const [finalDisplayScore, setFinalDisplayScore] = useState(0);

  const [showPopup, setShowPopup] = useState(false);        // you’ve been phasing this out; still kept for compatibility
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [confettiFired, setConfettiFired] = useState(false);
  const [started, setStarted] = useState<boolean>(false);
  const [activeLevel, setActiveLevel] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [rulesOpenedManually, setRulesOpenedManually] = useState(false);

  const [freezeActiveAfterAnswer, setFreezeActiveAfterAnswer] = useState<number | null>(null);

  const [basePointsLeft, setBasePointsLeft] = useState<number[]>([]);
  const [awardedPoints, setAwardedPoints] = useState<number[]>([]);
  const [communityPct, setCommunityPct] = useState<number[]>([]);

  const [hintShown, setHintShown] = useState<boolean[]>([]);
  const [hintPositions, setHintPositions] = useState<(string | null)[]>([]);

  const [levelStartAt, setLevelStartAt] = useState<(number | null)[]>([]);
  const levelStartAtRef = useRef<(number | null)[]>([]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const levelTimerRef = useRef<number | null>(null);
  const levelDelayRef = useRef<number | null>(null);

  const postedLevelsRef = useRef<Set<number>>(new Set());

  /* viewport app height */
  useEffect(() => {
    const setH = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    setH(); const onOri = () => setTimeout(setH, 250);
    window.addEventListener('orientationchange', onOri);
    return () => window.removeEventListener('orientationchange', onOri);
  }, []);

  /* load players */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/data/players.csv');
        const text = await res.text();
        const parsed = Papa.parse(text, { header: true });
        const rows = parsed.data as RawPlayerRow[];
        const arr: PlayerPath[] = [];
        rows.forEach(r => {
          const name = r.name?.trim(), pathStr = r.path?.trim(), lvl = r.path_level?.trim();
          if (!name || !pathStr || !lvl) return;
          const level = parseInt(lvl, 10); if (Number.isNaN(level)) return;
          const position = r.position?.trim() || undefined;
          const difficulty = r.difficulty ? Number(r.difficulty) : undefined;
          arr.push({ name, path: pathStr.split(',').map(s=>s.trim()), path_level: level, position, difficulty });
        });
        if (!cancelled) setPlayers(arr);
      } catch (e) { console.error('❌ CSV load', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Select today's targets, but snapshot them once so they never change for this user
  function selectTargetsForDate(playersList: PlayerPath[], dateISO: string): PathSnapshot[] {
    const snaps = readSnapshots();
    if (snaps[dateISO]) {
      return reconstructTargets(playersList, snaps[dateISO]);
    }
    // Only number/show games from gameStartISO and forward
    if (cmpISO(dateISO, gameStartISO) < 0) return []; // unnumbered – effectively disabled
    const chosen = pickDailyPaths(playersList, dateISO);
    const snap = makeSnapshotFromTargets(chosen);
    snaps[dateISO] = snap;
    writeSnapshots(snaps);
    return reconstructTargets(playersList, snap);
  }

  const dailyTargets: PathSnapshot[] = useMemo(
    () => (players.length ? selectTargetsForDate(players, gameDate) : []),
    [players, gameDate, gameStartISO]
  );
  const answerLists = useMemo(() => buildAnswerLists(players, dailyTargets), [players, dailyTargets]);

  /* init for day */
  useEffect(() => {
    if (!dailyTargets.length) {
      // if this date is before numbering start, keep header/rules visible
      setStarted(false);
      return;
    }
    postedLevelsRef.current = new Set();

    let g: (Guess | null)[] = Array(dailyTargets.length).fill(null);
    let s = 0;
    let ap: number[] = Array(dailyTargets.length).fill(0);

    const startedFlag = (() => {
      const m = JSON.parse(localStorage.getItem(LS_STARTED) || '{}');
      return !!m[gameDate];
    })();

    // restore progress if same date and shape matches
    const raw = localStorage.getItem(LS_GUESSES);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StoredGuesses>;
        if (parsed.date === gameDate && Array.isArray(parsed.guesses) && parsed.guesses.length === dailyTargets.length) {
          g = parsed.guesses as (Guess | null)[];
          s = parsed.score ?? 0;
          ap = Array.isArray(parsed.awardedPoints) ? parsed.awardedPoints : ap;
        }
      } catch {}
    }

    setGuesses(g); setScore(s); setAwardedPoints(ap);
    setStarted(startedFlag || g.some(Boolean));

    const firstNull = g.findIndex(x => !x); setActiveLevel(firstNull === -1 ? dailyTargets.length - 1 : firstNull);

    const complete = isComplete(g, dailyTargets.length);
    setGameOver(complete); setShowPopup(false);

    // base points + timers
    let base = Array(dailyTargets.length).fill(MAX_BASE_POINTS);
    const savedBase = localStorage.getItem(LS_BASE_PREFIX + gameDate);
    if (savedBase) {
      try {
        const parsed = JSON.parse(savedBase);
        if (Array.isArray(parsed)) base = base.map((v,i)=> (typeof parsed[i]==='number' ? Math.max(0, Math.min(MAX_BASE_POINTS, parsed[i])) : v));
      } catch {}
    }
    setBasePointsLeft(base);

    let starts: (number | null)[] = Array(dailyTargets.length).fill(null);
    const savedStarts = localStorage.getItem(LS_START_PREFIX + gameDate);
    if (savedStarts) {
      try {
        const parsed = JSON.parse(savedStarts);
        if (Array.isArray(parsed)) {
          starts = starts.map((v,i)=> (typeof parsed[i]==='number' ? parsed[i] as number : null));
        }
      } catch {}
    }
    setLevelStartAt(starts);
    levelStartAtRef.current = starts.slice();

    setRevealedAnswers(Array(dailyTargets.length).fill(false));
    setFilteredSuggestions(Array(dailyTargets.length).fill([]));
    setHintShown(Array(dailyTargets.length).fill(false));
    setHintPositions(Array(dailyTargets.length).fill(null));
    setConfettiFired(false);
    setDisplayScore(s); prevScoreRef.current = s;
  }, [dailyTargets, gameDate]);

  /* persist state for the day */
  useEffect(() => {
    if (!dailyTargets.length) return;
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    // keep prior meta if present
    const prev = history[gameDate] || {};
    history[gameDate] = { ...prev, guesses, score, awardedPoints, gameDate };
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    if (!dateParam) {
      const payload: StoredGuesses = { date: gameDate, guesses, score, awardedPoints };
      localStorage.setItem(LS_GUESSES, JSON.stringify(payload));
    }
  }, [guesses, score, awardedPoints, gameDate, dailyTargets.length, dateParam]);

  useEffect(() => {
    if (!dailyTargets.length) return;
    localStorage.setItem(LS_BASE_PREFIX + gameDate, JSON.stringify(basePointsLeft));
  }, [basePointsLeft, gameDate, dailyTargets.length]);

  useEffect(() => {
    if (!dailyTargets.length) return;
    localStorage.setItem(LS_START_PREFIX + gameDate, JSON.stringify(levelStartAt));
  }, [levelStartAt, gameDate, dailyTargets.length]);

  useEffect(() => { levelStartAtRef.current = levelStartAt.slice(); }, [levelStartAt]);

  /* score flash + count-up (header) */
  useEffect(() => {
    const el = document.querySelector('.score-number'); if (!el) return;
    el.classList.add('score-flash'); const t = window.setTimeout(() => el.classList.remove('score-flash'), 600);
    return () => window.clearTimeout(t);
  }, [score]);
  useEffect(() => {
    const start = prevScoreRef.current, end = score; if (start === end) { setDisplayScore(end); return; }
    let raf = 0; const duration = 800; const t0 = performance.now();
    const ease = (p:number)=> (p<0.5? 2*p*p : -1 + (4-2*p)*p);
    const step = (t:number)=>{ const p=Math.min(1,(t-t0)/duration); const val=Math.round(start+(end-start)*ease(p)); setDisplayScore(val); if(p<1) raf=requestAnimationFrame(step); else prevScoreRef.current=end; };
    raf = requestAnimationFrame(step); return ()=> cancelAnimationFrame(raf);
  }, [score]);

  /* mark completion and record firstPlayedOn date if not set */
  useEffect(() => {
    if (!dailyTargets.length) return;
    const complete = guesses.length===dailyTargets.length && guesses.every(Boolean);
    if (complete) {
      // persist firstPlayedOn only once
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const rec = history[gameDate] || {};
      if (!rec.firstPlayedOn) {
        rec.firstPlayedOn = todayPT;
        history[gameDate] = rec;
        localStorage.setItem(LS_HISTORY, JSON.stringify(history));
      }
      if (freezeActiveAfterAnswer !== null) return;
      setGameOver(true);
    } else if (gameOver) { setGameOver(false); }
  }, [guesses, dailyTargets.length, freezeActiveAfterAnswer, gameOver, gameDate, todayPT]);

  /* focus current input */
  useEffect(() => {
    if (!started || gameOver) return;
    if (activeLevel >= 0) {
      const el = inputRefs.current[activeLevel];
      if (el) { try { (el as any).focus({ preventScroll: true }); } catch { el.focus(); window.scrollTo(0,0); } }
    }
  }, [activeLevel, started, gameOver]);

  /* per-level countdown */
  useEffect(() => {
    if (!started || gameOver) return;
    const idx = activeLevel;
    if (idx < 0 || idx >= dailyTargets.length) return;
    if (guesses[idx]) return;
    if (freezeActiveAfterAnswer !== null) return;

    setBasePointsLeft(prev => {
      const next = prev.length===dailyTargets.length ? [...prev] : Array(dailyTargets.length).fill(MAX_BASE_POINTS);
      if (next[idx]==null) next[idx] = MAX_BASE_POINTS; return next;
    });

    levelDelayRef.current = window.setTimeout(() => {
      setLevelStartAt(prev => {
        const n = prev.length===dailyTargets.length ? [...prev] : Array(dailyTargets.length).fill(null);
        if (n[idx]==null) n[idx] = Date.now();
        levelStartAtRef.current = n.slice();
        return n;
      });
      levelTimerRef.current = window.setInterval(() => {
        setBasePointsLeft(prev => {
          const n = prev.length===dailyTargets.length ? [...prev] : Array(dailyTargets.length).fill(MAX_BASE_POINTS);
          const st = levelStartAtRef.current[idx];
          if (st != null) {
            const elapsedSec = Math.floor((Date.now() - st) / 1000);
            const left = Math.max(0, MAX_BASE_POINTS - elapsedSec);
            n[idx] = left;
            // auto-give-up when we hit zero
            if (left === 0) {
              window.clearInterval(levelTimerRef.current!);
              levelTimerRef.current = null;
              handleSkip(idx);
            }
          } else {
            n[idx] = MAX_BASE_POINTS;
          }
          return n;
        });
      }, TICK_MS);
    }, COUNTDOWN_START_DELAY_MS);

    return () => {
      if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current = null; }
      if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    };
  }, [activeLevel, started, gameOver, guesses, freezeActiveAfterAnswer, dailyTargets.length]);

  /* end-game confetti: two strong side blasts */
  useEffect(() => {
    if (gameOver && !confettiFired) {
      const blast = (x: number, angle: number) =>
        confetti({
          particleCount: 900,
          spread: 60,
          startVelocity: 74,
          angle,
          origin: { x, y: 0.78 },
          ticks: 180,
          drift: angle < 90 ? 1.1 : -1.1
        });
      setTimeout(() => blast(0.10, 60), 140);
      setTimeout(() => blast(0.90, 120), 320);
      setConfettiFired(true);
    }
  }, [gameOver, confettiFired]);

  /* ---- LIVE COMMUNITY % from API (fallback to local history) ---- */
  const refreshCommunity = async () => {
    try {
      const res = await fetch(`/api/stats?date=${gameDate}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.levels)) {
        setCommunityPct(
          data.levels.map((v: number) => Math.max(0, Math.min(100, Math.round(v))))
        );
      }
    } catch {/* ignore */}
  };

  useEffect(() => {
    if (!dailyTargets.length) return;

    const computeLocal = () => {
      const totals = new Array(dailyTargets.length).fill(0);
      const rights = new Array(dailyTargets.length).fill(0);
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      Object.values(history).forEach((rec: any) => {
        if (!rec?.guesses || !Array.isArray(rec.guesses)) return;
        if (rec.guesses.length !== dailyTargets.length) return;
        rec.guesses.forEach((g: Guess | null, i: number) => {
          if (g) { totals[i] += 1; if (g.correct) rights[i] += 1; }
        });
      });
      const pct = totals.map((t, i) => (t ? Math.round((rights[i] / t) * 100) : 50));
      setCommunityPct(pct);
    };

    (async () => {
      try {
        await refreshCommunity();
        if (!communityPct.length) computeLocal();
      } catch {
        computeLocal();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyTargets.length, gameDate]);

  /* helpers */
  const sanitizeImageName = (name: string) => name.trim().replace(/\s+/g, '_');
  const preloadImages = (urls: string[]) => { urls.forEach(src=>{ const img=new Image(); img.decoding='async'; img.src=src; }); };
  const stopLevelTimer = () => {
    if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current=null; }
    if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current=null; }
  };
  const startRevealHold = (index: number, then: () => void, holdMs: number) => {
    setFreezeActiveAfterAnswer(index); stopLevelTimer();
    window.setTimeout(() => { setFreezeActiveAfterAnswer(null); then(); }, holdMs);
  };
  const advanceToNext = (index: number) => { if (index < dailyTargets.length - 1) setActiveLevel(index + 1); };

  async function postResultSafe(levelIndex: number, correct: boolean) {
    const lk = `posted-${gameDate}-L${levelIndex}`;
    if (localStorage.getItem(lk)) return;
    if (postedLevelsRef.current.has(levelIndex)) return;
    postedLevelsRef.current.add(levelIndex);
    localStorage.setItem(lk, '1');
    try {
      const res = await fetch('/api/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: gameDate, levelIndex, correct })
      });
      if (!res.ok) {
        postedLevelsRef.current.delete(levelIndex);
        console.warn('results post failed', await res.text());
        return;
      }
      void refreshCommunity();
    } catch (e) {
      postedLevelsRef.current.delete(levelIndex);
      console.warn('postResult error', e);
    }
  }

  // suggestions & input
  const handleInputChange = (index: number, value: string) => {
    const s = players
      .filter(p => p.name.toLowerCase().includes(value.toLowerCase()))
      .map(p=>p.name)
      .sort()
      .slice(0,20);
    const u = [...filteredSuggestions]; u[index]=s; setFilteredSuggestions(u); setHighlightIndex(-1);
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    const max = filteredSuggestions[idx]?.length || 0; if (!max) return;
    if (e.key==='ArrowDown'){ setHighlightIndex(p=>(p+1)%max); e.preventDefault(); }
    else if (e.key==='ArrowUp'){ setHighlightIndex(p=>(p-1+max)%max); e.preventDefault(); }
    else if (e.key==='Enter' && highlightIndex>=0){ handleGuess(idx, filteredSuggestions[idx][highlightIndex]); }
  };

  const revealHint = (idx: number) => {
    if (hintShown[idx]) return;
    const possible = players.filter(p => p.path.join('>') === dailyTargets[idx].path.join('>'));
    let pos: string | null = null;
    let bestDiff = Number.POSITIVE_INFINITY;
    possible.forEach(p => {
      const d = (typeof p.difficulty === 'number') ? p.difficulty : 9999;
      if (d < bestDiff) { bestDiff = d; pos = p.position || null; }
    });
    const s = [...hintShown]; s[idx] = true; setHintShown(s);
    const hp = [...hintPositions]; hp[idx] = pos; setHintPositions(hp);
  };

  const handleGuess = (index: number, value: string) => {
    if (guesses[index]) return;

    const correctPathKey = dailyTargets[index]?.path.join('>');
    const matched = players.find(
      (p) => p.name.toLowerCase()===value.toLowerCase() && p.path.join('>')===correctPathKey
    );

    const updated = [...guesses];
    updated[index] = { guess: value, correct: !!matched };
    setGuesses(updated);

    postResultSafe(index, !!matched);

    const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[index] ?? MAX_BASE_POINTS));
    const multiplier = index + 1;
    const awarded = matched ? baseLeft * multiplier : 0;

    setAwardedPoints(prev => { const n=[...prev]; n[index]=awarded; return n; });
    if (matched) {
      setScore(prev => prev + awarded);
      const el = inputRefs.current[index];
      let x = 0.5, y = 0.5;
      if (el) { const r = el.getBoundingClientRect(); x = (r.left + r.right)/2 / window.innerWidth; y = r.bottom / window.innerHeight; }
      confetti({ particleCount: 140, spread: 90, startVelocity: 55, origin: { x, y } });
      confetti({ particleCount: 100, spread: 70, startVelocity: 65, origin: { x: Math.min(0.95, x+0.08), y } });
    }

    const sugg = [...filteredSuggestions]; sugg[index]=[]; setFilteredSuggestions(sugg);

    const willComplete = updated.every(Boolean);
    if (willComplete) {
      startRevealHold(index, () => { setGameOver(true); }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, () => advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const handleSkip = (index: number) => {
    if (guesses[index]) return;

    const updated = [...guesses];
    updated[index] = { guess: 'No Answer', correct: false };
    setGuesses(updated);

    postResultSafe(index, false);

    setAwardedPoints(prev => { const n=[...prev]; n[index]=0; return n; });

    const sugg = [...filteredSuggestions]; sugg[index]=[]; setFilteredSuggestions(sugg);

    const willComplete = updated.every(Boolean);
    if (willComplete) {
      startRevealHold(index, () => { setGameOver(true); }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, () => advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const shareNow = () => {
    const title = `🏈 Helmets${gameNumber ? ` #${gameNumber}` : ''} – ${gameDateMMDDYY}`;
    const emojiSquares = guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('');
    const emojiForScore = scoreEmojis(score);
    const text =
`${title}

${emojiSquares}
Score: ${score} ${emojiForScore}

www.helmets-game.com`;
    if (navigator.share) {
      navigator.share({ title: 'Helmets', text }).catch(() => navigator.clipboard.writeText(text));
    } else {
      navigator.clipboard.writeText(text);
      alert('Score copied!');
    }
  };

  const handleStartGame = () => {
    setStarted(true);
    const m = JSON.parse(localStorage.getItem(LS_STARTED) || '{}');
    m[gameDate] = true; localStorage.setItem(LS_STARTED, JSON.stringify(m));
    setShowRules(false); setRulesOpenedManually(false);
    setActiveLevel(-1);
    setTimeout(() => {
      setActiveLevel(0);
      setTimeout(() => { const el=inputRefs.current[0]; if (el){ try{ (el as any).focus({preventScroll:true}); }catch{ el.focus(); window.scrollTo(0,0);} } }, 120);
    }, 420);
  };

  const duringActive = started && !gameOver && !showPopup;

  return (
    <div className={`app-container ${duringActive ? 'app-fixed' : ''} ${gameOver ? 'is-complete' : ''} ${!started ? 'is-prestart' : ''}`}>
      <header className="game-header">
        <div className="title-row">
          <img className="game-logo" src="/android-chrome-outline-large-512x512.png" alt="Game Logo" />
          <h1 className="game-title">HELMETS</h1>
        </div>
        <div className="date-line">
          {gameNumber ? <>Game #{gameNumber} — {gameDateHeader}</> : gameDateHeader}
        </div>
        <div className="score-line">Score: <span className="score-number">{displayScore}</span></div>
        {gameOver && (
          <div className="top-status-row">
            <div className="nextgame-wrap">
              <div className="nextgame-label">Next Game:</div>
              <div className="nextgame-time" id="nextgame-time">{/* you already have your countdown logic elsewhere */}</div>
            </div>
            <button className="prev-games-link" onClick={() => setShowHistory(true)}>Previous Games</button>
          </div>
        )}
        <button className="rules-button" onClick={() => { setRulesOpenedManually(true); setShowRules(true); }}>Rules</button>
      </header>

      {gameOver && (
        <div className="complete-banner complete-banner--top">
          <h3>🎯 Game Complete</h3>
          <div className="banner-emoji">{guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('')}</div>
          <div className="banner-score">Score: <span className="score-number">{displayScore}</span></div>
          {/* perfect bonus line can be elsewhere if you already show it; keeping simple here */}
          <div className="banner-share-wrap">
            <button className="banner-share-button" onClick={shareNow}>Share Score!</button>
          </div>
        </div>
      )}

      {duringActive && <div className="level-backdrop" aria-hidden="true" />}

      {dailyTargets.map((target, idx) => {
        const isDone = !!guesses[idx];
        const isFeedback = freezeActiveAfterAnswer === idx;
        const isActive = started && !gameOver && ((idx === activeLevel && !isDone) || isFeedback);
        const isCovered = !started || (!isDone && !isActive);

        const blockClass = isDone ? (guesses[idx]!.correct ? 'path-block-correct' : 'path-block-incorrect') : 'path-block-default';
        let stateClass = 'level-card--locked';
        if (isDone && !isFeedback) stateClass = 'level-card--done';
        else if (isActive) stateClass = 'level-card--active';

        const inputEnabled = isActive && !isDone;

        const multiplier = idx + 1;
        const wonPoints = awardedPoints[idx] || 0;
        const showPointsNow = gameOver;
        const badgeText = showPointsNow && isDone ? `+${wonPoints}` : `${multiplier}x Points`;
        const badgeClass = showPointsNow && isDone ? (wonPoints > 0 ? 'level-badge won' : 'level-badge zero') : 'level-badge';

        const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[idx] ?? MAX_BASE_POINTS));

        const hintPos = hintPositions[idx] || '—';

        return (
          <div
            key={idx}
            className={`path-block level-card ${blockClass} ${stateClass} ${isCovered ? 'is-covered' : ''}`}
          >
            {(isActive || gameOver) && <div className="level-tag">Level {idx + 1}</div>}
            <div className={badgeClass} aria-hidden="true">{badgeText}</div>

            <div className="level-cover" aria-hidden={!isCovered}>
              {started && <span className="level-cover-label">Level {idx + 1}</span>}
            </div>

            <div className="card-body">
              {gameOver && <div className="click-hint">Correct Answers</div>}

              <div className="helmet-sequence">
                {target.path.map((team, i) => (
                  <React.Fragment key={i}>
                    <img
                      src={`/images/${sanitizeImageName(team)}.png`}
                      alt={team}
                      className="helmet-icon"
                      style={{ ['--i' as any]: `${i * 160}ms` }}
                    />
                    {i < target.path.length - 1 && <span className="arrow">→</span>}
                  </React.Fragment>
                ))}
              </div>

              <div className="guess-input-container">
                <div className={`guess-input ${guesses[idx] ? (guesses[idx]!.correct ? 'correct' : 'incorrect') : ''}`}>
                  {!guesses[idx] ? (
                    <>
                      <input
                        ref={(el) => (inputRefs.current[idx] = el)}
                        type="text"
                        placeholder={inputEnabled ? "Guess Player" : "Locked"}
                        inputMode="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => inputEnabled && handleInputChange(idx, e.target.value)}
                        onKeyDown={(e) => inputEnabled && handleKeyDown(e, idx)}
                        className="guess-input-field"
                        disabled={!inputEnabled}
                      />

                      {inputEnabled && filteredSuggestions[idx]?.length > 0 && (
                        <div className="suggestion-box fade-in-fast" onMouseLeave={()=>{
                          const u=[...filteredSuggestions]; u[idx]=[]; setFilteredSuggestions(u);
                        }}>
                          {filteredSuggestions[idx].slice(0, 3).map((name, i) => {
                            const typed = inputRefs.current[idx]?.value || '';
                            const match = name.toLowerCase().indexOf(typed.toLowerCase());
                            return (
                              <div
                                key={i}
                                className={`suggestion-item ${highlightIndex === i ? 'highlighted' : ''}`}
                                onMouseDown={() => handleGuess(idx, name)}
                              >
                                <span className="suggestion-name">
                                  {match >= 0 ? (<>{name.slice(0, match)}<strong>{name.slice(match, match + typed.length)}</strong>{name.slice(match + typed.length)}</>) : name}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {isActive && (
                        <>
                          <div className="points-wrap">
                            <div className="points-row">
                              <span className="points-label">Points</span>
                              <span className="points-value">{baseLeft}</span>
                            </div>
                            <div className="points-bar">
                              <div className="points-bar-fill" style={{ ['--fill' as any]: `${(baseLeft / MAX_BASE_POINTS) * 100}%` }} />
                              <div className="points-bar-marker" />
                            </div>
                          </div>

                          <div className="hint-row">
                            {hintShown[idx] ? (
                              <span className="hint-chip">{hintPos || '—'}</span>
                            ) : (
                              <button type="button" className="hint-button" onClick={() => revealHint(idx)}>Hint</button>
                            )}
                          </div>

                          <button className="primary-button skip-button" type="button" onClick={() => handleSkip(idx)}>
                            Give Up
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className={`locked-answer ${guesses[idx]!.correct ? 'answer-correct' : 'answer-incorrect blink-red'}`}>
                      {guesses[idx]!.correct ? `✅ ${guesses[idx]!.guess}` : `❌ ${guesses[idx]!.guess || 'No Answer'}`}
                      {(!gameOver || isFeedback) && (
                        <div style={{ marginTop: 6, fontSize: '0.85rem', fontWeight: 700 }}>
                          {`+${awardedPoints[idx] || 0}`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {gameOver && (
                <div className="possible-answers">
                  <strong>Correct Answers</strong>
                  <ul className="possible-answers-list">
                    {answerLists[idx].map((name, i) => (<li key={i}>👤 {name}</li>))}
                  </ul>
                </div>
              )}

              {gameOver && (
                <div className="community-wrap">
                  <div className="community-row">
                    <span>Users Correct</span>
                    <span>{(communityPct[idx] ?? 0)}%</span>
                  </div>
                  <div className="community-bar">
                    <div className="community-bar-fill" style={{ ['--pct' as any]: `${communityPct[idx] ?? 0}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {!duringActive && !gameOver && (
        <button onClick={() => setShowHistory(true)} className="fab-button fab-history">📅 History</button>
      )}

      {showHistory && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowHistory(false)}>✖</button>
            <h3>📆 Previous Games</h3>
            <div className="calendar-grid">
              {getLastNDatesPT(60)
                .filter((date) => cmpISO(date, gameStartISO) >= 0 && cmpISO(date, todayPT) <= 0)
                .map((date) => {
                  const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
                  const rec = history[date];
                  const played = !!rec?.guesses;
                  let cls = 'calendar-grid-button';
                  let label = date.slice(5);
                  if (played) {
                    const firstOn = rec.firstPlayedOn as string | undefined;
                    if (firstOn && firstOn === date) {
                      cls += ' played-release';
                    } else if (firstOn) {
                      cls += ' played-replayed';
                      label += '*';
                    }
                  }
                  return (
                    <button
                      key={date}
                      className={cls}
                      onClick={() => (window.location.href = `/?date=${date}`)}
                      title={played && rec?.firstPlayedOn && rec.firstPlayedOn !== date ? 'Replayed' : undefined}
                    >
                      {label}
                    </button>
                  );
                })}
            </div>
            <div className="calendar-note">* Replayed game</div>
          </div>
        </div>
      )}

      {showRules && (
        <div className="popup-modal fade-in">
          <div className="popup-content popup-rules">
            {rulesOpenedManually && (
              <button className="close-button" onClick={() => { setShowRules(false); setRulesOpenedManually(false); }}>
                ✖
              </button>
            )}
            <h2>WELCOME TO HELMETS!</h2>
            <h3>HOW TO PLAY</h3>

            <ul className="rules-list football-bullets rules-main">
              <li><strong>Match each helmet path to an NFL player</strong></li>
              <li><strong>5 levels: each gets more difficult and is worth more points</strong></li>
              <li><strong>Only one guess per level</strong></li>
              <li><strong>The faster you answer, the more points you get!</strong></li>
              <li><strong>You get 0 points if you give up a level</strong></li>
            </ul>

            <h4 className="fine-print-title">Fine Print:</h4>
            <ul className="rules-list football-bullets rules-fineprint">
              <li>Each level has a points multiplier (Level 1 = 1x points, Level 5 = 5x points)</li>
              <li>100 bonus points if you get all 5 levels correct</li>
              <li>Player must have played in the year 2000 or later</li>
              <li>College helmet is the player's draft college</li>
              <li>Some paths may have multiple possible answers</li>
            </ul>

            {!started && !gameOver && (
              <button onClick={handleStartGame} className="primary-button" style={{ marginTop: 12 }}>
                Start Game!
              </button>
            )}
          </div>
        </div>
      )}

      {!duringActive && (
        <div className="footer-actions">
          <button onClick={() => setShowFeedback(true)} className="primary-button feedback-bottom">
            💬 Feedback
          </button>
        </div>
      )}

      <footer className="site-disclosure">
        Please note: www.helmets-game.com does not own any of the team, league or event logos depicted within this site.
        All sports logos contained within this site are properties of their respective leagues, teams, ownership groups
        and/or organizations.
      </footer>
    </div>
  );
};

/* ---------- score emojis (your latest mapping) ---------- */
function scoreEmojis(total: number): string {
  if (total < 50) return '🫵🤣🫵';
  if (total < 100) return '🤡';
  if (total < 150) return '🤢';
  if (total < 250) return '😔';
  if (total < 300) return '👀';
  if (total < 400) return '👏';
  if (total < 500) return '📈';
  if (total < 600) return '🎯';
  if (total < 700) return '🔥';
  if (total < 800) return '🥇';
  if (total < 900) return '🚀';
  return '🏆';
}

export default GameComponent;
