import React, { useEffect, useRef, useState } from 'react';
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
const LS_RULES = 'rulesShown';
const LS_LAST_PLAYED = 'lastPlayedDate';

function seededRandom(seed: number) {
  return function () {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
}

const GameComponent: React.FC = () => {
  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [dailyPaths, setDailyPaths] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess | null)[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
  const [focusedInput, setFocusedInput] = useState<number | null>(null);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const today = new Date();
  const formattedDate = `${today.getMonth() + 1}/${today.getDate()}/${String(today.getFullYear()).slice(-2)}`;
  const [score, setScore] = useState<number>(0);
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const urlParams = new URLSearchParams(window.location.search);
  const dateParam = urlParams.get('date');
  const [customDate, setCustomDate] = useState(dateParam);
  const [showHistory, setShowHistory] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);
  const [answerLists, setAnswerLists] = useState<string[][]>([]);
  const [gameOver, setGameOver] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [confettiFired, setConfettiFired] = useState(false);
  const [showRules, setShowRules] = useState(() => {
    return localStorage.getItem(LS_RULES) !== 'true';
  });
  const [timer, setTimer] = useState(() => {
    const stored = localStorage.getItem(LS_TIMER);
    return stored ? parseInt(stored, 10) : 0;
  });
  const timerRef = useRef<number | null>(null);

  // Load history if viewing a custom date
  useEffect(() => {
    if (!customDate) return;
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    const data = history[customDate];
    if (data) {
      setGuesses(data.guesses || []);
      setScore(data.score || 0);
      setTimer(data.timer || 0);
      setShowPopup(true);
    }
  }, [customDate]);

  // Load players & choose daily paths
  useEffect(() => {
    fetch('/data/players.csv')
      .then((response) => response.text())
      .then((csvText) => {
        const parsed = Papa.parse(csvText, { header: true });
        const rows = parsed.data as RawPlayerRow[];

        const playerData: PlayerPath[] = [];

        rows.forEach((row, i) => {
          const name = row.name?.trim();
          const pathStr = row.path?.trim();
          const levelStr = row.path_level?.trim();

          if (!name || !pathStr || !levelStr) {
            console.warn(`⚠️ Row ${i} is missing required fields:`, row);
            return;
          }

          const level = parseInt(levelStr, 10);
          if (isNaN(level)) {
            console.warn(`⚠️ Row ${i} has invalid 'path_level': "${levelStr}"`);
            return;
          }

          const path = pathStr.split(',').map((x) => x.trim());
          playerData.push({ name, path, path_level: level });
        });

        setPlayers(playerData);

        // Daily selection
        const todayKey = new Date().toISOString().slice(0, 10);
        const seed = parseInt(todayKey.split('-').join(''), 10);
        const rng = seededRandom(seed);

        const uniquePathsByLevel: { [level: number]: Map<string, PlayerPath> } = {};
        for (let i = 1; i <= 5; i++) uniquePathsByLevel[i] = new Map();

        playerData.forEach((p) => {
          const key = p.path.join('>');
          if (p.path_level >= 1 && p.path_level <= 5 && !uniquePathsByLevel[p.path_level].has(key)) {
            uniquePathsByLevel[p.path_level].set(key, p);
          }
        });

        const selected: PlayerPath[] = [];
        for (let level = 1; level <= 5; level++) {
          const values = Array.from(uniquePathsByLevel[level].values());
          if (values.length > 0) {
            const index = Math.floor(rng() * values.length);
            selected.push(values[index]);
          }
        }

        setDailyPaths(selected);
        setFilteredSuggestions(Array(selected.length).fill([]));
      })
      .catch((error) => console.error('❌ Error loading CSV:', error));
  }, []);

  // Build answer lists and reset guess scaffolding when dailyPaths or players change
  useEffect(() => {
    setGuesses(Array(dailyPaths.length).fill(null));
    setRevealedAnswers(Array(dailyPaths.length).fill(false));

    const allAnswers = dailyPaths.map((targetPath) => {
      const match = players
        .filter((p) => p.path.join('>') === targetPath.path.join('>'))
        .map((p) => p.name)
        .sort();
      return match;
    });

    setAnswerLists(allAnswers);
  }, [dailyPaths, players]);

  // On first mount (or dailyPaths update), restore today's state if it exists, else init storage
  useEffect(() => {
    if (!dailyPaths.length) return;

    const todayISO = new Date().toISOString().split('T')[0];
    const raw = localStorage.getItem(LS_GUESSES);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StoredGuesses>;
        if (parsed.date === todayISO && Array.isArray(parsed.guesses) && parsed.guesses.length === dailyPaths.length) {
          setGuesses(parsed.guesses as (Guess | null)[]);
          setScore(parsed.score ?? 0);
          setTimer(parsed.timer ?? 0);
          return;
        }
      } catch {
        // fall through to init
      }
    }

    const initial: StoredGuesses = {
      date: todayISO,
      guesses: Array(dailyPaths.length).fill(null),
      score: 0,
      timer: 0,
    };
    setGuesses(initial.guesses);
    setScore(initial.score);
    setTimer(initial.timer);
    localStorage.setItem(LS_GUESSES, JSON.stringify(initial));
  }, [dailyPaths]);

  // Pulse the score when it changes
  useEffect(() => {
    const scoreEl = document.querySelector('.score-value');
    if (scoreEl) {
      scoreEl.classList.add('pulse');
      const t = window.setTimeout(() => scoreEl.classList.remove('pulse'), 300);
      return () => window.clearTimeout(t);
    }
  }, [score]);

  // Persist guesses/score/timer and update per-day history whenever guesses change
  useEffect(() => {
    const todayISO = new Date().toISOString().split('T')[0];

    const payload: StoredGuesses = {
      date: todayISO,
      guesses,
      score,
      timer,
    };
    localStorage.setItem(LS_GUESSES, JSON.stringify(payload));

    const fullHistory = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    fullHistory[todayISO] = { guesses, score, timer };
    localStorage.setItem(LS_HISTORY, JSON.stringify(fullHistory));
  }, [guesses, score, timer]);

  // Reset per day
  useEffect(() => {
    const todayStr = new Date().toLocaleDateString();
    const lastPlayed = localStorage.getItem(LS_LAST_PLAYED);
    if (lastPlayed !== todayStr) {
      localStorage.setItem(LS_LAST_PLAYED, todayStr);
      // Clear old per-day items
      localStorage.removeItem(LS_TIMER);
      // Leave history intact; guesses will be reinitialized in the dailyPaths effect above
    }
  }, []);

  // Timer start/stop
  useEffect(() => {
    if (!showPopup) {
      timerRef.current = window.setInterval(() => {
        setTimer((prev) => {
          const updated = prev + 1;
          localStorage.setItem(LS_TIMER, updated.toString());
          return updated;
        });
      }, 1000);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
    };
  }, [showPopup]);

  // Fire big confetti once when popup opens
  useEffect(() => {
    if (showPopup && !confettiFired) {
      confetti({ particleCount: 875, spread: 145, origin: { y: 0.5 } });
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  // Persist rulesShown
  useEffect(() => {
    if (showRules) return;
    localStorage.setItem(LS_RULES, 'true');
  }, [showRules]);

  // Game over condition
  useEffect(() => {
    const hasAny = guesses.some((g) => g);
    const allAnswered = guesses.length === dailyPaths.length && guesses.every((g) => g);
    if (hasAny && allAnswered) {
      setShowPopup(true);
      setGameOver(true);
    }
  }, [guesses, dailyPaths.length]);

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
    const max = filteredSuggestions[idx].length;

    if (e.key === 'ArrowDown') {
      setHighlightIndex((prev) => (prev + 1) % max);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setHighlightIndex((prev) => (prev - 1 + max) % max);
      e.preventDefault();
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      handleGuess(idx, filteredSuggestions[idx][highlightIndex]);
    }
  };

  const handleGuess = (index: number, value: string) => {
    if (guesses[index]) return; // already locked

    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(
      (p) => p.name.toLowerCase() === value.toLowerCase() && p.path.join('>') === correctPath
    );

    const updatedGuesses = [...guesses];
    updatedGuesses[index] = { guess: value, correct: !!matched };
    setGuesses(updatedGuesses);

    if (matched) {
      const level = dailyPaths[index].path_level;
      const points = 100 * level;
      setScore((prev) => prev + points);

      const inputBox = inputRefs.current[index];
      if (inputBox) {
        const rect = inputBox.getBoundingClientRect();
        confetti({
          particleCount: 80,
          spread: 100,
          origin: {
            x: (rect.left + rect.right) / 2 / window.innerWidth,
            y: rect.bottom / window.innerHeight,
          },
        });
      }
    }

    const updatedSuggestions = [...filteredSuggestions];
    updatedSuggestions[index] = [];
    setFilteredSuggestions(updatedSuggestions);
  };

  const handleGiveUp = () => {
    const updated = guesses.map((g) => g ?? { guess: '', correct: false });
    setGuesses(updated);
    setShowPopup(true);
    setGameOver(true);
  };

  const getEmojiSummary = () => guesses.map((g) => (g?.correct ? '🟩' : '🟥')).join('');

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
  const blockClass = guesses[idx]
    ? (guesses[idx]!.correct ? 'path-block-correct' : 'path-block-incorrect')
    : 'path-block-default';

  return (
    <div
      key={idx}
      className={`path-block ${blockClass}`}
      onClick={() => {
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
            {i < path.path.length - 1 && <span className="arrow helmet-arrow helmet-arrow-mobile font-mobile">→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="guess-input-container">
        <div className={`guess-input ${guesses[idx] ? (guesses[idx]!.correct ? 'correct' : 'incorrect') : ''}`}>
          {!guesses[idx] ? (
            <input
              ref={(el) => (inputRefs.current[idx] = el)}
              type="text"
              placeholder="Guess Player"
              inputMode="text"
              onFocus={() => setFocusedInput(idx)}
              onBlur={() => {
                const active = document.activeElement as HTMLElement | null;
                if (active) active.blur();
              }}
              onChange={(e) => handleInputChange(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              className="guess-input-field guess-input-mobile font-mobile"
            />
          ) : (
            <div
              className={`locked-answer ${guesses[idx]!.correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}
            >
              {guesses[idx]!.correct ? `✅ ${path.name}` : `❌ ${guesses[idx]!.guess}`}
            </div>
          )}

          {!guesses[idx] && filteredSuggestions[idx]?.length > 0 && (
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

<button onClick={() => setShowHistory(true)} className="fab-button fab-history">📅 History</button>
<button onClick={() => setShowFeedback(true)} className="fab-button fab-feedback">💬 Feedback</button>

{showHistory && (
  <div className="popup-modal">
    <div className="popup-content">
      <button className="close-button" onClick={() => setShowHistory(false)}>✖</button>
      <h3>📆 Game History</h3>
      <div className="calendar-grid">
        {Object.entries(JSON.parse(localStorage.getItem('helmets-history') || '{}')).map(([date]) => (
          <button
            key={date}
            className="calendar-grid-button"
            onClick={() => (window.location.href = `/?date=${date}`)}
          >
            {date.slice(5)}
          </button>
        ))}
      </div>
    </div>
  </div>
)}

<div className="center-cta">
  <button onClick={handleGiveUp} className="giveup-button">Give Up</button>
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

{showRules && (
  <div className="popup-modal fade-in">
    <div className="popup-content">
      <button className="close-button" onClick={() => setShowRules(false)}>✖</button>
      <h2>WELCOME TO HELMETS!</h2>
      <p><em>Match each helmet path to an NFL player</em></p>
      <h3>HOW TO PLAY</h3>
      <ul className="rules-list">
        <li>🏈 Match a player to the helmet path on each level.</li>
        <li>🏈 Only one guess per level.</li>
        <li>🏈 Multiple players may share the same path.</li>
        <li>🏈 Any active or retired NFL player drafted in 2000 or later qualifies.</li>
        <li>🏈 Paths start with draft college, then list NFL teams in order of career path.</li>
        <li>🏈 5 levels: 1 (easiest) to 5 (hardest) in ascending order.</li>
        <li>🏈 Each level is worth 100 pts x level multiplier (1-5).</li>
        <li>🏈 "Give Up" ends the game and marks remaining levels incorrect.</li>
      </ul>
      <p><strong>Good Luck!</strong></p>
    </div>
  </div>
)}

{gameOver && (
  <div className="complete-banner">
    <h3>🎯 Game Complete</h3>
    <p>Click each box to view possible answers</p>
  </div>
)}

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
          const todayISO = new Date().toISOString().split('T')[0];
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
