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

const LS_GUESSES = 'helmets-guesses';
const LS_HISTORY = 'helmets-history';
const LS_STARTED = 'helmets-started';
const LS_BASE_PREFIX = 'helmets-basepoints-';
const LS_START_PREFIX = 'helmets-levelstart-';

const REVEAL_HOLD_MS = 2000;
const FINAL_REVEAL_HOLD_MS = 500;

const MAX_BASE_POINTS = 60;   // 60s per level
const HINT_THRESHOLD = 30;    // auto/manual hint at 30
const TICK_MS = 1000;
const COUNTDOWN_START_DELAY_MS = 500;

/* ---------- PACIFIC TIME helpers ---------- */
function getPTDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === t)?.value;
  const y = get('year')!, m = get('month')!, d = get('day')!;
  const h = +(get('hour') ?? '0'), min = +(get('minute') ?? '0'), s = +(get('second') ?? '0');
  return { y, m, d, h, min, s };
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

/* Sorted answers (lowest difficulty first) */
function buildAnswerLists(players: PlayerPath[], targets: PlayerPath[]) {
  return targets.map(t =>
    players
      .filter(p => p.path.join('>')===t.path.join('>'))
      .sort((a,b)=> (a.difficulty ?? 999) - (b.difficulty ?? 999))
  );
}

const isComplete = (guesses: (Guess | null)[], total: number) =>
  guesses.length===total && guesses.every(Boolean);

/* ---------- started flags ---------- */
function getStartedMap(){ try { return JSON.parse(localStorage.getItem(LS_STARTED) || '{}'); } catch { return {}; } }
function setStartedFor(date: string, v: boolean){ const m = getStartedMap(); m[date]=v; localStorage.setItem(LS_STARTED, JSON.stringify(m)); }
function getStartedFor(date: string){ const m = getStartedMap(); return !!m[date]; }

/* ---------- score emojis ---------- */
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

const GameComponent: React.FC = () => {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const dateParam = params.get('date');
  const todayPT = todayPTISO();
  const gameDate = dateParam || todayPT;
  const gameDateHeader = isoToMDYYYY(gameDate);
  const gameDateMMDDYY = isoToMDYY(gameDate);

  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess | null)[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const prevScoreRef = useRef(0);

  const [showFeedback, setShowFeedback] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [confettiFired, setConfettiFired] = useState(false);
  const [started, setStarted] = useState<boolean>(() => getStartedFor(gameDate));
  const [activeLevel, setActiveLevel] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [rulesOpenedManually, setRulesOpenedManually] = useState(false);

  const [freezeActiveAfterAnswer, setFreezeActiveAfterAnswer] = useState<number | null>(null);

  const [basePointsLeft, setBasePointsLeft] = useState<number[]>([]);
  const [awardedPoints, setAwardedPoints] = useState<number[]>([]);
  const [gotPerfect, setGotPerfect] = useState<boolean>(false);

  const [communityPct, setCommunityPct] = useState<number[]>([]);

  // Time-based countdown start timestamps (per level)
  const [levelStartAt, setLevelStartAt] = useState<(number | null)[]>([]);
  const levelStartAtRef = useRef<(number | null)[]>([]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const levelTimerRef = useRef<number | null>(null);
  const levelDelayRef = useRef<number | null>(null);

  const postedLevelsRef = useRef<Set<number>>(new Set());
  const autoSkippedRef = useRef<Set<number>>(new Set());

  // Hints
  const [hintShown, setHintShown] = useState<boolean[]>([]);

  // Banner count-up
  const [bannerScore, setBannerScore] = useState(0);

  // Next Game countdown (PT) — shown only when gameOver
  const [nextSecs, setNextSecs] = useState<number>(0);
  const formatHMS = (s: number) => {
    const hh = Math.floor(s/3600), mm = Math.floor((s%3600)/60), ss = s%60;
    const pad = (n:number)=> String(n).padStart(2,'0');
    return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  };

  /* viewport / scroll lock */
  useEffect(() => {
    const setH = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    setH(); const onOri = () => setTimeout(setH, 250);
    window.addEventListener('orientationchange', onOri);
    return () => window.removeEventListener('orientationchange', onOri);
  }, []);
  useEffect(() => {
    const lock = (started && !gameOver) || showRules || showHistory || showFeedback;
    const oh = document.documentElement.style.overflow, ob = document.body.style.overflow;
    if (lock){ document.documentElement.style.overflow='hidden'; document.body.style.overflow='hidden'; }
    else { document.documentElement.style.overflow=''; document.body.style.overflow=''; }
    return () => { document.documentElement.style.overflow=oh; document.body.style.overflow=ob; };
  }, [started, gameOver, showRules, showHistory, showFeedback]);

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

  const dailyPaths = useMemo(() => pickDailyPaths(players, gameDate), [players, gameDate]);
  const answerLists = useMemo(() => buildAnswerLists(players, dailyPaths), [players, dailyPaths]);

  /* init for day */
  useEffect(() => {
    if (!dailyPaths.length) return;
    postedLevelsRef.current = new Set();
    autoSkippedRef.current = new Set();
    setGotPerfect(false);

    let g: (Guess | null)[] = Array(dailyPaths.length).fill(null);
    let s = 0;
    let ap: number[] = Array(dailyPaths.length).fill(0);

    if (dateParam) {
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const data = history[gameDate];
      if (data) { g = data.guesses || g; s = data.score || 0; ap = Array.isArray(data.awardedPoints) ? data.awardedPoints : ap; }
      setGuesses(g); setScore(s); setAwardedPoints(ap);
      const complete = isComplete(g, dailyPaths.length);
      setGotPerfect(complete && g.every(x => x?.correct));  // persist perfect via saved guesses
      const startedFlag = getStartedFor(gameDate) || g.some(Boolean);
      setStarted(startedFlag); setGameOver(complete);
      setShowRules(!startedFlag && !complete); setRulesOpenedManually(false);
      const firstNull = g.findIndex(x => !x); setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);
    } else {
      const raw = localStorage.getItem(LS_GUESSES);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<StoredGuesses>;
          if (parsed.date === gameDate && Array.isArray(parsed.guesses) && parsed.guesses.length === dailyPaths.length) {
            g = parsed.guesses as (Guess | null)[]; s = parsed.score ?? 0; ap = Array.isArray(parsed.awardedPoints) ? parsed.awardedPoints : ap;
          }
        } catch {}
      }
      setGuesses(g); setScore(s); setAwardedPoints(ap);
      const complete = isComplete(g, dailyPaths.length);
      setGotPerfect(complete && g.every(x => x?.correct));  // persist perfect via saved guesses
      const startedFlag = getStartedFor(gameDate) || g.some(Boolean);
      setStarted(startedFlag);
      const firstNull = g.findIndex(x => !x); setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);
      setGameOver(complete);
      setShowRules(!startedFlag && !complete); setRulesOpenedManually(false);
    }

    // restore base points
    let base = Array(dailyPaths.length).fill(MAX_BASE_POINTS);
    const savedBase = localStorage.getItem(LS_BASE_PREFIX + gameDate);
    if (savedBase) {
      try {
        const parsed = JSON.parse(savedBase);
        if (Array.isArray(parsed)) base = base.map((v,i)=> (typeof parsed[i]==='number' ? Math.max(0, Math.min(MAX_BASE_POINTS, parsed[i])) : v));
      } catch {}
    }
    setBasePointsLeft(base);

    // restore level start timestamps
    let starts: (number | null)[] = Array(dailyPaths.length).fill(null);
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

    setFilteredSuggestions(Array(dailyPaths.length).fill([]));
    setConfettiFired(false);
    setBannerScore(0);
    setHintShown(Array(dailyPaths.length).fill(false));
  }, [dailyPaths, gameDate, dateParam]);

  /* persist day */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    history[gameDate] = { guesses, score, awardedPoints };
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    if (!dateParam) {
      const payload: StoredGuesses = { date: gameDate, guesses, score, awardedPoints };
      localStorage.setItem(LS_GUESSES, JSON.stringify(payload));
    }
  }, [guesses, score, awardedPoints, gameDate, dailyPaths.length, dateParam]);

  // persist timers
  useEffect(() => {
    if (!dailyPaths.length) return;
    localStorage.setItem(LS_BASE_PREFIX + gameDate, JSON.stringify(basePointsLeft));
  }, [basePointsLeft, gameDate, dailyPaths.length]);
  useEffect(() => {
    if (!dailyPaths.length) return;
    localStorage.setItem(LS_START_PREFIX + gameDate, JSON.stringify(levelStartAt));
  }, [levelStartAt, gameDate, dailyPaths.length]);
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

  /* banner count-up */
  useEffect(() => {
    if (!gameOver) { setBannerScore(0); return; }
    let raf=0; const start=0, end=score, duration=1400;
    const t0=performance.now();
    const ease = (p:number)=> (p<0.5? 2*p*p : -1 + (4-2*p)*p);
    const step=(t:number)=>{ const p=Math.min(1,(t-t0)/duration); const val=Math.round(start+(end-start)*ease(p)); setBannerScore(val); if(p<1) raf=requestAnimationFrame(step); };
    raf=requestAnimationFrame(step); return ()=> cancelAnimationFrame(raf);
  }, [gameOver, score]);

  /* completion → confetti (strong left/right inward blasts) */
useEffect(() => {
  if (gameOver && !confettiFired) {
    const sideBlast = (side: 'left' | 'right', delay = 0) => {
      const fromLeft = side === 'left';
      const x = fromLeft ? 0.08 : 0.92;   // near screen edges
      const angle = fromLeft ? 60 : 120;  // aim inward toward center
      const drift = fromLeft ? 1.2 : -1.2;

      setTimeout(() => {
        // main volley (potent)
        confetti({
          particleCount: 850,
          spread: 55,
          startVelocity: 72,
          angle,
          origin: { x, y: 0.78 },
          drift,
          scalar: 1
        });
        // quick follow-up for fullness
        confetti({
          particleCount: 520,
          spread: 70,
          startVelocity: 58,
          angle,
          origin: { x, y: 0.80 },
          drift: drift * 1.1,
          scalar: 0.9
        });
      }, delay);
    };

    // staggered left/right volleys
    sideBlast('left', 120);
    sideBlast('right', 260);
    sideBlast('left', 420);
    sideBlast('right', 560);

    setConfettiFired(true);
  }
}, [gameOver, confettiFired]);


  /* ---- LIVE COMMUNITY % ---- */
  const refreshCommunity = async () => {
    try {
      const res = await fetch(`/api/stats?date=${gameDate}`, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data?.levels)) {
        setCommunityPct(data.levels.map((v: number) => Math.max(0, Math.min(100, Math.round(v)))));
      }
    } catch {/* ignore */}
  };
  useEffect(() => {
    if (!dailyPaths.length) return;
    const computeLocal = () => {
      const totals = new Array(dailyPaths.length).fill(0);
      const rights = new Array(dailyPaths.length).fill(0);
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      Object.values(history).forEach((rec: any) => {
        if (!rec?.guesses || !Array.isArray(rec.guesses)) return;
        if (rec.guesses.length !== dailyPaths.length) return;
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
      } catch { computeLocal(); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyPaths.length, gameDate]);

  // Preload helmets
  const sanitizeImageName = (name: string) => name.trim().replace(/\s+/g, '_');
  const preloadImages = (urls: string[]) => { urls.forEach(src=>{ const img=new Image(); img.decoding='async'; img.src=src; }); };
  useEffect(() => {
    if (!started || !dailyPaths.length) return;
    const urls: string[] = [];
    dailyPaths.forEach(p => { p.path.forEach(team => urls.push(`/images/${sanitizeImageName(team)}.png`)); });
    preloadImages(Array.from(new Set(urls)));
  }, [started, dailyPaths.length]);

  const stopLevelTimer = () => {
    if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current=null; }
    if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current=null; }
  };
  const startRevealHold = (index: number, then: () => void, holdMs: number) => {
    setFreezeActiveAfterAnswer(index); stopLevelTimer();
    window.setTimeout(() => { setFreezeActiveAfterAnswer(null); then(); }, holdMs);
  };
  const advanceToNext = (index: number) => { if (index < dailyPaths.length - 1) setActiveLevel(index + 1); };

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

  // Hide suggestions when clicking away
  useEffect(() => {
    const onDocDown = (ev: MouseEvent) => {
      const box = document.querySelector('.suggestion-box');
      const input = inputRefs.current[activeLevel] || null;
      const t = ev.target as Node;
      if (box && box.contains(t)) return;
      if (input && input.contains && input.contains(t)) return;
      // click-away: clear only active level suggestions
      setFilteredSuggestions(prev => {
        const n = [...prev];
        if (activeLevel >= 0) n[activeLevel] = [];
        return n;
      });
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [activeLevel]);

  const handleGuess = (index: number, value: string) => {
    if (guesses[index]) return;

    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(
      (p) => p.name.toLowerCase()===value.toLowerCase() && p.path.join('>')===correctPath
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
      const allCorrect = updated.every(g => g?.correct);
      if (allCorrect) { setScore(prev => prev + 100); setGotPerfect(true); }
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

  // Auto "Give Up" at 0
  const autoGiveUpIfZero = (idx: number, pts: number) => {
    if (pts <= 0 && !guesses[idx] && !autoSkippedRef.current.has(idx)) {
      autoSkippedRef.current.add(idx);
      handleSkip(idx);
    }
  };

  // Manual + auto hint
  const revealHint = (idx: number) => {
    setHintShown(prev => { const n=[...prev]; n[idx]=true; return n; });
    setBasePointsLeft(prev => {
      const n = [...prev];
      const current = n[idx] ?? MAX_BASE_POINTS;
      if (current > HINT_THRESHOLD) {
        setLevelStartAt(prevStarts => {
          const ns = [...(prevStarts.length ? prevStarts : Array(n.length).fill(null))];
          const desiredElapsedMs = (MAX_BASE_POINTS - HINT_THRESHOLD) * 1000;
          ns[idx] = Date.now() - desiredElapsedMs;
          levelStartAtRef.current = ns.slice();
          return ns;
        });
        n[idx] = HINT_THRESHOLD;
      }
      return n;
    });
  };

  /* per-level countdown */
  useEffect(() => {
    if (!started || gameOver) return;
    const idx = activeLevel;
    if (idx < 0 || idx >= dailyPaths.length) return;
    if (guesses[idx]) return;
    if (freezeActiveAfterAnswer !== null) return;

    setBasePointsLeft(prev => {
      const next = prev.length===dailyPaths.length ? [...prev] : Array(dailyPaths.length).fill(MAX_BASE_POINTS);
      if (next[idx]==null) next[idx] = MAX_BASE_POINTS; return next;
    });

    levelDelayRef.current = window.setTimeout(() => {
      setLevelStartAt(prev => {
        const n = prev.length===dailyPaths.length ? [...prev] : Array(dailyPaths.length).fill(null);
        if (n[idx]==null) n[idx] = Date.now();
        levelStartAtRef.current = n.slice();
        return n;
      });
      levelTimerRef.current = window.setInterval(() => {
        setBasePointsLeft(prev => {
          const n = prev.length===dailyPaths.length ? [...prev] : Array(dailyPaths.length).fill(MAX_BASE_POINTS);
          const st = levelStartAtRef.current[idx];
          if (st != null) {
            const elapsedSec = Math.floor((Date.now() - st) / 1000);
            n[idx] = Math.max(0, MAX_BASE_POINTS - elapsedSec);
          } else {
            n[idx] = MAX_BASE_POINTS;
          }
          if (n[idx] <= HINT_THRESHOLD && !hintShown[idx] && !guesses[idx]) {
            setHintShown(prev => { const m=[...prev]; m[idx]=true; return m; });
          }
          autoGiveUpIfZero(idx, n[idx]);
          return n;
        });
      }, TICK_MS);
    }, COUNTDOWN_START_DELAY_MS);

    return () => {
      if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current = null; }
      if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    };
  }, [activeLevel, started, gameOver, guesses, freezeActiveAfterAnswer, dailyPaths.length, hintShown]);

  // Next Game PT countdown — update each second, but show only when gameOver (render logic below)
  useEffect(() => {
    const compute = () => {
      const { h, min, s } = getPTDateParts(new Date());
      const elapsed = h*3600 + min*60 + s;         // seconds elapsed in the current PT day
      let left = 24*3600 - elapsed;
      if (left <= 0) left = 24*3600;
      setNextSecs(left);
    };
    compute();
    const id = window.setInterval(compute, 1000);
    return () => window.clearInterval(id);
  }, []);

  const shareNow = () => {
    const title = `🏈 Helmets – ${gameDateMMDDYY}`;
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
    setStarted(true); setStartedFor(gameDate, true); setShowRules(false); setRulesOpenedManually(false);
    setActiveLevel(-1);
    setTimeout(() => {
      setActiveLevel(0);
      setTimeout(() => { const el=inputRefs.current[0]; if (el){ try{ (el as any).focus({preventScroll:true}); }catch{ el.focus(); window.scrollTo(0,0);} } }, 120);
    }, 420);
  };

  const duringActive = started && !gameOver;
  const appFixed = duringActive ? 'app-fixed' : '';
  const prestartClass = !started ? 'is-prestart' : '';

  const EmojiSummary = () => <span className="banner-emoji">{guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('')}</span>;
  const BannerScoreLine = () => <span className="banner-score">Score: <span className="score-number">{bannerScore}</span></span>;

  return (
    <div className={`app-container ${appFixed} ${gameOver ? 'is-complete' : ''} ${prestartClass}`}>
      <header className="game-header">
        <div className="title-row">
          <img className="game-logo" src="/android-chrome-outline-large-512x512.png" alt="Game Logo" />
          <h1 className="game-title">HELMETS</h1>
        </div>
        <div className="date-line">{gameDateHeader}</div>
        <div className="score-line">Score: <span className="score-number">{displayScore}</span></div>
        <button className="rules-button" onClick={() => { setRulesOpenedManually(true); setShowRules(true); }}>Rules</button>

        {/* Status row ONLY in end game: countdown + previous games to the right */}
        {gameOver && (
          <div className="top-status-row">
            <div className="nextgame-wrap">
              <div className="nextgame-label">Next Game:</div>
              <div className="nextgame-time">{formatHMS(nextSecs)}</div>
            </div>
            <button className="prev-games-link" onClick={() => setShowHistory(true)}>Previous Games</button>
          </div>
        )}
      </header>

      {/* TOP Game Complete banner */}
{gameOver && (
  <div className="complete-banner complete-banner--top">
    <h3>🎯 Game Complete</h3>
    <EmojiSummary />
    <BannerScoreLine />
    {gotPerfect && <p className="banner-bonus">+100! (5/5)</p>}
    <div className="banner-share-wrap">
      <button className="banner-share-button" onClick={shareNow}>Share Score!</button>
    </div>
  </div>
)}

      {duringActive && <div className="level-backdrop" aria-hidden="true" />}

      {dailyPaths.map((path, idx) => {
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
        const hintPos = answerLists[idx]?.[0]?.position || '';

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
              <div className="helmet-sequence">
                {path.path.map((team, i) => (
                  <React.Fragment key={i}>
                    <img
                      src={`/images/${sanitizeImageName(team)}.png`}
                      alt={team}
                      className="helmet-icon"
                      style={{ ['--i' as any]: `${i * 160}ms` }}
                    />
                    {i < path.path.length - 1 && <span className="arrow">→</span>}
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
                        onBlur={() => {
                          // hide suggestions when the input loses focus (click-away safety)
                          setFilteredSuggestions(prev => { const n=[...prev]; n[idx]=[]; return n; });
                        }}
                        className="guess-input-field guess-input-mobile font-mobile"
                        disabled={!inputEnabled}
                      />

                      {inputEnabled && filteredSuggestions[idx]?.length > 0 && (
                        <div className="suggestion-box fade-in-fast">
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
                                <span className="suggestion-pos">
                                  {players.find(p=>p.name===name)?.position ?? ''}
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
    <button
      type="button"
      className="hint-button"
      onClick={() => revealHint(idx)}
    >
      Hint
    </button>
  )}
</div>

                        </>
                      )}

                      {inputEnabled && (
                        <button className="primary-button skip-button" type="button" onClick={() => handleSkip(idx)}>
                          Give Up
                        </button>
                      )}
                    </>
                  ) : (
                    <div className={`locked-answer ${guesses[idx]!.correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}>
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

              {/* Community % bar in game-complete */}
              {gameOver && (
                <div className="community-wrap">
                  <div className="community-row">
                    <span>Users Correct</span>
                    <span>{(communityPct[idx] ?? 0)}%</span>
                  </div>
                  <div className="community-bar">
                    <div className="community-bar-fill" style={{ ['--pct' as any]: `${communityPct[idx] ?? 0}` }} />
                  </div>
                </div>
              )}

              {/* Always show Correct Answers in game-complete */}
              {gameOver && !!answerLists[idx]?.length && (
                <div className="possible-answers">
                  <strong>Correct Answers:</strong>
                  <ul className="possible-answers-list">
                    {answerLists[idx].map((p, i) => (
                      <li key={i}>👤 {p.name}{p.position ? <span className="answer-pos">({p.position})</span> : null}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* BOTTOM Game Complete banner */}
{gameOver && (
  <div className="complete-banner complete-banner--bottom">
    <div className="banner-share-wrap" style={{ marginBottom: 6 }}>
      <button className="banner-share-button" onClick={shareNow}>Share Score!</button>
    </div>
    <EmojiSummary />
    <BannerScoreLine />
    {gotPerfect && <p className="banner-bonus">+100! (5/5)</p>}
  </div>
)}


      {/* History modal */}
      {showHistory && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowHistory(false)}>✖</button>
            <h3>📆 Game History (Last 30 days)</h3>
            <div className="calendar-grid">
              {getLastNDatesPT(30).map((date) => {
                const isToday = date === todayPT;
                return (
                  <button
                    key={date}
                    className={`calendar-grid-button${isToday ? ' today' : ''}`}
                    onClick={() => (window.location.href = `/?date=${date}`)}
                  >
                    {date.slice(5)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Feedback link */}
      <div className="feedback-link" onClick={() => setShowFeedback(true)} role="link" tabIndex={0}>
        💬 Feedback
      </div>

      {showFeedback && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowFeedback(false)}>✖</button>
            <h3>Thoughts for Jerry?</h3>
            <div className="email-row">
              <span className="email-emoji">📧</span>
              <span className="email-text">jerry.helmetsgame@gmail.com</span>
            </div>
            <button
              onClick={() => { navigator.clipboard.writeText('jerry.helmetsgame@gmail.com'); }}
              className="primary-button"
            >
              Copy Email
            </button>
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

      <footer className="site-disclosure">
        Please note: www.helmets-game.com does not own any of the team, league or event logos depicted within this site.
        All sports logos contained within this site are properties of their respective leagues, teams, ownership groups
        and/or organizations.
      </footer>
    </div>
  );
};

export default GameComponent;
