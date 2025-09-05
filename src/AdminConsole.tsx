import React from "react";

/* PT date helper */
function getPTISO(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const dd = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${dd}`;
}

type Mode = "csv" | "keys" | "names";

const LS_ADMIN_TOKEN = "helmets-admin-token";

const AdminConsole: React.FC = () => {
  const [token, setToken] = React.useState<string>(() => localStorage.getItem(LS_ADMIN_TOKEN) || "");
  const [dateISO, setDateISO] = React.useState(getPTISO());
  const [mode, setMode] = React.useState<Mode>("csv");

  const [keysText, setKeysText] = React.useState("");
  const [namesText, setNamesText] = React.useState("");

  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<any>(null);
  const [preview, setPreview] = React.useState<any>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    localStorage.setItem(LS_ADMIN_TOKEN, token || "");
  }, [token]);

  function parseFiveLines(raw: string) {
    return raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function runAction() {
    setError(null);
    setResult(null);
    if (!token) {
      setError("Enter ADMIN_TOKEN.");
      return;
    }
    try {
      setBusy(true);
      let body: any = { date: dateISO };

      if (mode === "csv") {
        body.fromCsv = true;
      } else if (mode === "keys") {
        const arr = parseFiveLines(keysText);
        if (arr.length !== 5) throw new Error("Provide exactly 5 path keys (one per line).");
        body.keys = arr;
      } else {
        const arr = parseFiveLines(namesText);
        if (arr.length !== 5) throw new Error("Provide exactly 5 player names (one per line).");
        body.names = arr;
      }

      const res = await fetch("/api/admin/set-game", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setResult(json);
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusy(false);
    }
  }

  async function previewDaily() {
    setPreview(null);
    try {
      const url = `/api/daily?date=${dateISO}&_=${Date.now()}`;
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      setPreview(json);
    } catch (e) {
      setPreview({ error: "failed to load /api/daily" });
    }
  }

  
  return (
    <div style={{ maxWidth: 720, margin: "24px auto", padding: "12px" }}>
      <h2 style={{ marginBottom: 8 }}>Admin Console — Helmets</h2>
      <p style={{ marginTop: 0 }}>
        Use this to <strong>re-pick</strong> from current <code>players.csv</code> or to <strong>override</strong> a day’s 5 paths.
      </p>

      <div style={{ margin: "12px 0 8px" }}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>Admin Token</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="ADMIN_TOKEN"
          className="guess-input-field"
          style={{ width: "100%", maxWidth: 360 }}
        />
      </div>

      <div style={{ margin: "12px 0 8px" }}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>Date (PT)</label>
        <input
          type="date"
          value={dateISO}
          onChange={(e) => setDateISO(e.target.value)}
          className="guess-input-field"
          style={{ width: 200 }}
        />
      </div>

      <div style={{ margin: "12px 0 8px" }}>
        <label style={{ display: "block", fontWeight: 700, marginBottom: 8 }}>Mode</label>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label><input type="radio" name="mode" checked={mode === "csv"} onChange={() => setMode("csv")} /> From CSV</label>
          <label><input type="radio" name="mode" checked={mode === "keys"} onChange={() => setMode("keys")} /> Set 5 Path Keys</label>
          <label><input type="radio" name="mode" checked={mode === "names"} onChange={() => setMode("names")} /> Set 5 Player Names</label>
        </div>
      </div>

      {mode === "keys" && (
        <div style={{ margin: "8px 0" }}>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>5 Path Keys (one per line)</label>
          <textarea
            value={keysText}
            onChange={(e) => setKeysText(e.target.value)}
            rows={6}
            placeholder={`Example:\nPittsburgh Steelers>Las Vegas Raiders\nChicago Bears>Cleveland Browns\nIndianapolis Colts>New York Jets\nSeattle Seahawks>Green Bay Packers\nAlabama Crimson Tide>Buffalo Bills`}
            className="guess-input-field"
            style={{ width: "100%", maxWidth: 660, fontFamily: "monospace" }}
          />
        </div>
      )}

      {mode === "names" && (
        <div style={{ margin: "8px 0" }}>
          <label style={{ display: "block", fontWeight: 700, marginBottom: 4 }}>5 Player Names (one per line)</label>
          <textarea
            value={namesText}
            onChange={(e) => setNamesText(e.target.value)}
            rows={6}
            placeholder={`Example:\nTom Brady\nMarshawn Lynch\n...`}
            className="guess-input-field"
            style={{ width: "100%", maxWidth: 660, fontFamily: "monospace" }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button onClick={runAction} className="primary-button" disabled={busy}>
          {busy ? "Working..." : mode === "csv" ? "Re-pick From CSV" : "Apply Override"}
        </button>
        <button onClick={previewDaily} className="secondary-button">
          Preview /api/daily
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, color: "#b91c1c", fontWeight: 700 }}>
          Error: {error}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Result</div>
          <pre style={{ background: "#f7f7f7", padding: 10, borderRadius: 8, overflow: "auto" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}

      {preview && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview</div>
          <pre style={{ background: "#f7f7f7", padding: 10, borderRadius: 8, overflow: "auto" }}>
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};

export default AdminConsole;
