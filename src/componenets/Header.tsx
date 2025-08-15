import React from 'react';

type Props = {
  gameDateHeader: string;
  displayScore: number;
  onOpenRules: () => void;
};

const Header: React.FC<Props> = ({ gameDateHeader, displayScore, onOpenRules }) => {
  return (
    <header className="game-header">
      <div className="title-row">
        <img className="game-logo" src="/android-chrome-outline-large-512x512.png" alt="Game Logo" />
        <h1 className="game-title">HELMETS</h1>
      </div>
      <div className="date-line">{gameDateHeader}</div>
      <div className="score-line">
        Score: <span className="score-number">{displayScore}</span>
      </div>
      <button className="rules-button" onClick={onOpenRules}>Rules</button>
    </header>
  );
};

export default React.memo(Header);
