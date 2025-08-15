import React, { useEffect, useRef } from 'react';

export const FocusTrap: React.FC<{ onClose?: () => void; labelledBy?: string; children: React.ReactNode; }> = ({ onClose, labelledBy, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const focusables = Array.from(
      el.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')
    ).filter(n => !n.hasAttribute('disabled') && n.tabIndex !== -1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const prev = document.activeElement as HTMLElement | null;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        if (!first || !last) { e.preventDefault(); return; }
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      {children}
    </div>
  );
};

export const RulesModal: React.FC<{
  show: boolean;
  onClose?: () => void;
  canClose: boolean;
  onStart: () => void;
}> = ({ show, onClose, canClose, onStart }) => {
  if (!show) return null;
  return (
    <div className="popup-modal fade-in" aria-hidden={false}>
      <FocusTrap onClose={canClose ? onClose : undefined} labelledBy="rules-title">
        <div className="popup-content popup-rules" role="document">
          {canClose && <button className="close-button" onClick={onClose} aria-label="Close">✖</button>}
          <h2 id="rules-title">WELCOME TO HELMETS!</h2>
          <h3>HOW TO PLAY</h3>

          <ul className="rules-list football-bullets rules-main">
            <li><strong>Match each helmet path to an NFL player</strong></li>
            <li><strong>5 levels: each gets more difficult and is worth more points</strong></li>
            <li><strong>Only one guess per level</strong></li>
            <li><strong>The faster you answer, the more points you get!</strong></li>
            <li><strong>You get 0 points if you give up a level</strong></li>
          </ul>

          <h4 className="fine-print-title">Fine Print:</h4>
          <ul className="rules-list football-bullets rules-fineprint">
            <li>Each level has a points multiplier (Level 1 = 1x points, Level 5 = 5x points)</li>
            <li>All active or retired NFL players drafted in 2000 or later are eligible</li>
            <li>College helmet is the player's draft college</li>
            <li>Some paths may have multiple possible answers</li>
          </ul>

          {!canClose && (
            <button onClick={onStart} className="primary-button" style={{ marginTop: 12 }}>
              Start Game!
            </button>
          )}
        </div>
      </FocusTrap>
    </div>
  );
};

export const FinalModal: React.FC<{
  show: boolean;
  onClose: () => void;
  dateMMDDYY: string;
  finalDisplayScore: number;
  squares: string;
  onShare: () => void;
}> = ({ show, onClose, dateMMDDYY, finalDisplayScore, squares, onShare }) => {
  if (!show) return null;
  return (
    <div className="popup-modal fade-in" aria-hidden={false}>
      <FocusTrap onClose={onClose} labelledBy="final-title">
        <div className="popup-content popup-final" role="document">
          <button className="close-button" onClick={onClose} aria-label="Close">✖</button>
          <h3 id="final-title" className="popup-title">🎉 Game Complete!</h3>
          <p className="popup-date">{dateMMDDYY}</p>
          <p className="popup-score">Score: <span className="score-number">{finalDisplayScore}</span></p>
          <p>{squares}</p>
          <button onClick={onShare} className="primary-button">Share Score!</button>
        </div>
      </FocusTrap>
    </div>
  );
};

export const HistoryModal: React.FC<{
  show: boolean;
  onClose: () => void;
  todayPT: string;
  dates: string[];
}> = ({ show, onClose, todayPT, dates }) => {
  if (!show) return null;
  return (
    <div className="popup-modal" aria-hidden={false}>
      <FocusTrap onClose={onClose} labelledBy="history-title">
        <div className="popup-content" role="document">
          <button className="close-button" onClick={onClose} aria-label="Close">✖</button>
          <h3 id="history-title">📆 Game History (Last 30 days)</h3>
          <div className="calendar-grid">
            {dates.map((date) => {
              const isToday = date === todayPT;
              return (
                <button
                  key={date}
                  className={`calendar-grid-button${isToday ? ' today' : ''}`}
                  onClick={() => (window.location.href = `/?date=${date}`)}
                >
                  {date.slice(5)}
                </button>
              );
            })}
          </div>
        </div>
      </FocusTrap>
    </div>
  );
};
