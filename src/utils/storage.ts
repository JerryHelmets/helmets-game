export type Guess = { guess: string; correct: boolean };
export type DayState = {
  v: 1;
  date: string;
  guesses: (Guess | null)[];
  score: number;
  awardedPoints: number[];
  basePointsLeft: number[];
};

const LS_DAY_PREFIX = 'helmets:day:';
const LS_STARTED = 'helmets-started';

export function loadDay(date: string): DayState | null {
  try {
    const raw = localStorage.getItem(LS_DAY_PREFIX + date);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1 && parsed.date === date) return parsed as DayState;
  } catch {}
  return null;
}

export function saveDay(state: DayState) {
  try { localStorage.setItem(LS_DAY_PREFIX + state.date, JSON.stringify(state)); } catch {}
}

export function getStartedMap(){ try { return JSON.parse(localStorage.getItem(LS_STARTED) || '{}'); } catch { return {}; } }
export function setStartedFor(date: string, v: boolean){ const m = getStartedMap(); m[date]=v; localStorage.setItem(LS_STARTED, JSON.stringify(m)); }
export function getStartedFor(date: string){ const m = getStartedMap(); return !!m[date]; }
