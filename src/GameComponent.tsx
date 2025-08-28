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

/* ----- TIMER / POINTS ----- */
const MAX_BASE_POINTS = 60;
const HINT_THRESHOLD = 30;
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
  const shuffle = <T,>(arr: T[], seed: number) => {
    const a = arr.slice(); let s = seed;
    const rnd = () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); };
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
function buildAnswerLists(players: PlayerPath[], targets: PlayerPath[]) {
  return targets.map(t => {
    const same = players.filter(p => p.path.join('>')===t.path.join('>'));
    return same
      .map(p => ({ name: p.name, position: p.position, difficulty: (typeof p.difficulty==='number' && Number.isFinite(p.difficulty)) ? p.difficulty : Infinity }))
      .sort((a,b) => a.difficulty===b.difficulty ? a.name.localeCompare(b.name) : a.difficulty - b.difficulty);
  });
}
const isComplete = (guesses: (Guess | null)[], total: number) =>
  guesses.length===total && guesses.every(Boolean);

/* ---------- started flags ---------- */
function getStartedMap(){ try { return JSON.parse(localStorage.getItem(LS_STARTED) || '{}'); } catch { return {}; } }
function setStartedFor(date: string, v: boolean){ const m = getStartedMap(); m[date]=v; localStorage.setItem(LS_STARTED, JSON.stringify(m)); }
function getStartedFor(date: string){ const m = getStartedMap(); return !!m[date]; }

/* ---------- score-range emojis ---------- */
function scoreEmojis(total: number): string {
  if (total < 50) return '🫵🤣🫵';
  if (total < 100) return '🤡';
  if (total < 150) return '🤢';
  if (total < 250) return '😔';
  if (total < 300) return '👀';
  if (total < 400) return '👏';
  if (total < 500) return '📈';
  if (total < 600) return '🎯';  // flipped
  if (total < 700) return '🔥';  // flipped
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
  const [filteredSuggestions, setFilteredSuggestions] = useState<Array<Array<{name:string; position?:string}>>>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const prevScoreRef = useRef(0);
  const [finalDisplayScore, setFinalDisplayScore] = useState(0);

  const [showPopup, setShowPopup] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [confettiFired, setConfettiFired] = useState(false);
  const [started, setStarted] = useState<boolean>(() => getStartedFor(gameDate));
  const [activeLevel, setActiveLevel] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [rulesOpenedManually, setRulesOpenedManually] = useState(false);

  const [freezeActiveAfterAnswer, setFreezeActiveAfterAnswer] = useState<number | null>(null);

  const [basePointsLeft, setBasePointsLeft] = useState<number[]>([]);
  const [awardedPoints, setAwardedPoints] = useState<number[]>([]);

  const [communityPct, setCommunityPct] = useState<number[]>([]);

  const [levelStartAt, setLevelStartAt] = useState<(number | null)[]>([]);
  const levelStartAtRef = useRef<(number | null)[]>([]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const levelTimerRef = useRef<number | null>(null);
  const levelDelayRef = useRef<number | null>(null);

  const postedLevelsRef = useRef<Set<number>>(new Set());

  const [hintForced, setHintForced] = useState(false);
  useEffect(() => { setHintForced(false); }, [activeLevel]);

  /* --------- DIM + SCROLL LOCK ---------
     We use two overlays:
     - body.dim-bg::before (dims *outside* the app, incl. page edges)
     - .app-container.dim-app::before (dims inside the app)
     App container is lifted above body overlay via z-index. */
  useEffect(() => {
    const lock = (started && !gameOver) || showPopup || showRules || showHistory || showFeedback;
    const html = document.documentElement;
    const body = document.body;
    const app = document.querySelector('.app-container') as HTMLElement | null;

    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;

    const calcDimTop = () => {
      const hdr = document.querySelector('.game-header') as HTMLElement | null;
      const headerBottom = hdr ? Math.ceil(hdr.getBoundingClientRect().bottom) : 0;
      document.documentElement.style.setProperty('--bg-dim-top', `${Math.max(0, headerBottom + 6)}px`);
    };

    if (lock) {
      html.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      body.classList.add('dim-bg');
      app?.classList.add('dim-app');
      // ensure the app paints above body overlay
      app?.classList.add('app-on-top');
      calcDimTop();
      requestAnimationFrame(calcDimTop);
      window.addEventListener('resize', calcDimTop);
      window.addEventListener('orientationchange', calcDimTop);
    } else {
      html.style.overflow = '';
      body.style.overflow = '';
      body.classList.remove('dim-bg');
      app?.classList.remove('dim-app', 'app-on-top');
      document.documentElement.style.removeProperty('--bg-dim-top');
      window.removeEventListener('resize', calcDimTop);
      window.removeEventListener('orientationchange', calcDimTop);
    }

    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      body.classList.remove('dim-bg');
      app?.classList.remove('dim-app', 'app-on-top');
      document.documentElement.style.removeProperty('--bg-dim-top');
      window.removeEventListener('resize', calcDimTop);
      window.removeEventListener('orientationchange', calcDimTop);
    };
  }, [started, gameOver, showPopup, showRules, showHistory, showFeedback]);

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
          const num = r.difficulty ? Number(r.difficulty) : undefined;
          const difficulty = (typeof num === 'number' && !Number.isNaN(num)) ? num : undefined;
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

    let g: (Guess | null)[] = Array(dailyPaths.length).fill(null);
    let s = 0;
    let ap: number[] = Array(dailyPaths.length).fill(0);

    if (dateParam) {
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const data = history[gameDate];
      if (data) { g = data.guesses || g; s = data.score || 0; ap = Array.isArray(data.awardedPoints) ? data.awardedPoints : ap; }
      setGuesses(g); setScore(s); setAwardedPoints(ap);
      const startedFlag = getStartedFor(gameDate) || g.some(Boolean);
      const complete = isComplete(g, dailyPaths.length);
      setStarted(startedFlag); setGameOver(complete);
      setShowPopup(complete && !popupDismissed);
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
      const startedFlag = getStartedFor(gameDate) || g.some(Boolean);
      setStarted(startedFlag);
      const firstNull = g.findIndex(x => !x); setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);
      const complete = isComplete(g, dailyPaths.length);
      setGameOver(complete); setShowPopup(complete && !popupDismissed);
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
        if (Array.isArray(parsed)) starts = starts.map((v,i)=> (typeof parsed[i]==='number' ? parsed[i] as number : null));
      } catch {}
    }
    setLevelStartAt(starts);
    levelStartAtRef.current = starts.slice();

    setRevealedAnswers(Array(dailyPaths.length).fill(false));
    setFilteredSuggestions(Array(dailyPaths.length).fill([]));
    setPopupDismissed(false);
    setConfettiFired(false);

    setDisplayScore(s);
    prevScoreRef.current = s;
  }, [dailyPaths, gameDate, dateParam, popupDismissed]);

  /* persist */
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

  useEffect(() => {
    if (!dailyPaths.length) return;
    localStorage.setItem(LS_BASE_PREFIX + gameDate, JSON.stringify(basePointsLeft));
  }, [basePointsLeft, gameDate, dailyPaths.length]);
  useEffect(() => {
    if (!dailyPaths.length) return;
    localStorage.setItem(LS_START_PREFIX + gameDate, JSON.stringify(levelStartAt));
  }, [levelStartAt, gameDate, dailyPaths.length]);
  useEffect(() => { levelStartAtRef.current = levelStartAt.slice(); }, [levelStartAt]);

  /* header score flash + count-up */
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

  /* final popup count-up */
  useEffect(() => {
    if (!showPopup) { setFinalDisplayScore(0); return; }
    let raf=0; const start=0, end=score, duration=1800; const t0=performance.now();
    const ease = (p:number)=> (p<0.5? 2*p*p : -1 + (4-2*p)*p);
    const step=(t:number)=>{ const p=Math.min(1,(t-t0)/duration); const val=Math.round(start+(end-start)*ease(p)); setFinalDisplayScore(val); if(p<1) raf=requestAnimationFrame(step); };
    raf=requestAnimationFrame(step); return ()=> cancelAnimationFrame(raf);
  }, [showPopup, score]);

  /* completion (adds +100 for 5/5) */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const complete = guesses.length===dailyPaths.length && guesses.every(Boolean);
    if (complete) {
      if (freezeActiveAfterAnswer !== null) return;
      const allCorrect = guesses.every(g => g?.correct);
      if (allCorrect) setScore(prev => prev + 100);
      setGameOver(true);
      if (!showPopup && !popupDismissed) setShowPopup(true);
    } else if (gameOver) { setGameOver(false); }
  }, [guesses, dailyPaths.length, freezeActiveAfterAnswer, showPopup, popupDismissed, gameOver]);

  /* focus input */
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
          return n;
        });
      }, TICK_MS);
    }, COUNTDOWN_START_DELAY_MS);

    return () => {
      if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current=null; }
      if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current=null; }
    };
  }, [activeLevel, started, gameOver, guesses, freezeActiveAfterAnswer, dailyPaths.length]);

  /* confetti on final popup */
  useEffect(() => {
    if (showPopup && !confettiFired) {
      confetti({ particleCount: 1800, spread: 170, startVelocity: 60, origin: { y: 0.5 } });
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  /* community % */
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
      try { await refreshCommunity(); if (!communityPct.length) computeLocal(); }
      catch { computeLocal(); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyPaths.length, gameDate]);

  // Preload today's helmet images
  useEffect(() => {
    if (!started || !dailyPaths.length) return;
    const urls: string[] = [];
    dailyPaths.forEach(p => p.path.forEach(team => urls.push(`/images/${team.trim().replace(/\s+/g,'_')}.png`)));
    Array.from(new Set(urls)).forEach(src => { const img=new Image(); img.decoding='async'; img.src=src; });
  }, [started, dailyPaths.length]);

  /* helpers */
  const sanitizeImageName = (name: string) => name.trim().replace(/\s+/g, '_');
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
    const val = value.toLowerCase();
    const map = new Map<string, {name:string; position?:string}>();
    players.forEach(p => {
      if (p.name.toLowerCase().includes(val)) {
        if (!map.has(p.name)) map.set(p.name, { name: p.name, position: p.position });
      }
    });
    const arr = Array.from(map.values()).sort((a,b)=> a.name.localeCompare(b.name)).slice(0, 10);
    const u = [...filteredSuggestions]; u[index]=arr; setFilteredSuggestions(u); setHighlightIndex(-1);
  };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    const max = filteredSuggestions[idx]?.length || 0; if (!max) return;
    if (e.key==='ArrowDown'){ setHighlightIndex(p=>(p+1)%max); e.preventDefault(); }
    else if (e.key==='ArrowUp'){ setHighlightIndex(p=>(p-1+max)%max); e.preventDefault(); }
    else if (e.key==='Escape'){ setFilteredSuggestions(prev => { const u=[...prev]; u[idx]=[]; return u; }); }
    else if (e.key==='Enter' && highlightIndex>=0){ handleGuess(idx, filteredSuggestions[idx][highlightIndex].name); }
  };

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
      startRevealHold(index, () => { setGameOver(true); setShowPopup(true); }, FINAL_REVEAL_HOLD_MS);
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
      startRevealHold(index, () => { setGameOver(true); setShowPopup(true); }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, () => advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

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

  const duringActive = started && !gameOver && !showPopup;
  const appFixed = duringActive ? 'app-fixed' : '';
  const prestartClass = !started ? 'is-prestart' : '';

  return (
    <div className={`app-container ${appFixed} ${gameOver ? 'is-complete' : ''} ${prestartClass}`}>
      <header className="game-header">
        <div className="title-row">
          <img className="game-logo" src="/android-chrome-outline-large-512x512.png" alt="Game Logo" />
        </div>
        <h1 className="game-title">HELMETS</h1>
        <div className="date-line">{gameDateHeader}</div>
        <div className="score-line">Score: <span className="score-number">{displayScore}</span></div>
        <button className="rules-button" onClick={() => { setRulesOpenedManually(true); setShowRules(true); }}>Rules</button>
      </header>

      {gameOver && (
        <div className="complete-banner">
          <h3>🎯 Game Complete</h3>
          <p>Tap each box to view possible answers</p>
          <div className="complete-actions">
            <button className="primary-button" onClick={shareNow}>Share Score!</button>
            <button className="secondary-button small" onClick={() => setShowHistory(true)}>Previous day's games</button>
          </div>
        </div>
      )}

      {/* Transparent helper div kept for layout parity */}
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

        const pathKey = path.path.join('>');
        const validAnswers = players.filter(p => p.path.join('>') === pathKey);
        let hintPos: string | null = null;
        let bestDiff = Number.POSITIVE_INFINITY;
        for (const p of validAnswers) {
          const d = (typeof p.difficulty === 'number' && Number.isFinite(p.difficulty)) ? p.difficulty : Number.POSITIVE_INFINITY;
          if (d < bestDiff && p.position) { bestDiff = d; hintPos = p.position; }
        }
        const hintAvailable = !!hintPos;
        const autoHint = hintAvailable && baseLeft <= HINT_THRESHOLD;
        const hintVisible = hintAvailable && (autoHint || (hintForced && idx === activeLevel));
        const revealHintNow = () => {
          if (!hintAvailable) return;
          if (baseLeft <= HINT_THRESHOLD) { setHintForced(true); return; }
          setHintForced(true);
          setLevelStartAt(prev => {
            const n = prev.slice();
            const targetElapsed = MAX_BASE_POINTS - HINT_THRESHOLD;
            n[idx] = Date.now() - targetElapsed * 1000;
            return n;
          });
        };

        return (
          <div
            key={idx}
            className={`path-block level-card ${blockClass} ${stateClass} ${isCovered ? 'is-covered' : ''}`}
            onClick={() => { if (gameOver) { const u=[...revealedAnswers]; u[idx]=!u[idx]; setRevealedAnswers(u); } }}
          >
            {(isActive || gameOver) && <div className="level-tag">Level {idx + 1}</div>}
            <div className={badgeClass} aria-hidden="true">{badgeText}</div>

            <div className="level-cover" aria-hidden={!isCovered}>
              {started && <span className="level-cover-label">Level {idx + 1}</span>}
            </div>

            <div className="card-body">
              {gameOver && <div className="click-hint">Click to view possible answers</div>}

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
                        onBlur={() => { setFilteredSuggestions(prev => { const u=[...prev]; u[idx]=[]; return u; }); }}
                        className="guess-input-field guess-input-mobile font-mobile"
                        disabled={!inputEnabled}
                      />

                      {inputEnabled && filteredSuggestions[idx]?.length > 0 && (
                        <div className="suggestion-box fade-in-fast">
                          {filteredSuggestions[idx].slice(0, 8).map((s, i) => {
                            const typed = inputRefs.current[idx]?.value || '';
                            const match = s.name.toLowerCase().indexOf(typed.toLowerCase());
                            const before = match >= 0 ? s.name.slice(0, match) : s.name;
                            const mid = match >= 0 ? s.name.slice(match, match + typed.length) : '';
                            const after = match >= 0 ? s.name.slice(match + typed.length) : '';
                            return (
                              <div
                                key={`${s.name}-${i}`}
                                className={`suggestion-item ${highlightIndex === i ? 'highlighted' : ''}`}
                                onMouseDown={() => handleGuess(idx, s.name)}
                              >
                                <span className="suggestion-name">
                                  {match >= 0 ? (<>{before}<strong>{mid}</strong>{after}</>) : s.name}
                                </span>
                                {s.position && <span className="suggestion-pos">{s.position}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {isActive && (
                        <div className="points-wrap">
                          <div className="points-row">
                            <span className="points-label">Points</span>
                            <span className="points-value">{baseLeft}</span>
                          </div>
                          <div
                            className="points-bar"
                            style={{
                              ['--fill' as any]: `${(baseLeft / MAX_BASE_POINTS) * 100}%`,
                              ['--marker' as any]: `${(HINT_THRESHOLD / MAX_BASE_POINTS) * 100}%`,
                            }}
                          >
                            <div className="points-bar-fill" />
                            <div className="points-bar-marker" aria-hidden title={`Hint at ${HINT_THRESHOLD}`} />
                          </div>
                        </div>
                      )}

                      {inputEnabled && hintAvailable && !hintVisible && (
                        <div className="hint-row">
                          <button type="button" className="hint-button" onClick={revealHintNow}>
                            HINT
                          </button>
                        </div>
                      )}
                      {inputEnabled && hintVisible && (
                        <div className="hint-row">
                          <span className="hint-chip">{hintPos}</span>
                        </div>
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

              {gameOver && revealedAnswers[idx] && !!answerLists[idx]?.length && (
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

      {!duringActive && !gameOver && (
        <button onClick={() => setShowHistory(true)} className="fab-button fab-history">📅 History</button>
      )}

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
              onClick={() => { navigator.clipboard.writeText('jerry.helmetsgame@gmail.com'); setCopied(true); setTimeout(()=>setCopied(false),1500); }}
              className="primary-button"
            >
              Copy Email
            </button>
            {copied && <p className="copied-msg">Email copied!</p>}
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

      {showPopup && (
        <div className="popup-modal fade-in">
          <div className="popup-content popup-final">
            <button className="close-button" onClick={() => { setShowPopup(false); setPopupDismissed(true); }}>✖</button>
            <h3 className="popup-title">🎉 Game Complete!</h3>
            <p className="popup-date">{gameDateMMDDYY}</p>
            <p className="popup-score">Score: <span className="score-number">{finalDisplayScore}</span></p>
            <p>{guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('')}</p>
            <button onClick={shareNow} className="primary-button">Share Score!</button>
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

export default GameComponent;
