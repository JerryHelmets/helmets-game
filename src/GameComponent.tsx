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
    return shuffled.slice(0, 5);
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
    if (isCorrect) confetti({ spread: 100, origin: { y: 0.6 } });
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
      <h2>Helmets Game</h2>
      <p>Date: {new Date().toLocaleDateString()} | Score: {score} pts</p>
      {dailyPaths.map((path, idx) => (
        <div key={idx} className="path-block">
          <div className="helmet-sequence">
            {path.path.map((team, i) => (
              <img
                key={i}
                src={`/images/${sanitizeImageName(team)}.png`}
                alt={team}
                className="helmet-img"
              />
            ))}
          </div>
          <input
            type="text"
            placeholder="(Type to search...)"
            disabled={!!guesses[idx]}
            onBlur={(e) => handleGuess(idx, e.target.value)}
          />
          {guesses[idx] && (
            <p>{guesses[idx].correct ? '✅ Correct!' : '❌ Incorrect'}</p>
          )}
        </div>
      ))}

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
