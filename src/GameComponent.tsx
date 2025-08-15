import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import confetti from 'canvas-confetti';
import Papa from 'papaparse';
import './GameComponent.css';

import Header from './components/Header';
import LevelCard, { PlayerPath as PlayerPathType } from './components/LevelCard';
import { RulesModal, FinalModal, HistoryModal } from './components/Modals';
import { getLastNDatesPT, isoToMDYY, isoToMDYYYY, todayPTISO } from './utils/time'; // adjust import name typo
import { hash32, xorshift32 } from './utils/random';
import { DayState, getStartedFor, loadDay, saveDay, setStartedFor } from './utils/storage';
import { buildShareText, scoreEmojis } from './utils/share';

// (fix import typo)
const isoToMDYYYY_fixed = isoToMDYYYY;
const isoToMDYY_fixed = isoToMDYY;

/* Types aligned with your CSV */
interface PlayerPath { name: string; path: string[]; path_level: number; }
interface RawPlayerRow { name: string; college: string; position: string; teams: string; difficulty: string; path: string; path_level: string; }
interface Guess { guess: string; correct: boolean; }

const REVEAL_HOLD_MS = 2000;
const FINAL_REVEAL_HOLD_MS = 500;
const MAX_BASE_POINTS = 100;
const TICK_MS = 1000;
const COUNTDOWN_START_DELAY_MS = 500;

/* --------- pick daily paths (same behavior) --------- */
function pickDailyPaths(players: PlayerPath[], dateISO: string) {
  const rng = xorshift32(hash32(dateISO));
  const buckets: Record<number, Map<string, PlayerPath>> = {1:new Map(),2:new Map(),3:new Map(),4:new Map(),5:new Map()};
  players.forEach(p => {
    if (p.path_level>=1 && p.path_level<=5) {
      const k = p.path.join('>');
      if (!buckets[p.path_level].has(k)) buckets[p.path_level].set(k,p);
    }
  });
  const sel: PlayerPath[] = [];
  for (let lvl=1; lvl<=5; lvl++) {
    const a = Array.from(buckets[lvl].values());
    if (a.length) sel.push(a[Math.floor(rng()*a.length)]);
  }
  return sel;
}
function buildAnswerLists(players: PlayerPath[], targets: PlayerPath[]) {
  return targets.map(t =>
    players.filter(p => p.path.join('>')===t.path.join('>')).map(p=>p.name).sort()
  );
}
const isComplete = (guesses: (Guess | null)[], total: number) =>
  guesses.length===total && guesses.every(Boolean);

/* anon id */
function getAnonId() {
  const k = 'helmets-uid';
  let id = localStorage.getItem(k);
  if (!id) {
    id = self.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    localStorage.setItem(k, id);
  }
  return id;
}

const GameComponent: React.FC = () => {
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const dateParam = params.get('date');
  const todayPT = todayPTISO();
  const gameDate = dateParam || todayPT;
  const gameDateHeader = isoToMDYYYY_fixed(gameDate);
  const gameDateMMDDYY = isoToMDYY_fixed(gameDate);

  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess | null)[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
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

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const levelTimerRef = useRef<number | null>(null);
  const levelDelayRef = useRef<number | null>(null);
  const searchDebounceRef = useRef<number | null>(null);

  /* viewport scale height + scroll lock */
  useEffect(() => {
    const setH = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    setH(); const onOri = () => setTimeout(setH, 250);
    window.addEventListener('orientationchange', onOri);
    return () => window.removeEventListener('orientationchange', onOri);
  }, []);
  useEffect(() => {
    const lock = (started && !gameOver) || showPopup || showRules || showHistory || showFeedback;
    const oh = document.documentElement.style.overflow, ob = document.body.style.overflow;
    if (lock){ document.documentElement.style.overflow='hidden'; document.body.style.overflow='hidden'; }
    else { document.documentElement.style.overflow=''; document.body.style.overflow=''; }
    return () => { document.documentElement.style.overflow=oh; document.body.style.overflow=ob; };
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
          arr.push({ name, path: pathStr.split(',').map(s=>s.trim()), path_level: level });
        });
        if (!cancelled) setPlayers(arr);
      } catch (e) { console.error('❌ CSV load', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  const dailyPaths = useMemo<PlayerPathType[]>(() => pickDailyPaths(players, gameDate), [players, gameDate]);
  const answerLists = useMemo<string[][]>(() => buildAnswerLists(players, dailyPaths), [players, dailyPaths]);

  /* preload helmet images */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const urls = new Set<string>();
    const sanitize = (n: string) => n.trim().replace(/\s+/g, '_');
    dailyPaths.forEach(p => p.path.forEach(team => urls.add(`/images/${sanitize(team)}.png`)));
    const imgs: HTMLImageElement[] = [];
    urls.forEach(src => { const img = new Image(); img.src = src; imgs.push(img); });
    return () => { imgs.forEach(i => { (i as any).onload = null; }); };
  }, [dailyPaths]);

  /* init day (read new schema, gracefully falls back to defaults) */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const saved = loadDay(gameDate);
    let g = Array(dailyPaths.length).fill(null) as (Guess | null)[];
    let s = 0;
    let ap = Array(dailyPaths.length).fill(0) as number[];
    let base = Array(dailyPaths.length).fill(MAX_BASE_POINTS) as number[];

    if (saved && saved.guesses.length === dailyPaths.length) {
      g = saved.guesses; s = saved.score; ap = saved.awardedPoints ?? ap; base = saved.basePointsLeft ?? base;
    }
    setGuesses(g); setScore(s); setAwardedPoints(ap); setBasePointsLeft(base);

    const startedFlag = getStartedFor(gameDate) || g.some(Boolean);
    const complete = isComplete(g, dailyPaths.length);
    setStarted(startedFlag); setGameOver(complete);
    setShowPopup(complete && !popupDismissed);
    setShowRules(!startedFlag && !complete); setRulesOpenedManually(false);
    const firstNull = g.findIndex(x => !x); setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);

    setRevealedAnswers(Array(dailyPaths.length).fill(false));
    setFilteredSuggestions(Array(dailyPaths.length).fill([]));
    setPopupDismissed(false);
    setConfettiFired(false);

    setDisplayScore(s);
    prevScoreRef.current = s;
  }, [dailyPaths, gameDate]);

  /* persist day */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const state: DayState = {
      v: 1,
      date: gameDate,
      guesses,
      score,
      awardedPoints,
      basePointsLeft
    };
    saveDay(state);
  }, [guesses, score, awardedPoints, basePointsLeft, dailyPaths.length, gameDate]);

  /* score flash + count up */
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

  /* completion with reveal hold respected */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const complete = guesses.length===dailyPaths.length && guesses.every(Boolean);
    if (complete) {
      if (freezeActiveAfterAnswer !== null) return;
      setGameOver(true);
      if (!showPopup && !popupDismissed) setShowPopup(true);
    } else if (gameOver) { setGameOver(false); }
  }, [guesses, dailyPaths.length, freezeActiveAfterAnswer, showPopup, popupDismissed, gameOver]);

  /* focus active input */
  useEffect(() => {
    if (!started || gameOver) return;
    if (activeLevel >= 0) {
      const el = inputRefs.current[activeLevel];
      if (el) { try { (el as any).focus({ preventScroll: true }); } catch { el.focus(); window.scrollTo(0,0); } }
    }
  }, [activeLevel, started, gameOver]);

  /* per-level countdown (persisted) */
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

  /* confetti on final popup */
  useEffect(() => {
    if (showPopup && !confettiFired) {
      confetti({ particleCount: 1800, spread: 170, startVelocity: 60, origin: { y: 0.5 } });
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  /* LIVE universal results polling */
  useEffect(() => {
    if (!dailyPaths.length) return;

    const computeLocal = () => {
      const totals = new Array(dailyPaths.length).fill(0);
      const rights = new Array(dailyPaths.length).fill(0);
      const history = Object.values(localStorage).map(v => { try{return JSON.parse(v);}catch{return null;}});
      history.forEach((rec: any) => {
        if (!rec?.v || rec.v !== 1) return;
        if (!rec?.guesses || !Array.isArray(rec.guesses)) return;
        if (rec.date !== gameDate) return;
        if (rec.guesses.length !== dailyPaths.length) return;
        rec.guesses.forEach((g: Guess | null, i: number) => {
          if (g) { totals[i] += 1; if (g.correct) rights[i] += 1; }
        });
      });
      const pct = totals.map((t, i) => (t ? Math.round((rights[i] / t) * 100) : 50));
      setCommunityPct(pct);
    };

    let stop = false;
    async function load() {
      try {
        const res = await fetch(`/api/stats?date=${gameDate}`, { cache: 'no-store' });
        if (!res.ok) { computeLocal(); return; }
        const data = await res.json();
        const arr = (Array.isArray(data?.levels) ? data.levels : null) as number[] | null;
        if (!stop && arr && arr.length >= dailyPaths.length) {
          setCommunityPct(arr.slice(0, dailyPaths.length).map(v => Math.max(0, Math.min(100, Math.round(v)))));
        } else if (!stop) {
          computeLocal();
        }
      } catch {
        if (!stop) computeLocal();
      }
    }
    load();
    const id = window.setInterval(load, 15000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { stop = true; window.clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [dailyPaths.length, gameDate]);

  /* helpers */
  const sanitizeImageName = useCallback((name: string) => name.trim().replace(/\s+/g, '_'), []);

  const stopLevelTimer = () => {
    if (levelDelayRef.current) { window.clearTimeout(levelDelayRef.current); levelDelayRef.current=null; }
    if (levelTimerRef.current) { window.clearInterval(levelTimerRef.current); levelTimerRef.current=null; }
  };
  const startRevealHold = (index: number, then: () => void, holdMs: number) => {
    setFreezeActiveAfterAnswer(index); stopLevelTimer();
    window.setTimeout(() => { setFreezeActiveAfterAnswer(null); then(); }, holdMs);
  };
  const advanceToNext = (index: number) => { if (index < dailyPaths.length - 1) setActiveLevel(index + 1); };

  /* debounced suggestions */
  const handleInputChange = (index: number, value: string) => {
    if (searchDebounceRef.current) window.clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      const v = value.trim().toLowerCase();
      const s = players.filter(p => p.name.toLowerCase().includes(v))
                       .map(p=>p.name).sort().slice(0,20);
      setFilteredSuggestions(prev => { const u = [...prev]; u[index] = s; return u; });
      setHighlightIndex(-1);
    }, 150);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    const max = filteredSuggestions[idx]?.length || 0; if (!max) return;
    if (e.key==='ArrowDown'){ setHighlightIndex(p=>(p+1)%max); e.preventDefault(); }
    else if (e.key==='ArrowUp'){ setHighlightIndex(p=>(p-1+max)%max); e.preventDefault(); }
    else if (e.key==='Enter' && highlightIndex>=0){ e.preventDefault(); handleGuess(idx, filteredSuggestions[idx][highlightIndex]); }
  };

  const postFinalize = (index: number, correct: boolean) => {
    try {
      fetch('/api/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: gameDate, level: index, correct, uid: getAnonId() }),
      }).catch(() => {});
    } catch {}
  };

  const handleGuess = (index: number, value: string) => {
    if (guesses[index]) return;
    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(p => p.name.toLowerCase()===value.toLowerCase() && p.path.join('>')===correctPath);

    const updated = [...guesses];
    updated[index] = { guess: value, correct: !!matched };
    setGuesses(updated);

    const baseLeftVal = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[index] ?? MAX_BASE_POINTS));
    const multiplier = index + 1;
    const awarded = matched ? baseLeftVal * multiplier : 0;

    setAwardedPoints(prev => { const n=[...prev]; n[index]=awarded; return n; });
    if (matched) {
      setScore(prev => prev + awarded);
      const el = inputRefs.current[index];
      let x = 0.5, y = 0.5;
      if (el) { const r = el.getBoundingClientRect(); x = (r.left + r.right)/2 / window.innerWidth; y = r.bottom / window.innerHeight; }
      confetti({ particleCount: 140, spread: 90, startVelocity: 55, origin: { x, y } });
      confetti({ particleCount: 100, spread: 70, startVelocity: 65, origin: { x: Math.min(0.95, x+0.08), y } });
    }

    setFilteredSuggestions(prev => { const u=[...prev]; u[index]=[]; return u; });
    postFinalize(index, !!matched);

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
    setAwardedPoints(prev => { const n=[...prev]; n[index]=0; return n; });
    setFilteredSuggestions(prev => { const u=[...prev]; u[index]=[]; return u; });

    postFinalize(index, false);

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
    const text = buildShareText(title, emojiSquares, score, emojiForScore);

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
    }, 500);
  };

  /* render */
  const duringActive = started && !gameOver && !showPopup;
  const appFixed = duringActive ? 'app-fixed' : '';
  const prestartClass = !started ? 'is-prestart' : '';

  return (
    <div className={`app-container ${appFixed} ${gameOver ? 'is-complete' : ''} ${prestartClass}`}>
      <Header
        gameDateHeader={gameDateHeader}
        displayScore={displayScore}
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
        const isDone = !!guesses[idx];
        const isFeedback = freezeActiveAfterAnswer === idx;
        const isActive = started && !gameOver && ((idx === activeLevel && !isDone) || isFeedback);
        const isCovered = !started || (!isDone && !isActive);

        const multiplier = idx + 1;
        const wonPoints = awardedPoints[idx] || 0;
        const baseLeftVal = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[idx] ?? MAX_BASE_POINTS));

        return (
          <LevelCard
            key={idx}
            idx={idx}
            path={path}
            started={started}
            gameOver={gameOver}
            isActive={isActive}
            isCovered={isCovered}
            isFeedback={isFeedback}
            guess={guesses[idx]}
            revealed={revealedAnswers[idx]}
            multiplier={multiplier}
            awarded={wonPoints}
            baseLeft={baseLeftVal}
            communityPct={communityPct[idx] ?? 0}
            suggestions={filteredSuggestions[idx] ?? []}
            highlightIndex={highlightIndex}
            onToggleReveal={(i) => setRevealedAnswers(prev => { const u=[...prev]; u[i]=!u[i]; return u; })}
            onInputChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onGuess={handleGuess}
            onSkip={handleSkip}
            inputRef={(el) => (inputRefs.current[idx] = el)}
            sanitizeImageName={(name) => name.trim().replace(/\s+/g, '_')}
          />
        );
      })}

      {!duringActive && !gameOver && (
        <button onClick={() => setShowHistory(true)} className="fab-button fab-history">📅 History</button>
      )}

      <HistoryModal
        show={showHistory}
        onClose={() => setShowHistory(false)}
        todayPT={todayPT}
        dates={getLastNDatesPT(30)}
      />

      <RulesModal
        show={showRules}
        onClose={() => { setShowRules(false); setRulesOpenedManually(false); }}
        canClose={rulesOpenedManually}
        onStart={handleStartGame}
      />

      <FinalModal
        show={showPopup}
        onClose={() => { setShowPopup(false); setPopupDismissed(true); }}
        dateMMDDYY={gameDateMMDDYY}
        finalDisplayScore={finalDisplayScore}
        squares={guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('')}
        onShare={shareNow}
      />

      {!duringActive && (
        <div className="footer-actions">
          <a
            href="#"
            className="feedback-link"
            onClick={(e) => { e.preventDefault(); setShowFeedback(true); }}
          >
            💬 Feedback
          </a>
        </div>
      )}

      {/* simple feedback popup reuse Rules/Final modal shell if you want later; left as-is for brevity */}
      {showFeedback && (
        <div className="popup-modal" aria-hidden={false}>
          <div className="popup-content" role="document">
            <button className="close-button" onClick={() => setShowFeedback(false)} aria-label="Close">✖</button>
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

      <footer className="site-disclosure">
        Please note: www.helmets-game.com does not own any of the team, league or event logos depicted within this site.
        All sports logos contained within this site are properties of their respective leagues, teams, ownership groups
        and/or organizations.
      </footer>
    </div>
  );
};

export default GameComponent;
