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
  timer: number;
};

const LS_GUESSES = 'helmets-guesses';
const LS_HISTORY = 'helmets-history';
const LS_TIMER = 'helmets-timer';
const LS_LAST_PLAYED = 'lastPlayedDateET';
const LS_STARTED = 'helmets-started';

/** Hold time for immediate feedback before advancing */
const REVEAL_HOLD_MS = 2000;
/** Keep final level visible (green/red) a bit longer before Game Complete */
const FINAL_REVEAL_HOLD_MS = 1200;

/* ---------- Eastern Time helpers ---------- */
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

/* ---------- Daily selection ---------- */
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

/* ---------- started flags per day ---------- */
function getStartedMap() {
  try { return JSON.parse(localStorage.getItem(LS_STARTED) || '{}'); } catch { return {}; }
}
function setStartedFor(date: string, v: boolean) {
  const m = getStartedMap(); m[date] = v; localStorage.setItem(LS_STARTED, JSON.stringify(m));
}
function getStartedFor(date: string) { const m = getStartedMap(); return !!m[date]; }

const GameComponent: React.FC = () => {
 // Date setup (ET) 
const params = new URLSearchParams(
  typeof window !== 'undefined' ? window.location.search : ''
);
const dateParam = params.get('date'); // YYYY-MM-DD or null
const todayET = todayETISO();
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
  const [timer, setTimer] = useState(() => {
    const stored = localStorage.getItem(LS_TIMER);
    return stored ? parseInt(stored, 10) : 0;
  });
  const [started, setStarted] = useState<boolean>(() => getStartedFor(gameDate));
  const [activeLevel, setActiveLevel] = useState<number>(0);
  const [showRules, setShowRules] = useState<boolean>(false);
  const [rulesOpenedManually, setRulesOpenedManually] = useState<boolean>(false);

  // Hold the answered card on screen briefly (green/red) before moving on
  const [freezeActiveAfterAnswer, setFreezeActiveAfterAnswer] = useState<number | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const timerRef = useRef<number | null>(null);

  /* --------- MOBILE VIEWPORT LOCK --------- */
  useEffect(() => {
    const setInitialHeight = () => {
      const h = window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${h}px`);
    };
    setInitialHeight();
    const onOrientation = () => { setTimeout(setInitialHeight, 250); };
    window.addEventListener('orientationchange', onOrientation);
    return () => { window.removeEventListener('orientationchange', onOrientation); };
  }, []);

  /* Lock/unlock page scroll while playing or when any popup is open */
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

  /* Init (hydrate for chosen gameDate) */
  useEffect(() => {
    if (!dailyPaths.length) return;

    let g: (Guess | null)[] = Array(dailyPaths.length).fill(null);
    let s = 0; let t = 0;

    if (dateParam) {
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const data = history[gameDate];
      if (data) { g = data.guesses || g; s = data.score || 0; t = data.timer || 0; }
      setGuesses(g); setScore(s); setTimer(t);

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
            g = parsed.guesses as (Guess | null)[]; s = parsed.score ?? 0; t = parsed.timer ?? 0;
          }
        } catch {}
      }
      setGuesses(g); setScore(s); setTimer(t);

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

    setRevealedAnswers(Array(dailyPaths.length).fill(false));
    setFilteredSuggestions(Array(dailyPaths.length).fill([]));
    setPopupDismissed(false); // reset per day navigation
  }, [dailyPaths, gameDate, dateParam]);

  /* Per-day (ET) timer reset for today only */
  useEffect(() => {
    if (dateParam) return;
    const lastET = localStorage.getItem(LS_LAST_PLAYED);
    if (lastET !== todayET) {
      localStorage.setItem(LS_LAST_PLAYED, todayET);
      localStorage.removeItem(LS_TIMER);
    }
  }, [todayET, dateParam]);

  /* Persist archive */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    history[gameDate] = { guesses, score, timer };
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    if (!dateParam) {
      const payload: StoredGuesses = { date: gameDate, guesses, score, timer };
      localStorage.setItem(LS_GUESSES, JSON.stringify(payload));
    }
  }, [guesses, score, timer, gameDate, dailyPaths.length, dateParam]);

  /* Score flash (only the number) */
  useEffect(() => {
    const el = document.querySelector('.score-number');
    if (!el) return;
    el.classList.add('score-flash');
    const t = window.setTimeout(() => el.classList.remove('score-flash'), 600);
    return () => window.clearTimeout(t);
  }, [score]);

  /* Timer */
  useEffect(() => {
    if (!showPopup && !dateParam) {
      timerRef.current = window.setInterval(() => {
        setTimer((prev) => {
          const next = prev + 1;
          localStorage.setItem(LS_TIMER, String(next));
          return next;
        });
      }, 1000);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); timerRef.current = null; };
  }, [showPopup, dateParam]);

  /* Completion detection (respect reveal hold) */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const complete = isComplete(guesses, dailyPaths.length);
    setGameOver(complete);
    if (complete && !showPopup && !popupDismissed) {
      if (freezeActiveAfterAnswer === null) setShowPopup(true);
    }
  }, [guesses, dailyPaths.length, freezeActiveAfterAnswer, showPopup, popupDismissed]);

  /* Focus on active input */
  useEffect(() => {
    if (!started || gameOver) return;
    const el = inputRefs.current[activeLevel];
    if (el) el.focus();
  }, [activeLevel, started, gameOver]);

  /* Confetti when final popup appears */
  useEffect(() => {
    if (showPopup && !confettiFired) {
      confetti({ particleCount: 875, spread: 145, origin: { y: 0.5 } });
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  /* Handlers */
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

  const startRevealHold = (index: number, then: () => void, holdMs: number) => {
    setFreezeActiveAfterAnswer(index);
    window.setTimeout(() => {
      setFreezeActiveAfterAnswer(null);
      then();
    }, holdMs);
  };

  const advanceToNext = (index: number) => {
    if (index < dailyPaths.length - 1) setActiveLevel(index + 1);
  };

  const handleGuess = (index: number, value: string) => {
    if (guesses[index]) return; // locked
    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(
      (p) => p.name.toLowerCase() === value.toLowerCase() && p.path.join('>') === correctPath
    );

    const updatedGuesses = [...guesses];
    updatedGuesses[index] = { guess: value, correct: !!matched };
    setGuesses(updatedGuesses);

    if (matched) {
      const level = index + 1;
      const points = 100 * level;
      setScore((prev) => prev + points);
      const inputBox = inputRefs.current[index];
      if (inputBox) {
        const rect = inputBox.getBoundingClientRect();
        confetti({
          particleCount: 80, spread: 100,
          origin: { x: (rect.left + rect.right) / 2 / window.innerWidth, y: rect.bottom / window.innerHeight },
        });
      }
    }

    const upd = [...filteredSuggestions];
    upd[index] = [];
    setFilteredSuggestions(upd);

    const willComplete = updatedGuesses.every(Boolean);
    if (willComplete) {
      // Keep the last card visible briefly (green/red), then show popup
      startRevealHold(index, () => setShowPopup(true), FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, () => advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const handleSkip = (index: number) => {
    if (guesses[index]) return;
    const updated = [...guesses];
    updated[index] = { guess: 'Skipped', correct: false };
    setGuesses(updated);

    const sugg = [...filteredSuggestions];
    sugg[index] = [];
    setFilteredSuggestions(sugg);

    const willComplete = updated.every(Boolean);
    if (willComplete) {
      startRevealHold(index, () => setShowPopup(true), FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, () => advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const handleStartGame = () => {
    setStarted(true);
    setStartedFor(gameDate, true);
    setShowRules(false);
    setRulesOpenedManually(false);
    setActiveLevel(0);
    setTimeout(() => inputRefs.current[0]?.focus(), 120);
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
          <span> | Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</span>
        </div>

        <button
          className="rules-button"
          onClick={() => { setRulesOpenedManually(true); setShowRules(true); }}
        >
          Rules
        </button>
      </header>

      {/* Dim only when playing (a level active) */}
      {started && !gameOver && !showPopup && <div className="level-backdrop" aria-hidden="true" />}

      {dailyPaths.map((path, idx) => {
        const isDone = !!guesses[idx];
        const isActive = started && !gameOver && ((idx === activeLevel && !isDone) || idx === freezeActiveAfterAnswer);
        const isCovered = !started || (!isDone && !isActive); // pre-start: covered

        const blockClass = isDone
          ? (guesses[idx]!.correct ? 'path-block-correct' : 'path-block-incorrect')
          : 'path-block-default';

        let stateClass = 'level-card--locked';
        if (isDone && idx !== freezeActiveAfterAnswer) stateClass = 'level-card--done';
        else if (isActive) stateClass = 'level-card--active';

        const inputEnabled = isActive && !isDone;

        const multiplier = idx + 1;
        const wonPoints = isDone && guesses[idx]!.correct ? 100 * multiplier : 0;
        const showPointsNow = gameOver; // show +points at end
        const badgeText = showPointsNow && isDone ? `+${wonPoints}` : `${multiplier}x Points`;
        const badgeClass =
          showPointsNow && isDone ? (wonPoints > 0 ? 'level-badge won' : 'level-badge none') : 'level-badge';

        const sanitizeImageName = (name: string) => name.trim().replace(/\s+/g, '_');

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
            <div className={badgeClass} aria-hidden="true">{badgeText}</div>

            <div className="level-cover" aria-hidden={!isCovered}>
              <span className="level-cover-label">Level {idx + 1}</span>
            </div>

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
                    {inputEnabled && (
                      <button className="primary-button skip-button" type="button" onClick={() => handleSkip(idx)}>
                        Skip (0 points)
                      </button>
                    )}
                  </>
                ) : (
                  <div className={`locked-answer ${guesses[idx]!.correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}>
                    {guesses[idx]!.correct ? `✅ ${path.name}` : `❌ ${guesses[idx]!.guess || 'Skipped'}`}
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
          <div className="popup-content">
            {rulesOpenedManually && (
              <button className="close-button" onClick={() => { setShowRules(false); setRulesOpenedManually(false); }}>✖</button>
            )}
            <h2>WELCOME TO HELMETS!</h2>
            <p><em>Match each helmet path to an NFL player</em></p>
            <h3>HOW TO PLAY</h3>
            <ul className="rules-list">
              <li>🏈 You’ll solve 5 levels, one at a time.</li>
              <li>🏈 Each level shows a college, then NFL teams in order.</li>
              <li>🏈 One guess per level. Multiple players may share a path.</li>
              <li>🏈 Points are 100 × level (1–5).</li>
              <li>🏈 You can Skip a level for 0 points.</li>
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
            <p>Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</p>
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
