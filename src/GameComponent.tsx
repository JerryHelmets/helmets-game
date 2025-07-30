import React, { useEffect, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import Papa from 'papaparse';
import './GameComponent.css';

interface PlayerPath {
  name: string;
  path: string[];
  difficulty: number;
  path_level: number;
}

interface Guess {
  guess: string;
  correct: boolean;
}

const GameComponent: React.FC = () => {
  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [dailyPaths, setDailyPaths] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<Guess[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<string[][]>([]);
  const [focusedInput, setFocusedInput] = useState<number | null>(null);
  const [highlightIndex, setHighlightIndex] = useState<number>(-1);
  const [score, setScore] = useState<number>(0);
  const [timer, setTimer] = useState<number>(0);
  const [showPopup, setShowPopup] = useState<boolean>(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/data/players.csv')
      .then((response) => response.text())
      .then((csvText) => {
        const parsed = Papa.parse(csvText, { header: true });
        const rows = parsed.data as any[];
        const validRows = rows.filter(row => row.name && row.path);
        const playerData: PlayerPath[] = validRows.map((row) => ({
          name: row.name.trim(),
          path: row.path.split('>').map((x: string) => x.trim()),
          difficulty: parseInt(row.difficulty || '1', 10),
          path_level: parseInt(row.path_level || '1', 10),
        }));

        setPlayers(playerData);

        const uniquePathMap = new Map<string, PlayerPath>();
        playerData.forEach((p) => {
          const key = p.path.join('>');
          if (!uniquePathMap.has(key)) {
            uniquePathMap.set(key, p);
          }
        });

        const uniquePaths = Array.from(uniquePathMap.values());

        const pathsByLevel: { [key: number]: PlayerPath[] } = {};
        for (let i = 1; i <= 5; i++) pathsByLevel[i] = [];
        uniquePaths.forEach(p => {
          if (p.path_level >= 1 && p.path_level <= 5) {
            pathsByLevel[p.path_level].push(p);
          }
        });

        const selected: PlayerPath[] = [];
        for (let level = 1; level <= 5; level++) {
          const pool = pathsByLevel[level];
          if (pool.length > 0) {
            const rand = pool[Math.floor(Math.random() * pool.length)];
            selected.push(rand);
          }
        }

        setDailyPaths(selected);
        setFilteredSuggestions(Array(selected.length).fill([]));
        setGuesses(Array(selected.length).fill(undefined));
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

  const sanitizeImageName = (name: string) => name.toLowerCase().replace(/\s+/g, '-');

  const handleInputChange = (index: number, value: string) => {
    const suggestions = players
      .filter((p) => p.name.toLowerCase().includes(value.toLowerCase()))
      .map((p) => p.name);
    const updated = [...filteredSuggestions];
    updated[index] = suggestions.slice(0, 5);
    setFilteredSuggestions(updated);
  };

  const handleGuess = (index: number, value: string) => {
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
      confetti({ particleCount: 60, spread: 80, origin: { y: 0.6 } });
    }

    const allAnswered = updatedGuesses.every((g) => g);
    if (allAnswered) setShowPopup(true);
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

  return (
    <div>
      <header className="game-header">
        <h1 className="game-title">Helmets</h1>
        <div className="game-subtitle">
          <span>{new Date().toLocaleDateString()}</span>
          <span className="score-value"> | Score: {score}</span>
          <span> | Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</span>
        </div>
      </header>

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
          <div className={`guess-input-container`}>
            <div className={`guess-input ${guesses[idx] ? (guesses[idx].correct ? 'correct' : 'incorrect') : ''}`}>
              <input
                ref={(el) => (inputRefs.current[idx] = el)}
                type="text"
                placeholder="(Type to search...)"
                disabled={!!guesses[idx]}
                onFocus={() => setFocusedInput(idx)}
                onChange={(e) => handleInputChange(idx, e.target.value)}
                onBlur={(e) => handleGuess(idx, e.target.value)}
              />
              {!guesses[idx] && filteredSuggestions[idx]?.length > 0 && (
                <ul className="suggestion-dropdown">
                  {filteredSuggestions[idx].map((name, i) => (
                    <li
                      key={i}
                      className={highlightIndex === i ? 'highlighted' : ''}
                      onMouseDown={() => handleGuess(idx, name)}>
                      {name}
                    </li>
                  ))}
                </ul>
              )}
              {guesses[idx] && (
                <p className={guesses[idx].correct ? 'correct' : 'incorrect'}>
                  {guesses[idx].correct
                    ? `✅ Correct (${path.name})`
                    : (showPopup ? `❌ Incorrect (${guesses[idx].guess}) | Answer: ${path.name}` : `❌ Incorrect (${guesses[idx].guess})`)}
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
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={() => setShowPopup(false)}>✖</button>
            <h3>🎉 Game Complete!</h3>
            <p>You scored {score} pts</p>
            <p>Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</p>
            <p>{getEmojiSummary()}</p>
            <div style={{ marginTop: '1em', textAlign: 'left' }}>
              <h4>Correct Answers:</h4>
              <ul>
                {dailyPaths.map((path, idx) => (
                  <li key={idx}>
                    {path.path.join(' > ')}: {
                      players
                        .filter(p => p.path.join('>') === path.path.join('>'))
                        .map(p => p.name)
                        .join(', ')
                    }
                  </li>
                ))}
              </ul>
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
