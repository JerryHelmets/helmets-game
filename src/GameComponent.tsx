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
const LS_LAST_PLAYED = 'lastPlayedDate';
const LS_STARTED = 'helmets-started'; // per-day start flag map

const todayISO = () => new Date().toISOString().split('T')[0];

function seededRandom(seed: number) {
  return function () {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
}

function pickDailyPaths(players: PlayerPath[], date: string): PlayerPath[] {
  const seed = parseInt(date.split('-').join(''), 10);
  const rng = seededRandom(seed);
  const buckets: Record<number, Map<string, PlayerPath>> = { 1:new Map(),2:new Map(),3:new Map(),4:new Map(),5:new Map() };
  players.forEach(p => {
    if (p.path_level >= 1 && p.path_level <= 5) {
      const key = p.path.join('>');
      if (!buckets[p.path_level].has(key)) buckets[p.path_level].set(key, p);
    }
  });
  const selected: PlayerPath[] = [];
  for (let lvl=1; lvl<=5; lvl++) {
    const arr = Array.from(buckets[lvl].values());
    if (arr.length) selected.push(arr[Math.floor(rng()*arr.length)]);
  }
  return selected;
}
function buildAnswerLists(players: PlayerPath[], targets: PlayerPath[]) {
  return targets.map(t =>
    players.filter(p => p.path.join('>') === t.path.join('>')).map(p => p.name).sort()
  );
}
const isComplete = (guesses: (Guess | null)[], total: number) =>
  guesses.length === total && guesses.every(Boolean);

function getStartedMap() {
  try { return JSON.parse(localStorage.getItem(LS_STARTED) || '{}'); } catch { return {}; }
}
function setStartedFor(date: string, v: boolean) {
  const m = getStartedMap(); m[date] = v; localStorage.setItem(LS_STARTED, JSON.stringify(m));
}
function getStartedFor(date: string) {
  const m = getStartedMap(); return !!m[date];
}

const GameComponent: React.FC = () => {
  // --- state ---
  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess | null)[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [score, setScore] = useState<number>(0);
  const [showPopup, setShowPopup] = useState<boolean>(false);
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

  const urlParams = new URLSearchParams(window.location.search);
  const dateParam = urlParams.get('date');
  const [customDate] = useState(dateParam); // history mode if set

  const today = todayISO();
  const formattedDate = `${new Date().getMonth()+1}/${new Date().getDate()}/${String(new Date().getFullYear()).slice(-2)}`;

  // one-by-one flow
  const [started, setStarted] = useState<boolean>(() => getStartedFor(today));
  const [activeLevel, setActiveLevel] = useState<number>(0);
  const [showRules, setShowRules] = useState<boolean>(false); // shown if not started today

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const timerRef = useRef<number | null>(null);

  // load players once
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
          const path = pathStr.split(',').map(s => s.trim());
          loaded.push({ name, path, path_level: level });
        });
        if (!cancelled) setPlayers(loaded);
      } catch (e) { console.error('❌ Error loading CSV:', e); }
    })();
    return () => { cancelled = true; };
  }, []);

  // derived
  const dailyPaths = useMemo(() => pickDailyPaths(players, today), [players, today]);
  const answerLists = useMemo(() => buildAnswerLists(players, dailyPaths), [players, dailyPaths]);

  // hydrate/init (and decide onboarding & popup)
  useEffect(() => {
    if (!dailyPaths.length) return;

    let g: (Guess | null)[] = Array(dailyPaths.length).fill(null);
    let s = 0; let t = 0;

    if (customDate) {
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const data = history[customDate];
      if (data) { g = data.guesses || g; s = data.score || 0; t = data.timer || 0; }
      setGuesses(g); setScore(s); setTimer(t);
      setShowPopup(true); setGameOver(true);
      setStarted(true); setActiveLevel(dailyPaths.length - 1);
    } else {
      const raw = localStorage.getItem(LS_GUESSES);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Partial<StoredGuesses>;
          if (parsed.date === today && Array.isArray(parsed.guesses) && parsed.guesses.length === dailyPaths.length) {
            g = parsed.guesses as (Guess | null)[]; s = parsed.score ?? 0; t = parsed.timer ?? 0;
          }
        } catch {}
      }
      setGuesses(g); setScore(s); setTimer(t);

      const any = g.some(Boolean);
      const startedFlag = any || getStartedFor(today);
      setStarted(startedFlag);
      // first null for active, else last
      const firstNull = g.findIndex(x => !x);
      setActiveLevel(firstNull === -1 ? dailyPaths.length - 1 : firstNull);

      const complete = isComplete(g, dailyPaths.length);
      setGameOver(complete);
      setShowPopup(complete);           // show on refresh if completed
      setShowRules(!startedFlag && !complete); // show rules if not started and not complete
    }

    setRevealedAnswers(Array(dailyPaths.length).fill(false));
    setFilteredSuggestions(Array(dailyPaths.length).fill([]));
  }, [dailyPaths, today, customDate]);

  // per-day reset
  useEffect(() => {
    const todayHuman = new Date().toLocaleDateString();
    const last = localStorage.getItem(LS_LAST_PLAYED);
    if (last !== todayHuman) {
      localStorage.setItem(LS_LAST_PLAYED, todayHuman);
      localStorage.removeItem(LS_TIMER);
    }
  }, []);

  // persist
  useEffect(() => {
    if (!dailyPaths.length || customDate) return;
    const payload: StoredGuesses = { date: today, guesses, score, timer };
    localStorage.setItem(LS_GUESSES, JSON.stringify(payload));
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    history[today] = { guesses, score, timer };
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
  }, [guesses, score, timer, today, dailyPaths.length, customDate]);

  // score pulse
  useEffect(() => {
    const el = document.querySelector('.score-value'); if (!el) return;
    el.classList.add('pulse'); const t = window.setTimeout(() => el.classList.remove('pulse'), 300);
    return () => window.clearTimeout(t);
  }, [score]);

  // timer
  useEffect(() => {
    if (!showPopup && !customDate) {
      timerRef.current = window.setInterval(() => {
        setTimer(prev => {
          const next = prev + 1;
          localStorage.setItem(LS_TIMER, String(next));
          return next;
        });
      }, 1000);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current); timerRef.current = null;
    }
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); timerRef.current = null; };
  }, [showPopup, customDate]);

  // completion during play
  useEffect(() => {
    if (!dailyPaths.length || customDate) return;
    if (isComplete(guesses, dailyPaths.length)) {
      setGameOver(true);
      setShowPopup(true);
    }
  }, [guesses, dailyPaths.length, customDate]);

  // focus active input when switching
  useEffect(() => {
    if (!started || gameOver || customDate) return;
    const el = inputRefs.current[activeLevel];
    if (el) el.focus();
  }, [activeLevel, started, gameOver, customDate]);

  // confetti
  useEffect(() => {
    if (showPopup && !confettiFired) {
      confetti({ particleCount: 875, spread: 145, origin: { y: 0.5 } });
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  // handlers
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
    if (e.key === 'ArrowDown') { setHighlightIndex(prev => (prev + 1) % max); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setHighlightIndex(prev => (prev - 1 + max) % max); e.preventDefault(); }
    else if (e.key === 'Enter' && highlightIndex >= 0) { handleGuess(idx, filteredSuggestions[idx][highlightIndex]); }
  };

  const handleGuess = (index: number, value: string) => {
    if (guesses[index]) return; // locked
    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(p => p.name.toLowerCase() === value.toLowerCase() && p.path.join('>') === correctPath);

    const updatedGuesses = [...guesses];
    updatedGuesses[index] = { guess: value, correct: !!matched };
    setGuesses(updatedGuesses);

    if (matched) {
      const level = dailyPaths[index].path_level;
      const points = 100 * level;
      setScore(prev => prev + points);
      const inputBox = inputRefs.current[index];
      if (inputBox) {
        const rect = inputBox.getBoundingClientRect();
        confetti({
          particleCount: 80, spread: 100,
          origin: { x: (rect.left + rect.right) / 2 / window.innerWidth, y: rect.bottom / window.innerHeight }
        });
      }
    }

    // move to next level after short beat
    if (index < dailyPaths.length - 1) {
      setTimeout(() => setActiveLevel(index + 1), 250);
    }
  };

  const handleGiveUp = () => {
    const updated = guesses.map(g => g ?? ({ guess: '', correct: false }));
    setGuesses(updated);
    setShowPopup(true);
    setGameOver(true);
  };

  const handleStartGame = () => {
    setStarted(true);
    setStartedFor(today, true);
    setShowRules(false);
    setActiveLevel(0);
    setTimeout(() => inputRefs.current[0]?.focus(), 100);
  };

  const getEmojiSummary = () => guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('');

  // --- render ---
  return (
    <div className="app-container">
      <header className="game-header">
        <div className="title-row">
          <img className="game-logo" src="/android-chrome-outline-large-512x512.png" alt="Game Logo" />
          <h1 className="game-title">HELMETS</h1>
        </div>

        <div className="game-subtitle">
          <span>{new Date().toLocaleDateString()}</span>
          <span className="score-value"> | Score: {score}</span>
          <span> | Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</span>
        </div>

        <button className="rules-button" onClick={() => setShowRules(true)}>Rules</button>
      </header>

      {dailyPaths.map((path, idx) => {
        const blockClass =
          guesses[idx] ? (guesses[idx]!.correct ? 'path-block-correct' : 'path-block-incorrect') : 'path-block-default';

        // card state for one-by-one flow
        let stateClass = 'level-card--locked';
        if (guesses[idx]) stateClass = 'level-card--done';
        else if (started && !gameOver && idx === activeLevel) stateClass = 'level-card--active';

        const inputEnabled = started && !gameOver && idx === activeLevel && !guesses[idx];

        return (
          <div
            key={idx}
            className={`path-block level-card ${blockClass} ${stateClass}`}
            onClick={() => {
              // during completed mode, allow toggling possible answers
              if (gameOver) {
                const updated = [...revealedAnswers];
                updated[idx] = !updated[idx];
                setRevealedAnswers(updated);
              }
            }}
          >
            <div className="helmet-sequence">
              {path.path.map((team, i) => (
                <React.Fragment key={i}>
                  <img
                    src={`/images/${sanitizeImageName(team)}.png`}
                    alt={team}
                    className="helmet-img-responsive helmet-img-scale helmet-img-mobile font-mobile helmet-img-fixed helmet-img-mobile-lg"
                  />
                  {i < path.path.length - 1 && (
                    <span className="arrow helmet-arrow helmet-arrow-mobile font-mobile">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>

            <div className="guess-input-container">
              <div className={`guess-input ${guesses[idx] ? (guesses[idx]!.correct ? 'correct' : 'incorrect') : ''}`}>
                {!guesses[idx] ? (
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
                ) : (
                  <div
                    className={`locked-answer ${guesses[idx]!.correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}
                  >
                    {guesses[idx]!.correct ? `✅ ${path.name}` : `❌ ${guesses[idx]!.guess}`}
                  </div>
                )}

                {!guesses[idx] && inputEnabled && filteredSuggestions[idx]?.length > 0 && (
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
              </div>
            </div>

            {gameOver && revealedAnswers[idx] && !!answerLists[idx]?.length && (
              <div className="possible-answers">
                <strong>Possible Answers:</strong>
                <ul className="possible-answers-list">
                  {answerLists[idx].map((name, i) => (
                    <li key={i}>👤 {name}</li>
                  ))}
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
            <h3>📆 Game History</h3>
            <div className="calendar-grid">
              {Object.entries(JSON.parse(localStorage.getItem(LS_HISTORY) || '{}')).map(([date]) => (
                <button
                  key={date}
                  className="calendar-grid-button"
                  onClick={() => (window.location.href = `/?date=${date}`)}
                >
                  {String(date).slice(5)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="center-cta">
        <button onClick={handleGiveUp} className="giveup-button">Give Up</button>
      </div>

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
              className="copy-email-button"
            >
              Copy Email
            </button>
            {copied && <p className="copied-msg">Email copied!</p>}
          </div>
        </div>
      )}

      {/* Rules modal — shown if not started & not completed */}
      {showRules && !customDate && (
        <div className="popup-modal fade-in">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowRules(false)}>✖</button>
            <h2>WELCOME TO HELMETS!</h2>
            <p><em>Match each helmet path to an NFL player</em></p>
            <h3>HOW TO PLAY</h3>
            <ul className="rules-list">
              <li>🏈 You’ll solve 5 levels, one at a time.</li>
              <li>🏈 Each level shows a college, then NFL teams in order.</li>
              <li>🏈 One guess per level. Multiple players may share a path.</li>
              <li>🏈 Points are 100 × level (1–5).</li>
            </ul>
            <button onClick={handleStartGame} className="share-score-button" style={{ marginTop: 12 }}>
              Start Game!
            </button>
          </div>
        </div>
      )}

      {/* Game complete banner */}
      {gameOver && (
        <div className="complete-banner">
          <h3>🎯 Game Complete</h3>
          <p>Tap each box to view possible answers</p>
        </div>
      )}

      {/* Final popup — always appears when complete (incl. refresh) */}
      {showPopup && (
        <div className="popup-modal fade-in">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowPopup(false)}>✖</button>
            <h3>🎉 Game Complete!</h3>
            <p>You scored {score} pts</p>
            <p>Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</p>
            <p>{getEmojiSummary()}</p>
            <button
              onClick={() => {
                const correctCount = guesses.filter((g) => g && g.correct).length;
                const shareMsg = `🏈 Helmets Game – ${formattedDate}\n\nScore: ${score}\n${correctCount}/5\n\n${getEmojiSummary()}\n\nwww.helmets-game.com`;
                if (navigator.share) {
                  navigator.share({ title: 'Helmets Game', text: `${shareMsg}` })
                    .catch(() => navigator.clipboard.writeText(shareMsg));
                } else {
                  navigator.clipboard.writeText(shareMsg);
                  alert('Score copied!');
                }
              }}
              className="share-score-button"
            >
              Share Score!
            </button>
            <div className="popup-footer">
              <button
                onClick={() => { setShowPopup(false); setShowHistory(true); }}
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
