import React from 'react';
import type { Guess } from '../utils/storage';

export type PlayerPath = { name: string; path: string[]; path_level: number };

type Props = {
  idx: number;
  path: PlayerPath;
  started: boolean;
  gameOver: boolean;
  isActive: boolean;
  isCovered: boolean;
  isFeedback: boolean;
  guess: Guess | null;
  revealed: boolean;
  multiplier: number;
  awarded: number;
  baseLeft: number;
  communityPct: number;
  suggestions: string[];
  highlightIndex: number;
  typedValue: string;                      // NEW: current input value for highlight
  onToggleReveal: (idx: number) => void;
  onInputChange: (idx: number, value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>, idx: number) => void;
  onBlurInput: (idx: number) => void;      // NEW: hide suggestions on blur
  onGuess: (idx: number, value: string) => void;
  onSkip: (idx: number) => void;
  inputRef: (el: HTMLInputElement | null) => void;
  sanitizeImageName: (name: string) => string;
};

const LevelCard: React.FC<Props> = ({
  idx, path, started, gameOver, isActive, isCovered, isFeedback,
  guess, revealed, multiplier, awarded, baseLeft, communityPct,
  suggestions, highlightIndex, typedValue,
  onToggleReveal, onInputChange, onKeyDown, onBlurInput, onGuess, onSkip,
  inputRef, sanitizeImageName
}) => {
  const isDone = !!guess;
  const blockClass = isDone ? (guess!.correct ? 'path-block-correct' : 'path-block-incorrect') : 'path-block-default';
  let stateClass = 'level-card--locked';
  if (isDone && !isFeedback) stateClass = 'level-card--done';
  else if (isActive) stateClass = 'level-card--active';

  const inputEnabled = isActive && !isDone;
  const showPointsNow = gameOver;
  const badgeText = showPointsNow && isDone ? `+${awarded}` : `${multiplier}x Points`;
  const badgeClass = showPointsNow && isDone ? (awarded > 0 ? 'level-badge won' : 'level-badge zero') : 'level-badge';

  return (
    <div
      className={`path-block level-card ${blockClass} ${stateClass} ${isCovered ? 'is-covered' : ''}`}
      onClick={() => { if (gameOver) onToggleReveal(idx); }}
    >
      {(isActive || gameOver) && <div className="level-tag">Level {idx + 1}</div>}
      <div className={badgeClass} aria-hidden="true">{badgeText}</div>

      <div className="level-cover" aria-hidden={!isCovered}>
        {started && <span className="level-cover-label">Level {idx + 1}</span>}
      </div>

      <div className="card-body">
        {gameOver && <div className="click-hint">Click to view possible answers</div>}

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
          <div className={`guess-input ${guess ? (guess.correct ? 'correct' : 'incorrect') : ''}`}>
            {!guess ? (
              <>
                <input
                  ref={inputRef}
                  type="text"
                  placeholder={inputEnabled ? "Guess Player" : "Locked"}
                  inputMode="text"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => inputEnabled && onInputChange(idx, e.target.value)}
                  onKeyDown={(e) => inputEnabled && onKeyDown(e, idx)}
                  onBlur={() => onBlurInput(idx)}                 {/* NEW: hide on blur */}
                  className="guess-input-field guess-input-mobile font-mobile"
                  disabled={!inputEnabled}
                />

                {inputEnabled && suggestions?.length > 0 && (
                  <div className="suggestion-box fade-in-fast">
                    {suggestions.slice(0, 5).map((name, i) => {        {/* show up to 5 */}
                      const typed = typedValue || '';
                      const lo = name.toLowerCase();
                      const q = typed.toLowerCase();
                      const at = lo.indexOf(q);
                      return (
                        <div
                          key={i}
                          className={`suggestion-item ${highlightIndex === i ? 'highlighted' : ''}`}
                          onMouseDown={() => onGuess(idx, name)}       // onMouseDown beats blur
                        >
                          {q && at >= 0 ? (
                            <>
                              {name.slice(0, at)}
                              <strong>{name.slice(at, at + q.length)}</strong>
                              {name.slice(at + q.length)}
                            </>
                          ) : name}
                        </div>
                      );
                    })}
                  </div>
                )}

                {isActive && (
                  <div className="points-wrap">
                    <div className="points-row">
                      <span className="points-label">Points</span>
                      <span className="points-value">{baseLeft}</span>
                    </div>
                    <div className="points-bar">
                      <div className="points-bar-fill" style={{ ['--fill' as any]: `${baseLeft}%` }} />
                    </div>
                  </div>
                )}

                {inputEnabled && (
                  <button className="primary-button skip-button" type="button" onClick={() => onSkip(idx)}>
                    Give Up (0 points)
                  </button>
                )}
              </>
            ) : (
              <div className={`locked-answer ${guess.correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}>
                {guess.correct ? `✅ ${guess.guess}` : `❌ ${guess.guess || 'No Answer'}`}
                {(!gameOver || isFeedback) && (
                  <div style={{ marginTop: 6, fontSize: '0.85rem', fontWeight: 700 }}>
                    {`+${awarded || 0}`}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {gameOver && (
          <div className="community-wrap">
            <div className="community-row">
              <span>Users Correct</span>
              <span>{communityPct ?? 0}%</span>
            </div>
            <div className="community-bar">
              <div className="community-bar-fill" style={{ ['--pct' as any]: `${communityPct ?? 0}%` }} />
            </div>
          </div>
        )}

        {gameOver && revealed && (
          <div className="possible-answers">
            <strong>Possible Answers:</strong>
            <ul className="possible-answers-list">
              {path && null}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default React.memo(LevelCard);
