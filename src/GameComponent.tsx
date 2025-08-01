import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import Papa from 'papaparse';
import './GameComponent.css';

interface PlayerPath {
  name: string;
  path: string[];
  path_level: number;
}

interface Guess {
  guess: string;
  correct: boolean;
}

function seededRandom(seed: number) {
  return function () {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
}

const GameComponent: React.FC = () => {
  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [dailyPaths, setDailyPaths] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
  const [focusedInput, setFocusedInput] = useState<number | null>(null);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [score, setScore] = useState<number>(0);
  const [showPopup, setShowPopup] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showShareOptions, setShowShareOptions] = useState(false);
  const urlParams = new URLSearchParams(window.location.search);
  const dateParam = urlParams.get('date');
  const [customDate, setCustomDate] = useState(dateParam);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (!customDate) return;
    const history = JSON.parse(localStorage.getItem('helmets-history') || '{}');
    const data = history[customDate];
    if (data) {
      setGuesses(data.guesses || []);
      setScore(data.score || 0);
      setTimer(data.timer || 0);
      setShowPopup(true);
    }
  }, [customDate]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const localGuesses = localStorage.getItem('helmets-guesses');
    if (localGuesses) {
      setGuesses(JSON.parse(localGuesses));
    }
  }, []);

  useEffect(() => {
  // Reset guesses when a new game starts
  setGuesses(Array(dailyPaths.length).fill(null));
}, [dailyPaths]);

  useEffect(() => {
    fetch('/data/players.csv')
      .then((response) => response.text())
      .then((csvText) => {
        const parsed = Papa.parse(csvText, { header: true });
        const rows = parsed.data as any[];
        const validRows = rows.filter(row => row.name && row.path && row.path_level);

        const invalidRows = rows.filter(row => !row.path_level || isNaN(parseInt(row.path_level)));
        if (invalidRows.length > 0) {
          console.warn(`⚠️ CSV Validation: ${invalidRows.length} rows missing or invalid 'path_level'. They were ignored.`);
        }

        const playerData: PlayerPath[] = validRows.map((row) => ({
          name: row.name.trim(),
          path: row.path.split(',').map((x: string) => x.trim()),
          path_level: parseInt(row.path_level, 10),
        }));

        setPlayers(playerData);

        const todayKey = new Date().toISOString().slice(0, 10);
        const hashSeed = todayKey.split('-').join('');
        const seed = parseInt(hashSeed, 10);
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
          const uniqueMap = uniquePathsByLevel[level];
          const values = Array.from(uniqueMap.values());
          if (values.length > 0) {
            const index = Math.floor(rng() * values.length);
            selected.push(values[index]);
          }
        }

        setDailyPaths(selected);
        setFilteredSuggestions(Array(selected.length).fill([]));
        if (!localStorage.getItem('helmets-guesses')) {
          setGuesses(Array(selected.length).fill(undefined));
        }
      })
      .catch((error) => console.error('Error loading CSV:', error));
  }, []);

  useEffect(() => {
    const scoreEl = document.querySelector('.score-value');
    if (scoreEl) {
      scoreEl.classList.add('pulse');
      const timer = setTimeout(() => scoreEl.classList.remove('pulse'), 300);
      return () => clearTimeout(timer);
    }
  }, [score]);

  useEffect(() => {
    localStorage.setItem('helmets-guesses', JSON.stringify(guesses));
  }, [guesses]);
useEffect(() => {
  const hasAnyGuess = guesses.some((g) => g);
  const allAnswered = guesses.length === dailyPaths.length && guesses.every((g) => g);
  if (hasAnyGuess && allAnswered) setShowPopup(true);
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
    if (guesses[index]) return;
    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(
      (p) => p.name.toLowerCase() === value.toLowerCase() && p.path.join('>') === correctPath
    );

    const updatedGuesses = [...guesses];
    updatedGuesses[index] = {
      guess: value,
      correct: !!matched,
    };
    setGuesses(updatedGuesses);
    if (matched) {
      setScore((prev) => prev + 1);
     const inputBox = inputRefs.current[index];
      if (inputBox) {
        const rect = inputBox.getBoundingClientRect();
        confetti({
          particleCount: 60,
          spread: 80,
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
    const updated = guesses.map((g, i) => g ?? { guess: '', correct: false });
    setGuesses(updated);
    setShowPopup(true);
  };

  const copyToClipboard = () => {
    const scoreText = `Helmets Score: ${score}/5\nTime: ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}`;
    navigator.clipboard.writeText(scoreText);
  };

  const shareOnTwitter = () => {
    const text = encodeURIComponent(`I scored ${score}/5 on Helmets 🏈 in ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}\nPlay now!`);
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  const getEmojiSummary = () => {
    return guesses
      .map((g) => (g?.correct ? '🟩' : '🟥'))
      .join('');
  };
const [confettiFired, setConfettiFired] = useState(false);
  const [showRules, setShowRules] = useState(() => {
    return localStorage.getItem('rulesShown') !== 'true';
  });
  const [timer, setTimer] = useState(() => {
    const stored = localStorage.getItem('helmets-timer');
    return stored ? parseInt(stored, 10) : 0;
  });
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    const today = new Date().toLocaleDateString();
    const lastPlayed = localStorage.getItem('lastPlayedDate');
    if (lastPlayed !== today) {
      localStorage.setItem('lastPlayedDate', today);
      localStorage.removeItem('helmets-guesses');
      localStorage.removeItem('helmets-timer');
    }
  }, []);

  useEffect(() => {
    if (!showPopup) {
      timerRef.current = setInterval(() => {
        setTimer((prev) => {
          const updated = prev + 1;
          localStorage.setItem('helmets-timer', updated.toString());
          return updated;
        });
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [showPopup]);
  
  useEffect(() => {
    if (showPopup && !confettiFired) {
      confetti({ particleCount: 250, spread: 200, origin: { y: 0.6 } });
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  useEffect(() => {
    if (showRules) return;
    localStorage.setItem('rulesShown', 'true');
  }, [showRules]);

  useEffect(() => {
  const today = new Date().toISOString().split('T')[0];
  const history = JSON.parse(localStorage.getItem('helmets-history') || '{}');
  const saved = localStorage.getItem('helmets-guesses');
  const parsed = saved ? JSON.parse(saved) : {};

  if (parsed.date === today && parsed.guesses?.length === dailyPaths.length) {
    setGuesses(parsed.guesses);
    setScore(parsed.score || 0);
    setTimer(parsed.timer || 0);
  } else {
    setGuesses(Array(dailyPaths.length).fill(null));
    localStorage.setItem('helmets-guesses', JSON.stringify({ date: today, guesses: Array(dailyPaths.length).fill(null) }));
  }
}, [dailyPaths]);

useEffect(() => {
  const today = new Date().toISOString().split('T')[0];
  localStorage.setItem('helmets-guesses', JSON.stringify({ date: today, guesses, score, timer }));

  const fullHistory = JSON.parse(localStorage.getItem('helmets-history') || '{}');
  fullHistory[today] = { guesses, score, timer };
  localStorage.setItem('helmets-history', JSON.stringify(fullHistory));
}, [guesses]);


  return (
<div style={{ transform: 'scale(0.92)', transformOrigin: 'top center', width: '100vw', overflowX: 'hidden', paddingTop: '24px' }}>
  <style>{`
  input, textarea, select {
    font-size: 16px !important;
  }
  @media screen and (orientation: landscape) {
    body {
      transform: rotate(90deg);
      transform-origin: left top;
      width: 100vh;
      height: 100vw;
      overflow-x: hidden;
      position: absolute;
      top: 100%;
      left: 0;
    }
  }
`}</style>
  <div>
      <header className="game-header">
        <h1 className="game-title">Helmets</h1>
        <div className="game-subtitle">
          <span>{new Date().toLocaleDateString()}</span>
          <span className="score-value"> | Score: {score}</span>
          <span> | Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</span>
        </div>
        <button className="rules-button" onClick={() => setShowRules(true)}>Rules</button>
      </header>

      {showRules && (
        <div className="popup-modal fade-in">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowRules(false)}>✖</button>
            <h2>WELCOME TO HELMETS!</h2>
            <p><em>Match each helmet path to an NFL player</em></p>
            <h3>HOW TO PLAY</h3>
            <ul style={{ listStyle: 'none', paddingLeft: 0, textAlign: 'left', marginTop: '5px' }}>
              <li>🏈 Match a player to the helmet path on each level.</li>
              <li>🏈 Only one guess per level.</li>
              <li>🏈 Multiple players may share the same path.</li>
              <li>🏈 Player an be any active or retired NFL player drafted in 2000 or later.</li>
              <li>🏈 Paths start with draft college, then list NFL teams in order of career path.</li>
              <li>🏈 5 levels: 1 (easiest) to 5 (hardest) in ascending order.</li>
              <li>🏈 Correct answers score 100–500 pts by level; incorrect = 0 pts.</li>
              <li>🏈 "Give Up" ends the game and marks remaining levels incorrect.</li>
            </ul>
            <p><strong>Good Luck!</strong></p>
          </div>
        </div>
      )}
      
      
{dailyPaths.map((path, idx) => {
  const blockClass = guesses[idx] ? (guesses[idx].correct ? 'path-block-correct' : 'path-block-incorrect') : 'path-block-default';
  return (
    <div
      key={idx}
      className={`path-block ${blockClass}`}
      style={{
        border: '2px solid',
        borderColor: guesses[idx] ? (guesses[idx].correct ? '#28a745' : '#dc3545') : '#ccc',
        backgroundColor: guesses[idx] ? (guesses[idx].correct ? '#e6ffe6' : '#ffe6e6') : '#f9f9f9',
        borderRadius: '10px',
        padding: '2px 4px',
        marginBottom: '2px',
        boxShadow: '0 1px 1px rgba(0,0,0,0.04)',
        maxWidth: '420px',
        width: '98%',
        margin: '2px auto',
        textAlign: 'center',
        transition: 'background-color 0.3s ease, border-color 0.3s ease'
      }}
    >
      <div className="helmet-sequence" style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center', gap: '2px', marginBottom: '1px', marginTop: '0px' }}>
        {path.path.map((team, i) => (
          <React.Fragment key={i}>
            <img
              src={`/images/${sanitizeImageName(team)}.png`}
              alt={team}
              className='helmet-img-responsive helmet-img-scale helmet-img-mobile font-mobile helmet-img-fixed helmet-img-mobile-lg'
              style={{ width: '40px', height: '40px', objectFit: 'contain', maxWidth: '40px', flexShrink: 0 }}
            />
            {i < path.path.length - 1 && <span className="arrow helmet-arrow helmet-arrow-mobile font-mobile">→</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="guess-input-container" style={{ display: 'flex', justifyContent: 'center', marginTop: '0px' }}>
        <div className={`guess-input ${guesses[idx] ? (guesses[idx].correct ? 'correct' : 'incorrect') : ''}`}>
          {!guesses[idx] ? (
            <input
              ref={(el) => (inputRefs.current[idx] = el)}
              type="text"
              placeholder="Guess Player"
              inputMode="text"
              onFocus={() => setFocusedInput(idx)}
              onBlur={() => document.activeElement.blur()}
              onChange={(e) => handleInputChange(idx, e.target.value)}
              onKeyDown={(e) => handleKeyDown(e, idx)}
              style={{ width: '98%', maxWidth: '380px', padding: '2px 6px', fontSize: '5px', borderRadius: '6px', border: '1px solid #ccc' }}
              className="guess-input-mobile font-mobile"
            />
          ) : (
            <div
              className={`locked-answer ${guesses[idx].correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}
              style={{
                padding: '2px 3px',
                borderRadius: '6px',
                fontWeight: 'bold',
                animation: guesses[idx].correct ? 'fadeIn 0.3s ease-in-out' : 'blinkRed 0.6s ease-in-out 1',
                color: '#fff',
                backgroundColor: guesses[idx].correct ? '#28a745' : '#dc3545',
                fontSize: '0.45rem',
                textAlign: 'center'
              }}
            >
              {guesses[idx].correct ? `✅ ${path.name}` : `❌ ${guesses[idx].guess}`}
            </div>
          )}

          {!guesses[idx] && filteredSuggestions[idx]?.length > 0 && (
            <div className="suggestion-box" style={{ fontFamily: 'Fira Sans, sans-serif', animation: 'fadeIn 0.3s ease-out' }}>
              {filteredSuggestions[idx].slice(0, 3).map((name, i) => {
                const match = name.toLowerCase().indexOf(inputRefs.current[idx]?.value.toLowerCase() || '');
                return (
                  <div
                    key={i}
                    className={`suggestion-item ${highlightIndex === i ? 'highlighted' : ''}`}
                    style={{ padding: '6px 10px', cursor: 'pointer', fontFamily: 'Fira Sans, sans-serif', fontSize: '0.8rem' }}
                    onMouseDown={() => handleGuess(idx, name)}
                  >
                    {match >= 0 ? (
                      <>
                        {name.slice(0, match)}
                        <strong>{name.slice(match, match + (inputRefs.current[idx]?.value.length || 0))}</strong>
                        {name.slice(match + (inputRefs.current[idx]?.value.length || 0))}
                      </>
                    ) : name}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
})}
</div>


      <button onClick={() => setShowHistory(true)} style={{ position: 'absolute', top: '12px', right: '12px', padding: '6px 10px', fontSize: '0.8rem' }}>📅 History</button>
      <button onClick={() => setShowFeedback(true)} style={{ position: 'absolute', top: '12px', right: '100px', padding: '6px 10px', fontSize: '0.8rem' }}>💬 Feedback</button>

      {showHistory && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowHistory(false)}>✖</button>
            <h3>📆 Game History</h3>
           <div className="calendar-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '6px', marginBottom: '1rem' }}>
              {Object.entries(JSON.parse(localStorage.getItem('helmets-history') || '{}')).map(([date]) => (
                <button
                  key={date}
                  style={{ padding: '6px', fontSize: '0.7rem', border: '1px solid #ccc', borderRadius: '6px', backgroundColor: '#f2f2f2' }}
                  onClick={() => window.location.href = `/?date=${date}`}
                >
                  {date.slice(5)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}


      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button onClick={handleGiveUp} style={{ padding: '8px 16px', fontSize: '16px' }}>Give Up</button>
      </div>
      
{showFeedback && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowFeedback(false)}>✖</button>
            <h3>Thoughts for Jerry?</h3>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: '1em' }}>
              <span style={{ fontSize: '1.2rem', marginRight: '8px' }}>📧</span>
              <span style={{ fontFamily: 'Fira Sans, sans-serif', fontSize: '0.95rem' }}>jerry.helmetsgame@gmail.com</span>
            </div>
            <button 
              onClick={() => {
                navigator.clipboard.writeText('jerry.helmetsgame@gmail.com');
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }} 
              style={{ marginTop: '1em', padding: '6px 12px', fontSize: '0.8rem' }}>
              Copy Email
            </button>
            {copied && <p style={{ marginTop: '0.5em', color: 'green', fontSize: '0.8rem' }}>Email copied!</p>}
          </div>
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
      <button onClick={() => {
        const today = new Date().toISOString().split('T')[0];
        const correctCount = guesses.filter(g => g && g.correct).length;
        const shareMsg = `🏈 Helmets Game – ${today}\nScore: ${score} pts\n${correctCount}/5 correct\nTime: ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}\n${getEmojiSummary()}\nPlay here: https://www.helmets-game.com`;

        if (navigator.share) {
          navigator.share({
            title: 'Helmets Game',
            text: `${shareMsg}\n\nPlay <here!>: https://www.helmets-game.com`,
            url: 'https://www.helmets-game.com'
          }).catch(() => navigator.clipboard.writeText(shareMsg));
        } else {
          navigator.clipboard.writeText(shareMsg);
          alert('Score copied!');
        }
      }}>Share Score!</button>
    </div>
  </div>
)}
</div>
  );
};

export default GameComponent;
