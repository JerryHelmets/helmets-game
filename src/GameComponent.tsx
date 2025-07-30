import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import './GameComponent.css';
import Papa from 'papaparse';

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
  const [guesses, setGuesses] = useState<Guess[]>(() => {
    const stored = localStorage.getItem('helmetGuesses');
    return stored ? JSON.parse(stored) : [];
  });
  const [score, setScore] = useState<number>(0);
  const [showPopup, setShowPopup] = useState(false);
  const [timer, setTimer] = useState(0);

useEffect(() => {
  fetch('/data/players.csv')
    .then((res) => res.text())
    .then((csvText) => {
      const { data } = Papa.parse(csvText, { header: true });
      const parsedPlayers: PlayerPath[] = data.map((row: any) => ({
        name: row.name,
        path: row.path.split(',').map((s: string) => s.trim()),
        difficulty: parseInt(row.difficulty, 10),
        path_level: parseInt(row['path level'], 10),
      }));
      setPlayers(parsedPlayers);
      const todaysPaths = selectDailyPaths(parsedPlayers);
      setDailyPaths(todaysPaths);
    })
    .catch((err) => {
      console.error('Failed to load CSV player data:', err);
    });
}, []);


  useEffect(() => {
    const interval = setInterval(() => setTimer((prev) => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (guesses.length === 5 && guesses.every((g) => g !== undefined)) {
      setTimeout(() => setShowPopup(true), 500);
    }
    localStorage.setItem('helmetGuesses', JSON.stringify(guesses));
  }, [guesses]);

  useEffect(() => {
    if (guesses.length === 5 && guesses.every((g) => g !== undefined)) {
      clearInterval();
    }
  }, [guesses]);

  const selectDailyPaths = (players: PlayerPath[]): PlayerPath[] => {
    const dateSeed = new Date().toISOString().slice(0, 10);
    const rng = seedRandom(dateSeed);
    const shuffled = [...players].sort(() => rng() - 0.5);
    const uniquePaths = new Set();
    const result: PlayerPath[] = [];
    for (const p of shuffled) {
      const key = p.path.join(',');
      if (!uniquePaths.has(key)) {
        uniquePaths.add(key);
        result.push(p);
      }
      if (result.length === 5) break;
    }
    return result;
  };

  const seedRandom = (seed: string) => {
    let h = 0;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(31, h) + seed.charCodeAt(i);
    }
    return () => {
      h ^= h >>> 13;
      h ^= h << 17;
      h ^= h >>> 5;
      return (h >>> 0) / 4294967296;
    };
  };

  const sanitizeImageName = (name: string) => name.replace(/[^a-zA-Z0-9]/g, '_');

  const handleGuess = (levelIndex: number, guess: string) => {
    if (guesses.some((g, i) => i !== levelIndex && g?.guess?.toLowerCase() === guess.toLowerCase())) {
      alert('That player has already been guessed on another level.');
      return;
    }
    const correctPath = dailyPaths[levelIndex].path.join(',');
    const matched = players.find(
      (p) => p.name.toLowerCase() === guess.toLowerCase() && p.path.join(',') === correctPath
    );
    const isCorrect = !!matched;
    const pts = isCorrect ? (6 - dailyPaths[levelIndex].difficulty) * 100 : 0;
    setGuesses((prev) => {
      const updated = [...prev];
      updated[levelIndex] = { guess, correct: isCorrect };
      return updated;
    });
    setScore((prev) => prev + pts);
    if (isCorrect) {
      const inputEl = document.querySelectorAll('input')[levelIndex];
      const rect = inputEl.getBoundingClientRect();
      confetti({
        particleCount: 80,
        spread: 70,
        origin: {
          x: rect.left / window.innerWidth + rect.width / window.innerWidth / 2,
          y: rect.top / window.innerHeight + rect.height / window.innerHeight / 2
        }
      });
    }
  };

  const handleGiveUp = () => {
    const updated = [...guesses];
    dailyPaths.forEach((path, idx) => {
      if (!updated[idx]) {
        updated[idx] = { guess: `Answer: ${path.name}`, correct: false };
      }
    });
    setGuesses(updated);
  };

  const getEmojiSummary = () => guesses.map(g => g?.correct ? '✅' : '❌').join(' ');

  const copyToClipboard = () => {
    const text = `Helmets Game - ${new Date().toLocaleDateString()}\nScore: ${score} pts\nTime: ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}\n${getEmojiSummary()}`;
    navigator.clipboard.writeText(text);
    alert('Score copied to clipboard!');
  };

  const shareOnTwitter = () => {
    const text = encodeURIComponent(
      `Helmets Game - ${new Date().toLocaleDateString()}\nScore: ${score} pts\nTime: ${Math.floor(timer / 60)}:${String(timer % 60).padStart(2, '0')}\n${getEmojiSummary()}`
    );
    const url = `https://twitter.com/intent/tweet?text=${text}`;
    window.open(url, '_blank');
  };

  const sortedPaths = [...dailyPaths].sort((a, b) => a.path_level - b.path_level);

  return (
    <div>
      <div className="game-timer">Time: {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}</div>
      {sortedPaths.map((path, idx) => (
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
                type="text"
                placeholder="(Type to search...)"
                disabled={!!guesses[idx]}
                onBlur={(e) => handleGuess(idx, e.target.value)}
              />
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
            <button onClick={copyToClipboard}>Copy Score</button>
            <button onClick={shareOnTwitter}>Share on Twitter</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameComponent;
