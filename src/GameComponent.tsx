import React, { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
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
  const [score, setScore] = useState<number>(0);
  const [showPopup, setShowPopup] = useState(false);

  useEffect(() => {
    const data = localStorage.getItem('nflFullPlayerPool');
    if (data) {
      try {
        const parsedPlayers: PlayerPath[] = JSON.parse(data);
        setPlayers(parsedPlayers);
        const todaysPaths = selectDailyPaths(parsedPlayers);
        setDailyPaths(todaysPaths);
      } catch (err) {
        console.error('Failed to parse player data:', err);
      }
    } else {
      console.warn('No players found in localStorage. Please upload CSV in Admin panel.');
    }
  }, []);

  useEffect(() => {
    if (guesses.length === 5 && guesses.every((g) => g !== undefined)) {
      setTimeout(() => setShowPopup(true), 500);
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

  const sanitizeImageName = (name: string) => {
    return name.replace(/[^a-zA-Z0-9]/g, '_');
  };

  const handleGuess = (levelIndex: number, guess: string) => {
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

  const getEmojiSummary = () => {
    return guesses.map(g => g?.correct ? '✅' : '❌').join(' ');
  };

  const copyToClipboard = () => {
    const text = `Helmets Game - ${new Date().toLocaleDateString()}\nScore: ${score} pts\n${getEmojiSummary()}`;
    navigator.clipboard.writeText(text);
    alert('Score copied to clipboard!');
  };

  const shareOnTwitter = () => {
    const text = encodeURIComponent(
      `Helmets Game - ${new Date().toLocaleDateString()}\nScore: ${score} pts\n${getEmojiSummary()}`
    );
    const url = `https://twitter.com/intent/tweet?text=${text}`;
    window.open(url, '_blank');
  };

  return (
    <div>
      <div className="title-container">
        <span role="img" aria-label="football">🏈</span>
        <h1 className="game-title">Helmets</h1>
        <p className="game-meta">Date: {new Date().toLocaleDateString()} | Score: {score} pts</p>
      </div>

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
          <div className="guess-input">
            <input
              type="text"
              placeholder="(Type to search...)"
              disabled={!!guesses[idx]}
              onBlur={(e) => handleGuess(idx, e.target.value)}
            />
            {guesses[idx] && (
              <p>{guesses[idx].correct ? '✅ Correct!' : `❌ Incorrect (${guesses[idx].guess})`}</p>
            )}
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
