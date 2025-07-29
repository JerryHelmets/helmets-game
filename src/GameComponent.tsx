// src/GameComponent.tsx
import React, { useState, useEffect, useRef } from "react";
import { ArrowRight, X, Clock, Mail } from "lucide-react";
import confetti from "canvas-confetti";
import "./GameComponent.css";

interface Player {
  name: string;
  path: string[];
  pathLevel: number;
}

interface Row {
  path: string[];
  players: Player[];
  level: number;
}

interface HistoryEntry {
  score: number;
  elapsed: number;
}

function getDateKey(date: Date) {
  return date.toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

function sanitizeNodeToFile(node: string) {
  return (
    node
      // Handle common A&M pattern used in image filenames
      .replace(/A&M/gi, "and_m")
      // Replace remaining ampersands with the word 'and'
      .replace(/&/g, "and")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toLowerCase() +
    ".avif"
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60),
        s = sec % 60;
  return `${m}m ${s}s`;
}

export default function GameComponent() {
  const [fullPool, setFullPool] = useState<Player[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [filterTerms, setFilterTerms] = useState<Record<number, string>>({});
  const [guesses, setGuesses] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [pulsingRows, setPulsingRows] = useState<Record<number, boolean>>({});
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>(getDateKey(new Date()));
  const [showScore, setShowScore] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const confettiFired = useRef(false);

  const POINTS = [100, 200, 300, 400, 500];

  // 1️⃣ Load the player pool
  useEffect(() => {
    const json =
      localStorage.getItem("nflFullPlayerPool") ??
      localStorage.getItem("playerPool") ??
      "[]";
    setFullPool(JSON.parse(json));
  }, []);

  // 2️⃣ Show the Rules popup on first load
  useEffect(() => {
    setShowRules(true);
  }, []);

  // 3️⃣ Timer ticking
  useEffect(() => {
    if (!showScore) {
      const t = setInterval(() => setElapsed((e) => e + 1), 1000);
      return () => clearInterval(t);
    }
  }, [showScore]);

  // 4️⃣ Load or generate today's rows, then load guesses/submissions
  useEffect(() => {
    const key = selectedDate;

    // Try to read cached rows, but only if each has a non-empty path
    const rowsCache = JSON.parse(
      localStorage.getItem("nflRowsByDate") || "{}"
    ) as Record<string, Row[]>;
    const cached = rowsCache[key];
    const cacheValid =
      Array.isArray(cached) &&
      cached.length === 5 &&
      cached.every((r) => Array.isArray(r.path) && r.path.length > 0);

    if (cacheValid) {
      setRows(cached);
    } else {
      // Build fresh rows from fullPool
      const map = new Map<string, Player[]>();
      fullPool.forEach((p) => {
        const k = JSON.stringify(p.path);
        ;(map.get(k) ?? map.set(k, []).get(k)!)!.push(p);
      });
      const allRows: Row[] = Array.from(map.entries()).map(
        ([k, ps]) => ({
          path: JSON.parse(k),
          players: ps,
          level: ps[0].pathLevel,
        })
      );
      const byLevel: Record<number, Row[]> = {};
      allRows.forEach((r) => {
        if (r.level >= 1 && r.level <= 5) (byLevel[r.level] ??= []).push(r);
      });
      const pick: Row[] = [];
      for (let lvl = 1; lvl <= 5; lvl++) {
        const grp = byLevel[lvl] || [];
        pick.push(
          grp.length
            ? grp[Math.floor(Math.random() * grp.length)]
            : { path: [], players: [], level: lvl }
        );
      }
      rowsCache[key] = pick;
      localStorage.setItem("nflRowsByDate", JSON.stringify(rowsCache));
      setRows(pick);
    }

    // Load stored guesses & submissions
    const guessesCache = JSON.parse(
      localStorage.getItem("nflGuessesByDate") || "{}"
    ) as Record<string, Record<number, string>>;
    const submittedCache = JSON.parse(
      localStorage.getItem("nflSubmittedByDate") || "{}"
    ) as Record<string, Record<number, boolean>>;

    setGuesses(guessesCache[key] || {});
    setSubmitted(submittedCache[key] || {});
    setElapsed(0);
    setShowScore(false);
    confettiFired.current = false;
  }, [selectedDate, fullPool]);

  // 5️⃣ Persist guesses whenever they change
  useEffect(() => {
    const cache = JSON.parse(
      localStorage.getItem("nflGuessesByDate") || "{}"
    ) as Record<string, Record<number, string>>;
    cache[selectedDate] = guesses;
    localStorage.setItem("nflGuessesByDate", JSON.stringify(cache));
  }, [guesses, selectedDate]);

  // 6️⃣ Persist submissions whenever they change
  useEffect(() => {
    const cache = JSON.parse(
      localStorage.getItem("nflSubmittedByDate") || "{}"
    ) as Record<string, Record<number, boolean>>;
    cache[selectedDate] = submitted;
    localStorage.setItem("nflSubmittedByDate", JSON.stringify(cache));
  }, [submitted, selectedDate]);

  // 7️⃣ Once all rows are answered, show score & record today's history
  useEffect(() => {
    if (rows.length && Object.keys(submitted).length === rows.length) {
      setShowScore(true);
      if (!confettiFired.current) {
        confettiFired.current = true;
        confetti({ particleCount: 100, spread: 60, origin: { y: 0.6 } });
      }
      const todayKey = getDateKey(new Date());
      if (selectedDate === todayKey) {
        const score = rows.reduce((sum, r, i) => {
          const g = (guesses[i + 1] || "").toLowerCase().trim();
          return r.players.some((p) => p.name.toLowerCase() === g)
            ? sum + POINTS[i]
            : sum;
        }, 0);
        const history = JSON.parse(
          localStorage.getItem("nflGameHistory") || "{}"
        ) as Record<string, HistoryEntry>;
        history[todayKey] = { score, elapsed };
        localStorage.setItem("nflGameHistory", JSON.stringify(history));
      }
    }
  }, [submitted, rows, guesses, elapsed, selectedDate]);

  // Handlers
  const handleGuess = (rowId: number, name: string) => {
    const isCorrect = rows[rowId - 1].players.some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    setGuesses((g) => ({ ...g, [rowId]: name }));
    setSubmitted((s) => ({ ...s, [rowId]: true }));
    if (isCorrect) {
      confetti({ particleCount: 50, spread: 60, origin: { y: 0.4 } });
    } else {
      setPulsingRows((p) => ({ ...p, [rowId]: true }));
      setTimeout(
        () => setPulsingRows((p) => ({ ...p, [rowId]: false })),
        1200
      );
    }
    setActiveDropdown(null);
  };

  const giveUp = () => {
    const all: Record<number, boolean> = {};
    rows.forEach((_, i) => (all[i + 1] = true));
    setSubmitted(all);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText("jerry.helmetsgame@gmail.com");
    alert("Email copied!");
  };

  const currentScore = rows.reduce((sum, r, i) => {
    const g = (guesses[i + 1] || "").toLowerCase().trim();
    return r.players.some((p) => p.name.toLowerCase() === g)
      ? sum + POINTS[i]
      : sum;
  }, 0);

  // Prepare history of prior days only
  const rawHistory = JSON.parse(
    localStorage.getItem("nflGameHistory") || "{}"
  ) as Record<string, HistoryEntry>;
  const todayKey = getDateKey(new Date());
  const prevDates = Object.keys(rawHistory).filter((d) => d !== todayKey);

  return (
    <>
      {/* Top Bar */}
      <div className="w-full bg-gray-100 py-2">
        <div className="max-w-3xl mx-auto flex justify-end space-x-2 px-6">
          <button
            onClick={() => setShowRules(true)}
            className="bg-blue-800 text-white px-2 py-1 rounded"
          >
            Rules
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="bg-blue-800 text-white px-2 py-1 rounded"
          >
            History
          </button>
          <button
            onClick={() => setShowFeedback(true)}
            className="bg-blue-800 text-white px-2 py-1 rounded"
          >
            Feedback
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto p-6">
        {/* Warning if no players */}
        {fullPool.length === 0 && (
          <p className="text-center text-red-500 mb-4">
            No players loaded. Please add players in the Admin panel.
          </p>
        )}

        {/* Header */}
        <div className="flex justify-center items-center mb-6">
          <span className="text-4xl mr-2">🏈</span>
          <h1 className="text-4xl font-bold">Helmets</h1>
        </div>

        {/* Score & Timer */}
        <p className="text-center mb-1">
          Date: {selectedDate} | Score: {currentScore} pts
        </p>
        <p className="text-center mb-6">
          <Clock className="inline mr-1" />
          {formatTime(elapsed)}
        </p>

        {/* Game Rows */}
        {rows.map((r, i) => {
          const id = i + 1;
          const guess = guesses[id] || "";
          const filter = filterTerms[id] || "";
          const isSubmitted = submitted[id];
          const isCorrect = r.players.some(
            (p) => p.name.toLowerCase() === guess.toLowerCase().trim()
          );

          return (
            <div
              key={id}
              className={[
                "p-4 mb-4 rounded-2xl shadow-md",
                isSubmitted
                  ? isCorrect
                    ? "bg-green-200 text-green-700"
                    : "bg-red-200 text-red-700"
                  : "bg-white",
                pulsingRows[id] ? "pulse-red" : "",
              ].join(" ")}
            >
              <div className="flex justify-center items-center mb-3 space-x-3">
                {r.path.map((node, j) => {
                  const fn = sanitizeNodeToFile(node);
                  const src = `/images/${encodeURIComponent(fn)}`;
                  const fallback = `/images/${encodeURIComponent(
                    node
                  )}.avif`;
                  return (
                    <React.Fragment key={j}>
                      <img
                        src={src}
                        alt={node}
                        className="w-20 h-20 object-contain"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (img.src.endsWith(fn)) img.src = fallback;
                          else img.style.display = "none";
                        }}
                      />
                      {j < r.path.length - 1 && (
                        <ArrowRight className="w-5 h-5" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {isSubmitted ? (
                <p className="text-center font-semibold">
                  {isCorrect
                    ? `✅ Correct! ${r.players
                        .map((p) => p.name)
                        .join(", ")}`
                    : `❌ ${guess}`}
                </p>
              ) : (
                <div className="relative max-w-md mx-auto">
                  <input
                    value={filter}
                    onChange={(e) => {
                      const v = e.target.value;
                      setFilterTerms((f) => ({ ...f, [id]: v }));
                      setActiveDropdown(v.trim() ? id : null);
                    }}
                    onBlur={() =>
                      setTimeout(() => setActiveDropdown(null), 150)
                    }
                    className="border p-2 w-full rounded-full"
                    placeholder="Type to search…"
                  />
                  {activeDropdown === id && (
                    <ul className="absolute bg-white border w-full mt-1 max-h-40 overflow-y-auto rounded-xl shadow z-10">
                      {fullPool
                        .filter((p) =>
                          p.name.toLowerCase().includes(filter.toLowerCase())
                        )
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((p, k) => (
                          <li
                            key={k}
                            onMouseDown={() => handleGuess(id, p.name)}
                            className="px-3 py-2 hover:bg-gray-100 cursor-pointer"
                          >
                            {p.name}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Give Up */}
        {!showScore && (
          <div className="text-center">
            <button
              onClick={giveUp}
              className="bg-blue-500 text-white px-6 py-2 rounded-full hover:bg-blue-600"
            >
              Give Up
            </button>
          </div>
        )}

        {/* Final Score Popup */}
        {showScore && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
            <div className="bg-white p-6 rounded-2xl max-w-lg w-full relative">
              <button
                onClick={() => setShowScore(false)}
                className="absolute top-3 right-3"
              >
                <X className="w-6 h-6" />
              </button>
              <h2 className="text-xl font-bold text-center mb-2">
                📅 {selectedDate}
              </h2>
              <p className="text-center mb-2">
                <Clock className="inline mr-1" />
                {formatTime(elapsed)}
              </p>
              <p className="text-center font-semibold mb-4">
                Final Score: {currentScore} pts
              </p>
              <div className="space-y-2">
                {rows.map((r, i) => {
                  const g = (guesses[i + 1] || "").toLowerCase().trim();
                  const ok = r.players.some(
                    (p) => p.name.toLowerCase() === g
                  );
                  return (
                    <div
                      key={i}
                      className={`px-3 py-2 rounded-full ${
                        ok
                          ? "bg-green-200 text-green-700"
                          : "bg-red-200 text-red-700"
                      }`}
                    >
                      {ok ? `+${POINTS[i]} pts` : `❌ Level ${i + 1}`}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Rules Popup */}
        {showRules && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
            <div className="bg-white p-6 rounded-2xl max-w-xl w-full relative">
              <button
                onClick={() => setShowRules(false)}
                className="absolute top-3 right-3"
              >
                <X className="w-6 h-6" />
              </button>
              <h2 className="text-2xl font-bold text-center mb-2">
                WELCOME TO HELMETS!
              </h2>
              <p className="italic text-center mb-4">
                Match each helmet path to an NFL player
              </p>
              <h3 className="text-xl font-semibold text-center mb-4">
                HOW TO PLAY
              </h3>
              <ul className="list-none space-y-3 px-4 mb-4">
                <li className="flex items-start">
                  <span className="mr-2">🏈</span>
                  <span>
                    For each level, pick one player whose draft college &
                    NFL team path matches the helmets (multiple may fit).
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">🏈</span>
                  <span>Only one guess per level.</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">🏈</span>
                  <span>
                    Players active or retired but drafted in 2000 or later.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">🏈</span>
                  <span>
                    Paths start with draft college, then list NFL teams in
                    order.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">🏈</span>
                  <span>5 levels: 1 (easiest) to 5 (hardest).</span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">🏈</span>
                  <span>
                    Correct answers score 100–500 pts by level; incorrect = 0
                    pts.
                  </span>
                </li>
                <li className="flex items-start">
                  <span className="mr-2">🏈</span>
                  <span>
                    “Give Up” ends the game and marks remaining levels
                    incorrect.
                  </span>
                </li>
              </ul>
              <p className="text-center font-semibold">Good Luck!</p>
            </div>
          </div>
        )}

        {/* History Popup */}
        {showHistory && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
            <div className="bg-white p-6 rounded-2xl max-w-sm w-full relative">
              <button
                onClick={() => setShowHistory(false)}
                className="absolute top-3 right-3"
              >
                <X className="w-6 h-6" />
              </button>
              <h2 className="text-xl font-bold text-center mb-4">
                Your History
              </h2>
              {prevDates.length === 0 ? (
                <p className="text-center text-gray-600">
                  No previous games yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {prevDates.map((d) => (
                    <li key={d}>
                      <button
                        onClick={() => {
                          setSelectedDate(d);
                          setShowHistory(false);
                        }}
                        className="w-full text-left bg-gray-100 hover:bg-gray-200 p-2 rounded"
                      >
                        {d}: {rawHistory[d].score} pts (
                        {formatTime(rawHistory[d].elapsed)})
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Feedback Popup */}
        {showFeedback && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-20">
            <div className="bg-white p-6 rounded-2xl max-w-sm w-full relative">
              <button
                onClick={() => setShowFeedback(false)}
                className="absolute top-3 right-3"
              >
                <X className="w-6 h-6" />
              </button>
              <h2 className="text-xl font-bold mb-4">Feedback</h2>
              <div className="flex items-center space-x-2">
                <Mail className="w-5 h-5 text-gray-600" />
                <span>jerry.helmetsgame@gmail.com</span>
                <button
                  onClick={copyEmail}
                  className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
