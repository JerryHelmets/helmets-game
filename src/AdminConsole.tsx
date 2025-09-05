import React, { useEffect, useMemo, useState } from 'react';

/** ---------- PT helpers (mirror your game’s behavior) ---------- */
function getPTDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const d = parts.find((p) => p.type === 'day')!.value;
  return { y, m, d };
}
function toPTISO(date = new Date()) {
  const { y, m, d } = getPTDateParts(date);
  return `${y}-${m}-${d}`;
}
const todayPTISO = () => toPTISO(new Date());

/** ---------- tiny helpers ---------- */
const sanitizePart = (s: string) =>
  s
    .replace(/^"+|"+$/g, '')     // strip stray quotes
    .replace(/\s+/g, ' ')        // collapse spaces
    .trim();

const parseLinesToKeys = (raw: string): { keys: string[]; pretty: string[][] } => {
  const lines = raw
    .split(/\r?\n/)
    .map((ln) => ln.trim())
    .filter(Boolean);

  const pretty: string[][] = [];
  const keys: string[] = [];

  for (const ln of lines) {
    const parts = ln.split(',').map(sanitizePart).filter(Boolean);
    if (!parts.length) continue;
    pretty.push(parts);
    keys.push(parts.join('>')); // this matches how daily keys are built in your API
  }
  return { keys, pretty };
};

const LinePreview: React.FC<{ parts: string[] }> = ({ parts }) => {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 14 }}>
      {parts.map((p, i) => (
        <React.Fragment key={`${p}-${i}`}>
          <span>{p}</span>
          {i < parts.length - 1 && <span style={{ opacity: 0.7 }}>→</span>}
        </React.Fragment>
      ))}
    </div>
  );
};

const AdminConsole: React.FC = () => {
  /** ---------- gate with token first ---------- */
  const [token, setToken] = useState<string>('');
  const [authed, setAuthed] = useState<boolean>(false);

  useEffect(() => {
    const t = sessionStorage.getItem('adminToken') || '';
    if (t) {
      setToken(t);
      setAuthed(true);
    }
  }, []);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    // UI gate; the API will still verify the token on submit.
    sessionStorage.setItem('adminToken', token.trim());
    setAuthed(true);
  };

  /** ---------- form state ---------- */
  const [dateISO, setDateISO] = useState<string>(todayPTISO());
  const [pathsText, setPathsText] = useState<string>('');
  const [confirmToken, setConfirmToken] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const { keys, pretty } = useMemo(() => parseLinesToKeys(pathsText), [pathsText]);

  const canSubmit =
    authed &&
    !submitting &&
    token.trim().length > 0 &&
    confirmToken.trim().length > 0 &&
    token.trim() === confirmToken.trim() &&
    dateISO &&
    keys.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/set-game', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token.trim()}`,
        },
        body: JSON.stringify({ dateISO, keys }),
      });
      if (!res.ok) {
        const text = await res.text();
        setResult({ ok: false, msg: text || `HTTP ${res.status}` });
      } else {
        setResult({ ok: true, msg: '✅ Override saved. This date is now locked to the supplied paths.' });
        setConfirmToken('');
      }
    } catch (err: any) {
      setResult({ ok: false, msg: String(err?.message || err) });
    } finally {
      setSubmitting(false);
    }
  };

  /** ---------- UI ---------- */
  return (
    <div style={{
      maxWidth: 760,
      margin: '40px auto',
      padding: '16px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      color: '#111',
    }}>
      <h1 style={{ margin: '0 0 8px', textAlign: 'center' }}>HELMETS — Admin</h1>
      {!authed ? (
        <form onSubmit={handleLogin}
              style={{ margin: '16px auto', maxWidth: 420, background: '#fff', padding: 16, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
          <h3 style={{ marginTop: 0 }}>Enter Admin Token</h3>
          <p style={{ marginTop: 0, opacity: .8 }}>Access is gated. Token is not stored server-side; UI unlocks and API still verifies on save.</p>
          <input
            type="password"
            placeholder="Admin token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ccc' }}
          />
          <button type="submit"
                  style={{ marginTop: 12, padding: '10px 16px', borderRadius: 10, border: 'none', background: '#2e6bff', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
            Unlock
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit}
              style={{ margin: '16px auto', background: '#fff', padding: 16, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,.12)' }}>
          <h3 style={{ marginTop: 0 }}>Override a Day’s Game</h3>

          <div style={{ display: 'grid', gap: 10 }}>
            <label>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Date (PT):</div>
              <input
                type="date"
                value={dateISO}
                onChange={(e) => setDateISO(e.target.value)}
                style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid #ccc' }}
              />
            </label>

            <label>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Paths (one per line, helmets separated by commas)</div>
              <textarea
                value={pathsText}
                onChange={(e) => setPathsText(e.target.value)}
                rows={8}
                placeholder={`Example (5 lines for 5 levels):\nGeorgia Bulldogs, Detroit Lions, Los Angeles Rams\nLSU Tigers, New York Giants\n...`}
                style={{ width: '100%', padding: 12, borderRadius: 10, border: '1px solid #ccc', fontFamily: 'inherit' }}
              />
              <div style={{ marginTop: 6, fontSize: 12, opacity: .8 }}>
                We’ll convert each line into a path key by joining with <code>&gt;</code> (this matches the API). Lines with no text are ignored.
              </div>
            </label>

            {/* Live preview */}
            {pretty.length > 0 && (
              <div style={{ background: '#f7faff', border: '1px solid #cfe0ff', padding: 12, borderRadius: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Preview ({pretty.length} line{pretty.length === 1 ? '' : 's'})</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {pretty.map((parts, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 700, minWidth: 56 }}>Level {i + 1}</span>
                      <LinePreview parts={parts} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Confirm Admin Token</div>
              <input
                type="password"
                placeholder="Re-enter admin token to confirm"
                value={confirmToken}
                onChange={(e) => setConfirmToken(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #ccc' }}
              />
            </label>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  padding: '10px 16px',
                  borderRadius: 10,
                  border: 'none',
                  background: canSubmit ? '#2e6bff' : '#a7b8ff',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: canSubmit ? 'pointer' : 'not-allowed'
                }}
              >
                {submitting ? 'Saving…' : 'Save Override'}
              </button>
              <div style={{ fontSize: 12, opacity: .8 }}>
                Sending {keys.length} key{keys.length === 1 ? '' : 's'} to <code>/api/admin/set-game</code>
              </div>
            </div>

            {result && (
              <div style={{
                marginTop: 6,
                padding: 10,
                borderRadius: 10,
                background: result.ok ? '#e6ffe6' : '#ffe6e6',
                border: `1px solid ${result.ok ? '#28a745' : '#dc3545'}`
              }}>
                {result.msg}
              </div>
            )}
          </div>
        </form>
      )}

      <div style={{ marginTop: 20, textAlign: 'center', opacity: .7, fontSize: 12 }}>
        Tip: Each line = one level. You can override fewer than 5 levels; missing ones will follow the normal daily generation.
      </div>
    </div>
  );
};

export default AdminConsole;
