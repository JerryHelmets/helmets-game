// src/AdminPanel.tsx
import React, { useState } from "react";
import Papa from "papaparse";

export interface Player {
  name: string;
  college: string;
  position: string;
  teams: string[];
  difficulty: number;    // you can still store it, but GameComponent will ignore it
  path: string[];
  pathLevel: number;
}

export default function AdminPanel() {
  const [players, setPlayers] = useState<Player[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log("Players file selected:", file);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        console.log("Players parse results:", results);
        const rows = results.data as Papa.ParseResult<Record<string, any>>["data"];

        const imported: Player[] = rows.map((row) => {
          // ----- build the path array -----
          const rawPath = row["path"] ?? row["Path"] ?? "";
          const pathArr =
            typeof rawPath === "string"
              ? rawPath.split(",").map((s) => s.trim()).filter(Boolean)
              : Array.isArray(rawPath)
              ? rawPath
              : [];

          // ----- parse the pathLevel column -----
          // find any header that equals "path level" or "pathLevel"
          const lvlKey = Object.keys(row).find(
            (k) =>
              k.trim().toLowerCase() === "path level" ||
              k.trim().toLowerCase() === "pathlevel"
          );
          let pathLevel = 1;
          if (lvlKey) {
            const parsed = parseInt(row[lvlKey], 10);
            if (!isNaN(parsed)) pathLevel = parsed;
          }

          return {
            name: row["name"] || row["Name"] || "",
            college: row["college"] || row["College"] || "",
            position: row["position"] || row["Position"] || "",
            teams:
              typeof row["teams"] === "string"
                ? row["teams"].split(",").map((s) => s.trim())
                : [],
            difficulty: Number(row["difficulty"] ?? row["Difficulty"] ?? 1),
            path: pathArr,
            pathLevel,
          };
        });

        console.log("Imported players:", imported);
        setPlayers(imported);
        // write into localStorage so GameComponent can load it
        localStorage.setItem("nflFullPlayerPool", JSON.stringify(imported));
      },
      error: (err) => {
        console.error("CSV parse error:", err);
      },
    });
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">Admin Panel</h2>
      <div className="mb-4">
        <input
          type="file"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="border p-2"
        />
      </div>
      {players.length > 0 && (
        <div>
          <h3 className="font-semibold mb-2">Currently Loaded Players:</h3>
          <ul className="list-disc list-inside">
            {players.map((p, i) => (
              <li key={i}>
                {p.name} &bullet; Path Level {p.pathLevel} &bullet; Path:{" "}
                {p.path.join(" → ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
