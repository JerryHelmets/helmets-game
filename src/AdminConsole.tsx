import React, { useEffect, useMemo, useState } from 'react';

/* ---------- PT helpers ---------- */
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
function toPTISO(date = new Date()) { const { y,m,d } = getPTDateParts(date); return `${y}-${m}-${d}`; }
const todayPTISO = () => toPTISO(new Date());

/* ---------- parsing helpers ---------- */
const sanitizePart = (s: string) => s.replace(/^"+|"+$/g, '').replace(/\s+/g, ' ').trim();
const parseLinesToKeys = (raw: string): { keys: string[]; pretty: string[][] } => {
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const pretty: string[][] = [];
  const keys: string[] = [];
  for (const ln of lines) {
    const parts = ln.split(',').map(sanitizePart).filter(Boolean);
    if (!parts.length) continue;
    pretty.push(parts);
    keys.push(parts.join('>'));
  }
  return { keys, pretty };
};

const LinePreview: React.FC<{ parts: string[] }> = ({ parts }) => (
  <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', fontSize:14 }}>
    {parts.map((p,i)=>(
      <React.Fragment key={`${p}-${i}`}>
        <span>{p}</span>
        {i < parts.length-1 && <span style={{ opacity:.7 }}>→</span>}
      </React.Fragment>
    ))}
  </div>
);

const AdminConsole: React.FC = () => {
  /* ---------- auth gate ---------- */
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  async function validateToken(t: string): Promise<boolean> {
    try {
      const res = await fetch('/api/admin/check', {
        method: 'GET',
        headers: { authorization: `Bearer ${t}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Re-validate any stored token on load
  useEffect(() => {
    (async () => {
      const saved = sessionStorage.getItem('adminToken') || '';
      if (!saved) { setChecking(false); return; }
      const ok = await validateToken(saved);
      if (ok) { setToken(saved); setAuthed(true); setAuthError(null); }
      else { sessionStorage.removeItem('adminToken'); setAuthed(false); setAuthError(null); }
      setChecking(false);
    })();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const t = token.trim();
    if (!t) { setAuthError('Enter your admin token.'); return; }
    const ok = await validateToken(t);
    if (!ok) { setAuthError('Invalid token.'); setAuthed(false); return; }
    sessionStorage.setItem('adminToken', t);
    setAuthed(true);
  };

  const handleLogout = () => {
    sessionStorage.removeItem('adminToken');
    setToken('');
    setAuthed(false);
    setAuthError(null);
  };

  /* ---------- form state ---------- */
  const [dateISO, setDateISO] = useState(todayPTISO());
  const [pathsText, setPathsText] = useState('');
  const [confirmToken, setConfirmToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok:boolean; msg:string } | null>(null);

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
          'authorization': `Bearer ${token.trim()}`
        },
        body: JSON.stringify({ dateISO, keys }),
      });
      if (!res.ok) {
        const text = await res.text();
        setResult({ ok:false, msg: text || `HTTP ${res.status}` });
      } else {
        setResult({ ok:true, msg:'✅ Override saved. This date is now locked to the supplied paths.' });
        setConfirmToken('');
      }
    } catch (err:any) {
      setResult({ ok:false, msg: String(err?.message || err) });
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------- UI ---------- */
  return (
    <div style={{
      maxWidth: 760, margin: '40px auto', padding: '16px',
      fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
      color: '#111'
    }}>
      <h1 style={{ margin:'0 0 8px', textAlign:'center' }}>HELMETS — Admin</h1>

      {checking ? (
        <div style={{ textAlign:'center', padding:'24px 0', opacity:.7 }}>Checking access…</div>
      ) : !authed ? (
        <form onSubmit={handleLogin}
              style={{ margin:'16px auto', maxWidth:420, background:'#fff', padding:16, borderRadius:12, boxShadow:'0 8px 24px rgba(0,0,0,.12)' }}>
          <h3 style={{ marginTop:0 }}>Enter Admin Token</h3>
          <p style={{ marginTop:0, opacity:.8 }}>Access is server-verified. The token is not stored on the server.</p>
          <input
            type="password"
            placeholder="Admin token"
            value={token}
            onChange={(e)=>setToken(e.target.value)}
            style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1px solid #ccc' }}
          />
          {authError && <div style={{ color:'#dc3545', marginTop:8 }}>{authError}</div>}
          <button type="submit"
                  style={{ marginTop:12, padding:'10px 16px', borderRadius:10, border:'none', background:'#2e6bff', color:'#fff', fontWeight:700, cursor:'pointer' }}>
            Unlock
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmit}
              style={{ margin:'16px auto', background:'#fff', padding:16, borderRadius:12, boxShadow:'0 8px 24px rgba(0,0,0,.12)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <h3 style={{ marginTop:0 }}>Override a Day’s Game</h3>
            <button type="button" onClick={handleLogout}
                    style={{ background:'transparent', border:'1px solid #ccc', padding:'6px 10px', borderRadius:8, cursor:'pointer' }}>
              Log out
            </button>
          </div>

          <div style={{ display:'grid', gap:10 }}>
            <label>
              <div style={{ fontWeight:700, marginBottom:4 }}>Date (PT):</div>
              <input
                type="date"
                value={dateISO}
                onChange={(e)=>setDateISO(e.target.value)}
                style={{ padding:'10px 12px', borderRadius:10, border:'1px solid #ccc' }}
              />
            </label>

            <label>
              <div style={{ fontWeight:700, marginBottom:4 }}>Paths (one per line, helmets separated by commas)</div>
              <textarea
                value={pathsText}
                onChange={(e)=>setPathsText(e.target.value)}
                rows={8}
                placeholder={`Example (5 lines for 5 levels):\nGeorgia Bulldogs, Detroit Lions, Los Angeles Rams\nLSU Tigers, New York Giants\n...`}
                style={{ width:'100%', padding:12, borderRadius:10, border:'1px solid #ccc', fontFamily:'inherit' }}
              />
              <div style={{ marginTop:6, fontSize:12, opacity:.8 }}>
                Each line becomes a key by joining with <code>&gt;</code>. Lines with no text are ignored.
              </div>
            </label>

            {pretty.length > 0 && (
              <div style={{ background:'#f7faff', border:'1px solid #cfe0ff', padding:12, borderRadius:10 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>Preview ({pretty.length} line{pretty.length===1?'':'s'})</div>
                <div style={{ display:'grid', gap:6 }}>
                  {pretty.map((parts,i)=>(
                    <div key={i} style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontWeight:700, minWidth:56 }}>Level {i+1}</span>
                      <LinePreview parts={parts} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label>
              <div style={{ fontWeight:700, marginBottom:4 }}>Confirm Admin Token</div>
              <input
                type="password"
                placeholder="Re-enter admin token to confirm"
                value={confirmToken}
                onChange={(e)=>setConfirmToken(e.target.value)}
                style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1px solid #ccc' }}
              />
            </label>

            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  padding:'10px 16px',
                  borderRadius:10,
                  border:'none',
                  background: canSubmit ? '#2e6bff' : '#a7b8ff',
                  color:'#fff',
                  fontWeight:800,
                  cursor: canSubmit ? 'pointer' : 'not-allowed'
                }}
              >
                {submitting ? 'Saving…' : 'Save Override'}
              </button>
              <div style={{ fontSize:12, opacity:.8 }}>
                Sending {keys.length} key{keys.length===1?'':'s'} to <code>/api/admin/set-game</code>
              </div>
            </div>

            {result && (
              <div style={{
                marginTop:6,
                padding:10,
                borderRadius:10,
                background: result.ok ? '#e6ffe6' : '#ffe6e6',
                border: `1px solid ${result.ok ? '#28a745' : '#dc3545'}`
              }}>
                {result.msg}
              </div>
            )}
          </div>
        </form>
      )}

      <div style={{ marginTop:20, textAlign:'center', opacity:.7, fontSize:12 }}>
        Tip: Each line = one level. You can override fewer than 5; missing levels will use the normal picker.
      </div>
    </div>
  );
};

export default AdminConsole;
