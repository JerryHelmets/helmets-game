// src/components/GameComponent.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import Papa from 'papaparse';
import './GameComponent.css';

import Header from './Header';
import LevelCard from './LevelCard';
import Modals from './Modals';

import { todayPTISO, isoToMDYYYY, isoToMDYY, getLastNDatesPT } from './utils/time';
import { seededRandom } from './utils/random';
import { buildShareText, scoreEmojis } from './utils/share';
import {
  LS_GUESSES,
  LS_HISTORY,
  LS_STARTED,
  LS_BASE_PREFIX,
  getStartedFor,
  setStartedFor,
} from './utils/storage';

/* ---------- Types (shared shape with LevelCard) ---------- */
export interface PlayerPath { name: string; path: string[]; path_level: number; }
interface RawPlayerRow { name: string; college: string; position: string; teams: string; difficulty: string; path: string; path_level: string; }
export interface Guess { guess: string; correct: boolean; }
type StoredGuesses = { date: string; guesses: (Guess | null)[]; score: number; awardedPoints: number[]; };

/* ---------- Scoring / timing ---------- */
const REVEAL_HOLD_MS = 2000;
const FINAL_REVEAL_HOLD_MS = 500;
const MAX_BASE_POINTS = 100;
const TICK_MS = 1000;
const COUNTDOWN_START_DELAY_MS = 500;

/* ---------- helpers ---------- */
const sanitizeImageName = (s: string) => s.trim().replace(/\s+/g, '_');

function pickDailyPaths(players: PlayerPath[], dateISO: string) {
  const seed = parseInt(dateISO.replace(/-/g, ''), 10);
  const rng = seededRandom(seed);
  const buckets: Record<number, Map<string, PlayerPath>> = {1:new Map(),2:new Map(),3:new Map(),4:new Map(),5:new Map()};
  players.forEach(p => {
    if (p.path_level>=1 && p.path_level<=5) {
      const key = p.path.join('>');
      if (!buckets[p.path_level].has(key)) buckets[p.path_level].set(key, p);
    }
  });
  const sel: PlayerPath[] = [];
  for (let lvl=1; lvl<=5; lvl++) {
    const arr = Array.from(buckets[lvl].values());
    if (arr.length) sel.push(arr[Math.floor(rng()*arr.length)]);
  }
  return sel;
}
const buildAnswerLists = (players: PlayerPath[], targets: PlayerPath[]) =>
  targets.map(t => players.filter(p => p.path.join('>')===t.path.join('>')).map(p=>p.name).sort());

const isComplete = (guesses: (Guess | null)[], n: number) =>
  guesses.length===n && guesses.every(Boolean);

const GameComponent: React.FC = () => {
  /* --------- Date / routing --------- */
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const dateParam = params.get('date');
  const todayPT = todayPTISO();
  const gameDate = dateParam || todayPT;
  const gameDateHeader = isoToMDYYYY(gameDate);
  const gameDateMMDDYY = isoToMDYY(gameDate);

  /* --------- State --------- */
  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess | null)[]>([]);
  const [awardedPoints, setAwardedPoints] = useState<number[]>([]);
  const [basePointsLeft, setBasePointsLeft] = useState<number[]>([]); // persists per level / date
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const prevScoreRef = useRef(0);
  const [finalDisplayScore, setFinalDisplayScore] = useState(0);

  const [showRules, setShowRules] = useState(false);
  const [rulesOpenedManually, setRulesOpenedManually] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);

  const [started, setStarted] = useState<boolean>(() => getStartedFor(gameDate));
  const [gameOver, setGameOver] = useState(false);
  const [activeLevel, setActiveLevel] = useState(0);
  const [freezeActiveAfterAnswer, setFreezeActiveAfterAnswer] = useState<number | null>(null);

  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);
  const [communityPct, setCommunityPct] = useState<number[]>([]);

  const levelTimerRef = useRef<number | null>(null);
  const levelDelayRef = useRef<number | null>(null);
  const confettiFiredFinal = useRef(false);

  /* --------- viewport lock on mobile --------- */
  useEffect(() => {
    const setH = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    setH(); const onOri = () => setTimeout(setH, 250);
    window.addEventListener('orientationchange', onOri);
    return () => window.removeEventListener('orientationchange', onOri);
  }, []);
  useEffect(() => {
    const lock = (started && !gameOver) || showFinal || showRules || showHistory || showFeedback;
    const oh = document.documentElement.style.overflow, ob = document.body.style.overflow;
    if (lock){ document.documentElement.style.overflow='hidden'; document.body.style.overflow='hidden'; }
    else { document.documentElement.style.overflow=''; document.body.style.overflow=''; }
    return () => { document.documentElement.style.overflow=oh; document.body.style.overflow=ob; };
  }, [started, gameOver, showFinal, showRules, showHistory, showFeedback]);

  /* --------- load players.csv --------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/data/players.csv');
        const csv = await res.text();
        const parsed = Papa.parse(csv, { header: true });
        const rows = parsed.data as RawPlayerRow[];
        const arr: PlayerPath[] = [];
        rows.forEach(r => {
          const name = r.name?.trim(), pathStr = r.path?.trim(), lvl = r.path_level?.trim();
          if (!name || !pathStr || !lvl) return;
          const level = parseInt(lvl, 10); if (Number.isNaN(level)) return;
          arr.push({ name, path: pathStr.split(',').map(s=>s.trim()), path_level: level });
        });
        if (!cancelled) setPlayers(arr);
      } catch (e) { console.error('❌ Error loading CSV', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  /* --------- derive daily targets / answers --------- */
  const dailyPaths = useMemo(() => pickDailyPaths(players, gameDate), [players, gameDate]);
  const answerLists = useMemo(() => buildAnswerLists(players, dailyPaths), [players, dailyPaths]);

  /* --------- initialize day (restore storage) --------- */
  useEffect(() => {
    if (!dailyPaths.length) return;

    // guesses, score, awarded
    let g: (Guess | null)[] = Array(dailyPaths.length).fill(null);
    let s = 0;
    let ap: number[] = Array(dailyPaths.length).fill(0);

    if (dateParam) {
      const hist = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const rec = hist[gameDate];
      if (rec) { g = rec.guesses || g; s = rec.score || 0; ap = Array.isArray(rec.awardedPoints) ? rec.awardedPoints : ap; }
      setStarted(getStartedFor(gameDate) || g.some(Boolean));
      setGameOver(isComplete(g, dailyPaths.length));
      setShowFinal(isComplete(g, dailyPaths.length) && !popupDismissed);
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
      setStarted(getStartedFor(gameDate) || g.some(Boolean));
      setGameOver(isComplete(g, dailyPaths.length));
      setShowFinal(isComplete(g, dailyPaths.length) && !popupDismissed);
    }

    setGuesses(g);
    setScore(s);
    setAwardedPoints(ap);
    const firstNull = g.findIndex(x => !x);
    setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);

    // restore per-level base points countdown
    let base = Array(dailyPaths.length).fill(MAX_BASE_POINTS);
    const saved = localStorage.getItem(LS_BASE_PREFIX + gameDate);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) base = base.map((v,i)=> (typeof parsed[i]==='number' ? Math.max(0, Math.min(100, parsed[i])) : v));
      } catch {}
    }
    setBasePointsLeft(base);

    setDisplayScore(s);
    prevScoreRef.current = s;
    setRevealedAnswers(Array(dailyPaths.length).fill(false));
    confettiFiredFinal.current = false;
    setPopupDismissed(false);
  }, [dailyPaths, gameDate, dateParam]);

  /* --------- persist history + day-local cache --------- */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    history[gameDate] = { guesses, score, awardedPoints };
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    if (!dateParam) {
      const payload: StoredGuesses = { date: gameDate, guesses, score, awardedPoints };
      localStorage.setItem(LS_GUESSES, JSON.stringify(payload));
    }
  }, [guesses, score, awardedPoints, gameDate, dateParam, dailyPaths.length]);

  /* --------- persist countdown --------- */
  useEffect(() => {
    if (!dailyPaths.length) return;
    localStorage.setItem(LS_BASE_PREFIX + gameDate, JSON.stringify(basePointsLeft));
  }, [basePointsLeft, dailyPaths.length, gameDate]);

  /* --------- score flash + count up --------- */
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

  /* --------- final popup count up + confetti --------- */
  useEffect(() => {
    if (!showFinal) { setFinalDisplayScore(0); return; }
    let raf=0; const start=0, end=score, duration=1800; const t0=performance.now();
    const ease = (p:number)=> (p<0.5? 2*p*p : -1 + (4-2*p)*p);
    const step=(t:number)=>{ const p=Math.min(1,(t-t0)/duration); const val=Math.round(start+(end-start)*ease(p)); setFinalDisplayScore(val); if(p<1) raf=requestAnimationFrame(step); };
    raf=requestAnimationFrame(step);
    if (!confettiFiredFinal.current) {
      confetti({ particleCount: 1800, spread: 170, startVelocity: 60, origin: { y: 0.5 } });
      confettiFiredFinal.current = true;
    }
    return ()=> cancelAnimationFrame(raf);
  }, [showFinal, score]);

  /* --------- completion gate (respect immediate feedback) --------- */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const complete = isComplete(guesses, dailyPaths.length);
    if (complete) {
      if (freezeActiveAfterAnswer !== null) return;
      setGameOver(true);
      if (!showFinal && !popupDismissed) setShowFinal(true);
    } else if (gameOver) {
      setGameOver(false);
    }
  }, [guesses, dailyPaths.length, freezeActiveAfterAnswer, showFinal, popupDismissed, gameOver]);

  /* --------- per-level countdown (persisted) --------- */
  useEffect(() => {
    if (!started || gameOver) return;
    const idx = activeLevel;
    if (idx < 0 || idx >= dailyPaths.length) return;
    if (guesses[idx]) return;
    if (freezeActiveAfterAnswer !== null) return;

    setBasePointsLeft(prev => {
      const next = prev.length===dailyPaths.length ? [...prev] : Array(dailyPaths.length).fill(MAX_BASE_POINTS);
      if (typeof next[idx] !== 'number') next[idx] = MAX_BASE_POINTS;
      return next;
    });

    levelDelayRef.current = window.setTimeout(() => {
      levelTimerRef.current = window.setInterval(() => {
        setBasePointsLeft(prev => {
          const n=[...prev]; const cur=n[idx] ?? MAX_BASE_POINTS; n[idx] = Math.max(0, cur-1); return n;
        });
      }, TICK_MS);
    }, COUNTDOWN_START_DELAY_MS);

    return () => {
      if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current = null; }
      if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    };
  }, [activeLevel, started, gameOver, guesses, freezeActiveAfterAnswer, dailyPaths.length]);

  /* --------- community % (remote -> local fallback) --------- */
  useEffect(() => {
    if (!dailyPaths.length) return;

    const computeLocal = () => {
      const totals = new Array(dailyPaths.length).fill(0);
      const rights = new Array(dailyPaths.length).fill(0);
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      Object.values(history).forEach((rec: any) => {
        if (!rec?.guesses || !Array.isArray(rec.guesses)) return;
        if (rec.guesses.length !== dailyPaths.length) return;
        rec.guesses.forEach((g: Guess | null, i: number) => { if (g) { totals[i] += 1; if (g.correct) rights[i] += 1; } });
      });
      const pct = totals.map((t, i) => (t ? Math.round((rights[i] / t) * 100) : 50));
      setCommunityPct(pct);
    };

    (async () => {
      try {
        const res = await fetch(`/data/stats.json?date=${gameDate}`);
        if (!res.ok) { computeLocal(); return; }
        const data = await res.json();
        const arr = (Array.isArray(data?.[gameDate]) ? data[gameDate]
                    : (Array.isArray(data?.levels) ? data.levels : null)) as number[] | null;
        if (arr && arr.length >= dailyPaths.length) {
          setCommunityPct(arr.slice(0, dailyPaths.length).map(v => Math.max(0, Math.min(100, Math.round(v)))));
        } else { computeLocal(); }
      } catch { computeLocal(); }
    })();
  }, [dailyPaths.length, gameDate]);

  /* --------- Handlers --------- */
  const stopLevelTimer = () => {
    if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current=null; }
    if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current=null; }
  };
  const startRevealHold = (index: number, then: () => void, holdMs: number) => {
    setFreezeActiveAfterAnswer(index);
    stopLevelTimer();
    window.setTimeout(() => { setFreezeActiveAfterAnswer(null); then(); }, holdMs);
  };
  const advanceToNext = (index: number) => { if (index < dailyPaths.length - 1) setActiveLevel(index + 1); };

  const handleGuess = (idx: number, value: string, fireConfettiAt?: { x: number; y: number }) => {
    if (guesses[idx]) return;
    const correctPath = dailyPaths[idx]?.path.join('>');
    const matched = players.find(p => p.name.toLowerCase()===value.toLowerCase() && p.path.join('>')===correctPath);

    const updated = [...guesses];
    updated[idx] = { guess: value, correct: !!matched };
    setGuesses(updated);

    const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[idx] ?? MAX_BASE_POINTS));
    const multiplier = idx + 1;
    const awarded = matched ? baseLeft * multiplier : 0;

    setAwardedPoints(prev => { const n=[...prev]; n[idx]=awarded; return n; });

    if (matched && fireConfettiAt) {
      confetti({ particleCount: 140, spread: 90, startVelocity: 55, origin: fireConfettiAt });
      confetti({ particleCount: 100, spread: 70, startVelocity: 65, origin: { x: Math.min(0.95, fireConfettiAt.x+0.08), y: fireConfettiAt.y } });
      setScore(prev => prev + awarded);
    }

    const willComplete = updated.every(Boolean);
    if (willComplete) {
      startRevealHold(idx, () => { setGameOver(true); setShowFinal(true); }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(idx, () => advanceToNext(idx), REVEAL_HOLD_MS);
    }
  };

  const handleSkip = (idx: number) => {
    if (guesses[idx]) return;
    const updated = [...guesses];
    updated[idx] = { guess: 'No Answer', correct: false };
    setGuesses(updated);
    setAwardedPoints(prev => { const n=[...prev]; n[idx]=0; return n; });

    const willComplete = updated.every(Boolean);
    if (willComplete) {
      startRevealHold(idx, () => { setGameOver(true); setShowFinal(true); }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(idx, () => advanceToNext(idx), REVEAL_HOLD_MS);
    }
  };

  const handleStartGame = () => {
    setStarted(true); setStartedFor(gameDate, true); setShowRules(false); setRulesOpenedManually(false);
    setActiveLevel(-1);
    setTimeout(() => setActiveLevel(0), 420);
  };

  const shareNow = () => {
    const emojiSquares = guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('');
    const emojiForScore = scoreEmojis(score);
    const text = buildShareText({
      title: `🏈 Helmets – ${gameDateMMDDYY}`,
      squares: emojiSquares,
      score,
      emojiForScore,
      url: 'www.helmets-game.com',
      firstEmojiLine: true,   // matches your latest format
    });
    if (navigator.share) {
      navigator.share({ title: 'Helmets', text }).catch(() => navigator.clipboard.writeText(text));
    } else {
      navigator.clipboard.writeText(text);
      alert('Score copied!');
    }
  };

  /* --------- Derived UI flags --------- */
  const duringActive = started && !gameOver && !showFinal;
  const appFixed = duringActive ? 'app-fixed' : '';
  const prestartClass = !started ? 'is-prestart' : '';

  /* --------- Render --------- */
  return (
    <div className={`app-container ${appFixed} ${gameOver ? 'is-complete' : ''} ${prestartClass}`}>
      <Header
        dateText={gameDateHeader}
        score={displayScore}
        onOpenRules={() => { setRulesOpenedManually(true); setShowRules(true); }}
      />

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

      {duringActive && <div className="level-backdrop" aria-hidden="true" />}

      {dailyPaths.map((path, idx) => {
        const guess = guesses[idx];
        const isDone = !!guess;
        const isFeedback = freezeActiveAfterAnswer === idx;
        const isActive = started && !gameOver && ((idx === activeLevel && !isDone) || isFeedback);
        const isCovered = !started || (!isDone && !isActive);

        const multiplier = idx + 1;
        const won = awardedPoints[idx] || 0;
        const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[idx] ?? MAX_BASE_POINTS));

        return (
          <LevelCard
            key={idx}
            idx={idx}
            path={path}
            guess={guess}
            isActive={isActive}
            isCovered={isCovered}
            isFeedback={isFeedback}
            multiplier={multiplier}
            awarded={won}
            baseLeft={baseLeft}
            communityPct={communityPct[idx] ?? 0}
            showPointsNow={gameOver}
            sanitizeImageName={sanitizeImageName}
            onGuess={(name, origin) => handleGuess(idx, name, origin)}
            onSkip={() => handleSkip(idx)}
            onToggleReveal={() => {
              if (!gameOver) return;
              const u=[...revealedAnswers]; u[idx]=!u[idx]; setRevealedAnswers(u);
            }}
            answers={answerLists[idx] || []}
          />
        );
      })}

      {!duringActive && !gameOver && (
        <button onClick={() => setShowHistory(true)} className="fab-button fab-history">📅 History</button>
      )}

      <Modals
        showRules={showRules}
        rulesOpenedManually={rulesOpenedManually}
        onCloseRules={() => { setShowRules(false); setRulesOpenedManually(false); }}
        canCloseRules={rulesOpenedManually}
        onStartGame={(!started && !gameOver) ? handleStartGame : undefined}

        showHistory={showHistory}
        onCloseHistory={() => setShowHistory(false)}
        historyDates={getLastNDatesPT(30)}
        todayISO={todayPT}

        showFeedback={showFeedback}
        onCloseFeedback={() => setShowFeedback(false)}

        showFinal={showFinal}
        onCloseFinal={() => { setShowFinal(false); setPopupDismissed(true); }}
        finalDate={gameDateMMDDYY}
        finalScore={finalDisplayScore}
        squares={guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('')}
        onShare={shareNow}
      />

      {!duringActive && (
        <div className="footer-actions">
          <button onClick={() => setShowFeedback(true)} className="primary-button feedback-bottom">💬 Feedback</button>
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
