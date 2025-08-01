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

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const localGuesses = localStorage.getItem('helmets-guesses');
    if (localGuesses) {
      setGuesses(JSON.parse(localGuesses));
    }
  }, []);

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
            x: rect.left / window.innerWidth,
            y: rect.top / window.innerHeight,
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

  return (
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
            <ul style={{ listStyle: 'none', paddingLeft: 0, textAlign: 'left', lineHeight: '1.75' }}>
              <li>🏈 For each level, match one player whose draft college & NFL carerer path matches the helmets path (multiple players may share the same path).</li>
              <li>🏈 Only one guess per level.</li>
              <li>🏈 Players active or retired qualify but must have been drafted in 2000 or later.</li>
              <li>🏈 Paths start with draft college, then list NFL teams in order.</li>
              <li>🏈 5 levels: 1 (easiest) to 5 (hardest) in ascending order.</li>
              <li>🏈 Correct answers score 100–500 pts by level; incorrect = 0 pts.</li>
              <li>🏈 "Give Up" ends the game and marks remaining levels incorrect.</li>
            </ul>
            <p><strong>Good Luck!</strong></p>
          </div>
        </div>
      )}
      
      {dailyPaths.map((path, idx) => (
  <div key={idx} className="path-block">
    <div className="helmet-sequence">
      {path.path.map((team, i) => (
        <React.Fragment key={i}>
          <img
            src={`/images/${sanitizeImageName(team)}.png`}
            alt={team}
            className="helmet-img"
          />
          {i < path.path.length - 1 && <span className="arrow">→</span>}
        </React.Fragment>
      ))}
    </div>

    <div className="guess-input-container">
      <div className={`guess-input ${guesses[idx] ? (guesses[idx].correct ? 'correct' : 'incorrect') : ''}`}>
        <input
          ref={(el) => (inputRefs.current[idx] = el)}
          type="text"
          placeholder="Guess Player"
          disabled={!!guesses[idx]}
          onFocus={() => setFocusedInput(idx)}
          onChange={(e) => handleInputChange(idx, e.target.value)}
          onKeyDown={(e) => handleKeyDown(e, idx)}
          value={guesses[idx]?.correct ? path.name : undefined}
        />

        {!guesses[idx] && filteredSuggestions[idx]?.length > 0 && (
          <div className="suggestion-box">
            {filteredSuggestions[idx].slice(0, 20).map((name, i) => {
              const match = name.toLowerCase().indexOf(inputRefs.current[idx]?.value.toLowerCase() || '');
              return (
                <div
                  key={i}
                  className={`suggestion-item ${highlightIndex === i ? 'highlighted' : ''}`}
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

        {guesses[idx] && guesses[idx].correct && (
          <p className="correct">
            ✅ Correct ({path.name})
          </p>
        )}
      </div>
    </div>
  </div>
))}

      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button onClick={handleGiveUp} style={{ padding: '8px 16px', fontSize: '16px' }}>Give Up</button>
      </div>

      {showPopup && (
        <div className="popup-modal fade-in">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowPopup(false)}>✖</button>
            <h3>🎉 Game Complete!</h3>
            <p>You scored {score} pts</p>
            <p>Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</p>
            <p>{getEmojiSummary()}</p>
            <div style={{ marginTop: '1em', textAlign: 'left' }}>
            </div>
            <button onClick={copyToClipboard}>Copy Score</button>
            <button onClick={shareOnTwitter}>Share on Twitter</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameComponent;
