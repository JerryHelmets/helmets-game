import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import Papa from 'papaparse';
import './GameComponent.css';

interface PlayerPath {
  name: string;
  path: string[];
  path_level: number;
}
interface RawPlayerRow {
  name: string;
  college: string;
  position: string;
  teams: string;
  difficulty: string;
  path: string;
  path_level: string;
}
interface Guess {
  guess: string;
  correct: boolean;
}
type StoredGuesses = {
  date: string;
  guesses: (Guess | null)[];
  score: number;
};

const LS_GUESSES = 'helmets-guesses';
const LS_HISTORY = 'helmets-history';
const LS_STARTED = 'helmets-started';
const LS_BASE_PREFIX = 'helmets-basepoints-'; // per-day countdown storage

const REVEAL_HOLD_MS = 2000;       // feedback hold on normal levels
const FINAL_REVEAL_HOLD_MS = 500;  // last level immediate feedback (short)
const MAX_BASE_POINTS = 100;       // per-level starting points
const TICK_MS = 1000;              // 1s tick

/* ---------------- Eastern Time helpers ---------------- */
function getETDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return { y, m, d };
}
function toETISO(date: Date) {
  const { y, m, d } = getETDateParts(date);
  return `${y}-${m}-${d}`;
}
function todayETISO() { return toETISO(new Date()); }
function todayET_MMDDYY() {
  const { y, m, d } = getETDateParts();
  return `${m}/${d}/${y.slice(-2)}`;
}
function getLastNDatesET(n: number): string[] {
  const base = new Date();
  const arr: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    arr.push(toETISO(d));
  }
  return arr;
}

/* ---------------- Daily selection ---------------- */
function seededRandom(seed: number) {
  return function () {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
}
function pickDailyPaths(players: PlayerPath[], dateISO: string): PlayerPath[] {
  const seed = parseInt(dateISO.replace(/-/g, ''), 10);
  const rng = seededRandom(seed);
  const buckets: Record<number, Map<string, PlayerPath>> = {
    1: new Map(), 2: new Map(), 3: new Map(), 4: new Map(), 5: new Map(),
  };
  players.forEach((p) => {
    if (p.path_level >= 1 && p.path_level <= 5) {
      const key = p.path.join('>');
      if (!buckets[p.path_level].has(key)) buckets[p.path_level].set(key, p);
    }
  });
  const selected: PlayerPath[] = [];
  for (let lvl = 1; lvl <= 5; lvl++) {
    const arr = Array.from(buckets[lvl].values());
    if (arr.length) selected.push(arr[Math.floor(rng() * arr.length)]);
  }
  return selected;
}
function buildAnswerLists(players: PlayerPath[], targets: PlayerPath[]) {
  return targets.map((t) =>
    players.filter((p) => p.path.join('>') === t.path.join('>')).map((p) => p.name).sort()
  );
}
const isComplete = (guesses: (Guess | null)[], total: number) =>
  guesses.length === total && guesses.every(Boolean);

/* ---------------- started flags per day ---------------- */
function getStartedMap() {
  try { return JSON.parse(localStorage.getItem(LS_STARTED) || '{}'); } catch { return {}; }
}
function setStartedFor(date: string, v: boolean) {
  const m = getStartedMap(); m[date] = v; localStorage.setItem(LS_STARTED, JSON.stringify(m));
}
function getStartedFor(date: string) { const m = getStartedMap(); return !!m[date]; }

/* ===================================================== */

const GameComponent: React.FC = () => {
  /* Date (ET) */
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const dateParam = params.get('date'); // YYYY-MM-DD
  const todayET = todayETISO();
  the:
  const gameDate = dateParam || todayET;
  const shareDateMMDDYY = todayET_MMDDYY();

  /* State */
  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess | null)[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [score, setScore] = useState<number>(0);
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [popupDismissed, setPopupDismissed] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [confettiFired, setConfettiFired] = useState(false);
  const [started, setStarted] = useState<boolean>(() => getStartedFor(gameDate));
  const [activeLevel, setActiveLevel] = useState<number>(0); // when -1, none visible yet
  const [showRules, setShowRules] = useState<boolean>(false);
  const [rulesOpenedManually, setRulesOpenedManually] = useState<boolean>(false);

  // freeze index during immediate feedback hold
  const [freezeActiveAfterAnswer, setFreezeActiveAfterAnswer] = useState<number | null>(null);

  // per-level base points remaining (0..100), persisted per day
  const [basePointsLeft, setBasePointsLeft] = useState<number[]>([]);
  // points actually awarded after guess/skip (includes multiplier)
  const [awardedPoints, setAwardedPoints] = useState<number[]>([]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const levelTimerRef = useRef<number | null>(null);
  const levelDelayRef = useRef<number | null>(null); // <-- start delay before countdown

  /* ===== Mobile viewport lock to avoid jump on keyboard ===== */
  useEffect(() => {
    const setInitialHeight = () => {
      const h = window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${h}px`);
    };
    setInitialHeight();
    const onOrientation = () => { setTimeout(setInitialHeight, 250); };
    window.addEventListener('orientationchange', onOrientation);
    return () => window.removeEventListener('orientationchange', onOrientation);
  }, []);

  /* Lock scroll while playing / showing a popup */
  useEffect(() => {
    const shouldLock = (started && !gameOver) || showPopup || showRules || showHistory || showFeedback;
    const origHtml = document.documentElement.style.overflow;
    const origBody = document.body.style.overflow;
    if (shouldLock) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = origHtml;
      document.body.style.overflow = origBody;
    };
  }, [started, gameOver, showPopup, showRules, showHistory, showFeedback]);

  /* Load players once */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/data/players.csv');
        const csvText = await res.text();
        const parsed = Papa.parse(csvText, { header: true });
        const rows = parsed.data as RawPlayerRow[];
        const loaded: PlayerPath[] = [];
        rows.forEach((row) => {
          const name = row.name?.trim();
          const pathStr = row.path?.trim();
          const levelStr = row.path_level?.trim();
          if (!name || !pathStr || !levelStr) return;
          const level = parseInt(levelStr, 10);
          if (Number.isNaN(level)) return;
          const path = pathStr.split(',').map((s) => s.trim());
          loaded.push({ name, path, path_level: level });
        });
        if (!cancelled) setPlayers(loaded);
      } catch (e) {
        console.error('❌ Error loading CSV:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* Derived */
  const dailyPaths = useMemo(() => pickDailyPaths(players, gameDate), [players, gameDate]);
  const answerLists = useMemo(() => buildAnswerLists(players, dailyPaths), [players, dailyPaths]);

  /* Init for chosen day */
  useEffect(() => {
    if (!dailyPaths.length) return;

    let g: (Guess | null)[] = Array(dailyPaths.length).fill(null);
    let s = 0;

    if (dateParam) {
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const data = history[gameDate];
      if (data) { g = data.guesses || g; s = data.score || 0; }
      setGuesses(g); setScore(s);

      const any = g.some(Boolean);
      const startedFlag = getStartedFor(gameDate) || any;
      const complete = isComplete(g, dailyPaths.length);

      setStarted(startedFlag);
      setGameOver(complete);
      setShowPopup(complete && !popupDismissed);
      setShowRules(!startedFlag && !complete);
      setRulesOpenedManually(false);

      const firstNull = g.findIndex(x => !x);
      setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);
    } else {
      const raw = localStorage.getItem(LS_GUESSES);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<StoredGuesses>;
          if (parsed.date === gameDate && Array.isArray(parsed.guesses) && parsed.guesses.length === dailyPaths.length) {
            g = parsed.guesses as (Guess | null)[]; s = parsed.score ?? 0;
          }
        } catch {}
      }
      setGuesses(g); setScore(s);

      const any = g.some(Boolean);
      const startedFlag = any || getStartedFor(gameDate);
      setStarted(startedFlag);

      const firstNull = g.findIndex(x => !x);
      setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);

      const complete = isComplete(g, dailyPaths.length);
      setGameOver(complete);
      setShowPopup(complete && !popupDismissed);
      setShowRules(!startedFlag && !complete);
      setRulesOpenedManually(false);
    }

    // restore per-level countdown if present
    let base = Array(dailyPaths.length).fill(MAX_BASE_POINTS);
    const savedBase = localStorage.getItem(LS_BASE_PREFIX + gameDate);
    if (savedBase) {
      try {
        const parsed = JSON.parse(savedBase);
        if (Array.isArray(parsed)) {
          base = base.map((v, i) => {
            const pv = parsed[i];
            return (typeof pv === 'number' && pv >= 0 && pv <= MAX_BASE_POINTS) ? pv : v;
          });
        }
      } catch {}
    }
    setBasePointsLeft(base);

    setRevealedAnswers(Array(dailyPaths.length).fill(false));
    setFilteredSuggestions(Array(dailyPaths.length).fill([]));
    setAwardedPoints(Array(dailyPaths.length).fill(0));
    setPopupDismissed(false);
  }, [dailyPaths, gameDate, dateParam]);

  /* Persist archive (score + guesses) */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    history[gameDate] = { guesses, score };
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    if (!dateParam) {
      const payload: StoredGuesses = { date: gameDate, guesses, score };
      localStorage.setItem(LS_GUESSES, JSON.stringify(payload));
    }
  }, [guesses, score, gameDate, dailyPaths.length, dateParam]);

  /* Persist per-level countdown */
  useEffect(() => {
    if (!dailyPaths.length) return;
    try {
      localStorage.setItem(LS_BASE_PREFIX + gameDate, JSON.stringify(basePointsLeft));
    } catch {}
  }, [basePointsLeft, gameDate, dailyPaths.length]);

  /* Score flash */
  useEffect(() => {
    const el = document.querySelector('.score-number');
    if (!el) return;
    el.classList.add('score-flash');
    const t = window.setTimeout(() => el.classList.remove('score-flash'), 600);
    return () => window.clearTimeout(t);
  }, [score]);

  /* Completion detection that respects feedback hold */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const complete = guesses.length === dailyPaths.length && guesses.every(Boolean);
    if (complete) {
      if (freezeActiveAfterAnswer !== null) return; // wait until hold ends
      setGameOver(true);
      if (!showPopup && !popupDismissed) setShowPopup(true);
    } else {
      if (gameOver) setGameOver(false);
    }
  }, [guesses, dailyPaths.length, freezeActiveAfterAnswer, showPopup, popupDismissed, gameOver]);

  /* Focus input on active card (prevent scroll jump) */
  useEffect(() => {
    if (!started || gameOver) return;
    if (activeLevel >= 0) {
      const el = inputRefs.current[activeLevel];
      if (el && 'focus' in el) {
        try {
          (el as any).focus({ preventScroll: true });
        } catch {
          el.focus();
          window.scrollTo(0, 0);
        }
      }
    }
  }, [activeLevel, started, gameOver]);

  /* Per-level countdown while a level is active and not answered (with 1s initial delay) */
  useEffect(() => {
    if (!started || gameOver) return;
    const idx = activeLevel;
    if (idx < 0 || idx >= dailyPaths.length) return;
    if (guesses[idx]) return;                     // already answered
    if (freezeActiveAfterAnswer !== null) return; // in feedback hold

    // Ensure initial value exists
    setBasePointsLeft(prev => {
      const next = prev.length === dailyPaths.length ? [...prev] : Array(dailyPaths.length).fill(MAX_BASE_POINTS);
      if (next[idx] == null) next[idx] = MAX_BASE_POINTS;
      return next;
    });

    // delay 1s before starting the countdown
    levelDelayRef.current = window.setTimeout(() => {
      levelTimerRef.current = window.setInterval(() => {
        setBasePointsLeft(prev => {
          const next = [...prev];
          const cur = next[idx] ?? MAX_BASE_POINTS;
          next[idx] = Math.max(0, cur - 1);
          return next;
        });
      }, TICK_MS);
    }, 1000);

    return () => {
      if (levelDelayRef.current) {
        window.clearTimeout(levelDelayRef.current);
        levelDelayRef.current = null;
      }
      if (levelTimerRef.current) {
        window.clearInterval(levelTimerRef.current);
        levelTimerRef.current = null;
      }
    };
  }, [activeLevel, started, gameOver, guesses, freezeActiveAfterAnswer, dailyPaths.length]);

  /* Confetti on final popup */
  useEffect(() => {
    if (showPopup && !confettiFired) {
      confetti({ particleCount: 1200, spread: 160, origin: { y: 0.5 } });
      setTimeout(() => confetti({ particleCount: 800, spread: 120, origin: { x: 0.2, y: 0.45 } }), 150);
      setTimeout(() => confetti({ particleCount: 800, spread: 120, origin: { x: 0.8, y: 0.45 } }), 300);
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  /* Helpers */
  const sanitizeImageName = (name: string) => name.trim().replace(/\s+/g, '_');

  const handleInputChange = (index: number, value: string) => {
    const suggestions = players
      .filter((p) => p.name.toLowerCase().includes(value.toLowerCase()))
      .map((p) => p.name)
      .sort()
      .slice(0, 20);
    const updated = [...filteredSuggestions];
    updated[index] = suggestions;
    setFilteredSuggestions(updated);
    setHighlightIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => {
    if (!filteredSuggestions[idx]) return;
    const max = filteredSuggestions[idx].length; if (!max) return;
    if (e.key === 'ArrowDown') { setHighlightIndex((prev) => (prev + 1) % max); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHighlightIndex((prev) => (prev - 1 + max) % max); e.preventDefault(); }
    else if (e.key === 'Enter' && highlightIndex >= 0) { handleGuess(idx, filteredSuggestions[idx][highlightIndex]); }
  };

  const stopLevelTimer = () => {
    if (levelDelayRef.current) {
      window.clearTimeout(levelDelayRef.current);
      levelDelayRef.current = null;
    }
    if (levelTimerRef.current) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
  };

  const startRevealHold = (index: number, then: () => void, holdMs: number) => {
    setFreezeActiveAfterAnswer(index);
    stopLevelTimer(); // stop countdown immediately
    window.setTimeout(() => {
      setFreezeActiveAfterAnswer(null);
      then();
    }, holdMs);
  };

  const advanceToNext = (index: number) => {
    if (index < dailyPaths.length - 1) setActiveLevel(index + 1);
  };

  const handleGuess = (index: number, value: string) => {
    if (guesses[index]) return;
    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(
      (p) => p.name.toLowerCase() === value.toLowerCase() && p.path.join('>') === correctPath
    );

    const updatedGuesses = [...guesses];
    updatedGuesses[index] = { guess: value, correct: !!matched };
    setGuesses(updatedGuesses);

    // compute awarded (remaining base * multiplier) if correct
    const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[index] ?? MAX_BASE_POINTS));
    const multiplier = index + 1;
    const awarded = matched ? baseLeft * multiplier : 0;

    setAwardedPoints(prev => {
      const next = [...prev];
      next[index] = awarded;
      return next;
    });

    if (matched) {
      setScore((prev) => prev + awarded);

      const inputBox = inputRefs.current[index];
      if (inputBox) {
        const rect = inputBox.getBoundingClientRect();
        const x = (rect.left + rect.right) / 2 / window.innerWidth;
        const y = rect.bottom / window.innerHeight;
        confetti({ particleCount: 160, spread: 110, startVelocity: 50, origin: { x, y } });
        confetti({ particleCount: 120, spread: 80, startVelocity: 60, origin: { x: Math.min(0.95, x + 0.08), y } });
      }
    }

    const sugg = [...filteredSuggestions];
    sugg[index] = [];
    setFilteredSuggestions(sugg);

    const willComplete = updatedGuesses.every(Boolean);
    if (willComplete) {
      startRevealHold(index, () => {
        setGameOver(true);
        setShowPopup(true); // final popup opens immediately after hold
      }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, () => advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const handleSkip = (index: number) => {
    if (guesses[index]) return;
    const updated = [...guesses];
    updated[index] = { guess: 'Skipped', correct: false };
    setGuesses(updated);

    // awarded = 0 on skip
    setAwardedPoints(prev => {
      const next = [...prev];
      next[index] = 0;
      return next;
    });

    const sugg = [...filteredSuggestions];
    sugg[index] = [];
    setFilteredSuggestions(sugg);

    const willComplete = updated.every(Boolean);
    if (willComplete) {
      startRevealHold(index, () => {
        setGameOver(true);
        setShowPopup(true);
      }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, () => advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const handleStartGame = () => {
    setStarted(true);
    setStartedFor(gameDate, true);
    setShowRules(false);
    setRulesOpenedManually(false);
    // small delay before first card appears
    setActiveLevel(-1);
    setTimeout(() => {
      setActiveLevel(0);
      setTimeout(() => {
        const el = inputRefs.current[0];
        if (el && 'focus' in el) {
          try { (el as any).focus({ preventScroll: true }); } catch { el.focus(); window.scrollTo(0, 0); }
        }
      }, 120);
    }, 420);
  };

  const getEmojiSummary = () => guesses.map((g) => (g?.correct ? '🟩' : '🟥')).join('');
  const last30Dates = useMemo(() => getLastNDatesET(30), []);

  const appFixed = started && !gameOver && !showPopup ? 'app-fixed' : '';
  const prestartClass = !started ? 'is-prestart' : '';

  return (
    <div className={`app-container ${appFixed} ${gameOver ? 'is-complete' : ''} ${prestartClass}`}>
      <header className="game-header">
        <div className="title-row">
          <img className="game-logo" src="/android-chrome-outline-large-512x512.png" alt="Game Logo" />
          <h1 className="game-title">HELMETS</h1>
        </div>

        <div className="game-subtitle">
          <span>{new Date().toLocaleDateString()}</span>
          <span> | Score: <span className="score-number">{score}</span></span>
        </div>

        <button
          className="rules-button"
          onClick={() => { setRulesOpenedManually(true); setShowRules(true); }}
        >
          Rules
        </button>
      </header>

      {/* Dim only while actively playing a card */}
      {started && !gameOver && !showPopup && <div className="level-backdrop" aria-hidden="true" />}

      {dailyPaths.map((path, idx) => {
        const isDone = !!guesses[idx];
        const isFeedback = freezeActiveAfterAnswer === idx; // in hold
        const isActive = started && !gameOver && ((idx === activeLevel && !isDone) || isFeedback);
        const isCovered = !started || (!isDone && !isActive);

        const blockClass = isDone
          ? (guesses[idx]!.correct ? 'path-block-correct' : 'path-block-incorrect')
          : 'path-block-default';

        let stateClass = 'level-card--locked';
        if (isDone && !isFeedback) stateClass = 'level-card--done';
        else if (isActive) stateClass = 'level-card--active';

        const inputEnabled = isActive && !isDone;

        const multiplier = idx + 1;
        const wonPoints = awardedPoints[idx] || 0;
        const showPointsNow = gameOver; // at game complete show +points
        const badgeText = showPointsNow && isDone ? `+${wonPoints}` : `${multiplier}x Points`;
        const badgeClass =
          showPointsNow && isDone ? (wonPoints > 0 ? 'level-badge won' : 'level-badge zero') : 'level-badge';

        const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[idx] ?? MAX_BASE_POINTS));

        return (
          <div
            key={idx}
            className={`path-block level-card ${blockClass} ${stateClass} ${isCovered ? 'is-covered' : ''}`}
            onClick={() => {
              if (gameOver) {
                const updated = [...revealedAnswers];
                updated[idx] = !updated[idx];
                setRevealedAnswers(updated);
              }
            }}
          >
            {/* Top-left "Level X" tag for the ACTIVE card */}
            {isActive && <div className="level-tag">Level {idx + 1}</div>}

            {/* Multiplier/points badge (moves to top-right on active) */}
            <div className={badgeClass} aria-hidden="true">{badgeText}</div>

            {/* Cover for hidden/unguessed cards */}
            <div className="level-cover" aria-hidden={!isCovered}>
              {/* Hide label before the game starts */}
              {started && <span className="level-cover-label">Level {idx + 1}</span>}
            </div>

            {/* Push content down to avoid overlap with badges */}
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
                        onChange={(e) => inputEnabled && handleInputChange(idx, e.target.value)}
                        onKeyDown={(e) => inputEnabled && handleKeyDown(e, idx)}
                        className="guess-input-field guess-input-mobile font-mobile"
                        disabled={!inputEnabled}
                      />

                      {/* Suggestions */}
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
                                {match >= 0 ? (
                                  <>
                                    {name.slice(0, match)}
                                    <strong>{name.slice(match, match + typed.length)}</strong>
                                    {name.slice(match + typed.length)}
                                  </>
                                ) : name}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Points row + progress bar (CSS-based; width via CSS var) */}
                      {isActive && (
                        <div className="points-wrap">
                          <div className="points-row">
                            <span className="points-label">Points</span>
                            <span className="points-value">{baseLeft}</span>
                          </div>
                          <div className="points-bar">
                            <div
                              className="points-bar-fill"
                              style={{ ['--fill' as any]: `${baseLeft}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Skip button */}
                      {inputEnabled && (
                        <button className="primary-button skip-button" type="button" onClick={() => handleSkip(idx)}>
                          Skip (0 points)
                        </button>
                      )}
                    </>
                  ) : (
                    <div className={`locked-answer ${guesses[idx]!.correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}>
                      {guesses[idx]!.correct ? `✅ ${path.name}` : `❌ ${guesses[idx]!.guess || 'Skipped'}`}
                      {/* Immediate feedback: show awarded points for this level */}
                      <div style={{ marginTop: 6, fontSize: '0.85rem', fontWeight: 700 }}>
                        {`+${awardedPoints[idx] || 0} pts`}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {gameOver && revealedAnswers[idx] && !!answerLists[idx]?.length && (
                <div className="possible-answers">
                  <strong>Possible Answers:</strong>
                  <ul className="possible-answers-list">
                    {answerLists[idx].map((name, i) => (<li key={i}>👤 {name}</li>))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Floating buttons */}
      <button onClick={() => setShowHistory(true)} className="fab-button fab-history">📅 History</button>
      <button onClick={() => setShowFeedback(true)} className="fab-button fab-feedback">💬 Feedback</button>

      {/* History modal */}
      {showHistory && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowHistory(false)}>✖</button>
            <h3>📆 Game History (Last 30 days)</h3>
            <div className="calendar-grid">
              {last30Dates.map((date) => {
                const isToday = date === todayET;
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

      {/* Feedback modal */}
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
              onClick={() => {
                navigator.clipboard.writeText('jerry.helmetsgame@gmail.com');
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="primary-button"
            >
              Copy Email
            </button>
            {copied && <p className="copied-msg">Email copied!</p>}
          </div>
        </div>
      )}

      {/* Rules modal — auto at pre-start (no close), manual = has close */}
      {showRules && (
        <div className="popup-modal fade-in">
          <div className="popup-content popup-rules">
            {rulesOpenedManually && (
              <button className="close-button" onClick={() => { setShowRules(false); setRulesOpenedManually(false); }}>
                ✖
              </button>
            )}
            <h2>WELCOME TO HELMETS!</h2>
            <p><em>Match each helmet path to an NFL player</em></p>
            <h3>HOW TO PLAY</h3>
            <ul className="rules-list football-bullets">
              <li>Guess a player that fits the career path of the helmets</li>
              <li>5 levels, each level gets more difficult</li>
              <li>Only one guess per level</li>
              <li>If you skip a level, it will mark the level as incorrect and award 0 points</li>
              <li>Each level is worth 100 points but you lose points as time passes so BE QUICK!</li>
              <li>Each level has a points multiplier (Level 1 = 1x points, Level 5 = 5x points)</li>
              <li>All active or retired NFL players drafted in 2000 or later are eligible</li>
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

      {/* Complete banner */}
      {gameOver && (
        <div className="complete-banner">
          <h3>🎯 Game Complete</h3>
          <p>Tap each box to view possible answers</p>
        </div>
      )}

      {/* Final popup */}
      {showPopup && (
        <div className="popup-modal fade-in">
          <div className="popup-content popup-final">
            <button
              className="close-button"
              onClick={() => { setShowPopup(false); setPopupDismissed(true); }}
            >
              ✖
            </button>
            <h3>🎉 Game Complete!</h3>
            <p>You scored {score} pts</p>
            <p>{getEmojiSummary()}</p>
            <button
              onClick={() => {
                const correctCount = guesses.filter((g) => g && g.correct).length;
                const shareMsg = `🏈 Helmets Game – ${shareDateMMDDYY}\n\nScore: ${score}\n${correctCount}/5\n\n${getEmojiSummary()}\n\nwww.helmets-game.com`;
                if (navigator.share) {
                  navigator.share({ title: 'Helmets Game', text: `${shareMsg}` })
                    .catch(() => navigator.clipboard.writeText(shareMsg));
                } else {
                  navigator.clipboard.writeText(shareMsg);
                  alert('Score copied!');
                }
              }}
              className="primary-button"
            >
              Share Score!
            </button>
            <div className="popup-footer">
              <button
                onClick={() => { setShowPopup(false); setPopupDismissed(true); setShowHistory(true); }}
                className="previous-day-games"
              >
                Play previous day's games
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameComponent;
