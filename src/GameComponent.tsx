import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import Papa from 'papaparse';
import './GameComponent.css';

/* ===== Types ===== */
interface PlayerPath {
  name: string;
  path: string[];
  path_level: number;
  position?: string;
  difficulty?: number;
}
interface RawPlayerRow {
  name: string;
  college: string;
  position: string;
  teams: string;
  difficulty: string;
  path: string;
  path_level: string;
}
interface Guess { guess: string; correct: boolean; }
type StoredGuesses = { date: string; guesses: (Guess | null)[]; score: number; awardedPoints: number[] };

const LS_GUESSES = 'helmets-guesses';
const LS_HISTORY = 'helmets-history';
const LS_STARTED = 'helmets-started';
const LS_BASE_PREFIX = 'helmets-basepoints-';

const REVEAL_HOLD_MS = 2000;
const FINAL_REVEAL_HOLD_MS = 250;     // half again shorter for last level
const MAX_BASE_POINTS = 100;
const TICK_MS = 1000;
const COUNTDOWN_START_DELAY_MS = 400;  // a touch more delay for first level appear

/* ====== Pacific Time helpers ====== */
function getPTDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const y = parts.find(p=>p.type==='year')!.value;
  const m = parts.find(p=>p.type==='month')!.value;
  const d = parts.find(p=>p.type==='day')!.value;
  return { y, m, d };
}
function toPTISO(date: Date){ const {y,m,d}=getPTDateParts(date); return `${y}-${m}-${d}`; }
function todayPTISO(){ return toPTISO(new Date()); }
function isoToMDYYYY(iso: string){ const [y,m,d]=iso.split('-'); return `${parseInt(m,10)}/${parseInt(d,10)}/${y}`; }
function isoToMDYY(iso: string){ const [y,m,d]=iso.split('-'); return `${parseInt(m,10)}/${parseInt(d,10)}/${y.slice(-2)}`; }
function getLastNDatesPT(n: number) {
  const base = new Date(); const out: string[] = [];
  for (let i=0;i<n;i++){ const d=new Date(base); d.setDate(base.getDate()-i); out.push(toPTISO(d)); }
  return out;
}

/* ====== Daily selection ====== */
function seededRandom(seed: number){ return ()=>{ const x=Math.sin(seed++)*10000; return x-Math.floor(x); }; }
function pickDailyPaths(players: PlayerPath[], dateISO: string){
  const seed = parseInt(dateISO.replace(/-/g,''),10);
  const rng = seededRandom(seed);
  const buckets: Record<number, Map<string, PlayerPath>> = {1:new Map(),2:new Map(),3:new Map(),4:new Map(),5:new Map()};
  players.forEach(p=>{
    if (p.path_level>=1 && p.path_level<=5){
      const k=p.path.join('>');
      if (!buckets[p.path_level].has(k)) buckets[p.path_level].set(k,p);
    }
  });
  const sel: PlayerPath[] = [];
  for (let lvl=1; lvl<=5; lvl++){
    const a = Array.from(buckets[lvl].values());
    if (a.length) sel.push(a[Math.floor(rng()*a.length)]);
  }
  return sel;
}
const isComplete = (guesses: (Guess|null)[], total: number)=> guesses.length===total && guesses.every(Boolean);

/* ===== started flags ===== */
function getStartedMap(){ try { return JSON.parse(localStorage.getItem(LS_STARTED) || '{}'); } catch { return {}; } }
function setStartedFor(date: string, v: boolean){ const m=getStartedMap(); m[date]=v; localStorage.setItem(LS_STARTED, JSON.stringify(m)); }
function getStartedFor(date: string){ const m=getStartedMap(); return !!m[date]; }

/* ===== score emoji ranges ===== */
function scoreEmojis(total: number): string {
  if (total < 100) return '🫵🤣🫵';
  if (total < 200) return '💩';
  if (total < 300) return '🤡';
  if (total < 400) return '😐';
  if (total < 500) return '🤢';
  if (total < 600) return '😌';
  if (total < 700) return '👊';
  if (total < 800) return '👀';
  if (total < 900) return '👏';
  if (total < 1000) return '📈';
  if (total < 1100) return '🔥';
  if (total < 1200) return '🎯';
  if (total < 1300) return '🥇';
  if (total < 1400) return '🚀';
  return '🏆';
}

const GameComponent: React.FC = () => {
  /* ===== Routing / date ===== */
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const dateParam = params.get('date');
  const debug = params.get('debug') === '1';
  const todayPT = todayPTISO();
  const gameDate = dateParam || todayPT;
  const gameDateHeader = isoToMDYYYY(gameDate);
  const gameDateMMDDYY = isoToMDYY(gameDate);

  /* ===== State ===== */
  const [players, setPlayers] = useState<PlayerPath[]>([]);
  const [guesses, setGuesses] = useState<(Guess|null)[]>([]);
  const [filteredSuggestions, setFilteredSuggestions] = useState<{name:string;position?:string}[][]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const prevScoreRef = useRef(0);
  const [finalDisplayScore, setFinalDisplayScore] = useState(0);

  const [showPopup, setShowPopup] = useState(false);
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revealedAnswers, setRevealedAnswers] = useState<boolean[]>([]);
  const [gameOver, setGameOver] = useState(false);
  const [confettiFired, setConfettiFired] = useState(false);
  const [started, setStarted] = useState<boolean>(() => getStartedFor(gameDate));
  const [activeLevel, setActiveLevel] = useState(0);
  const [showRules, setShowRules] = useState(false);
  const [rulesOpenedManually, setRulesOpenedManually] = useState(false);

  const [freezeActiveAfterAnswer, setFreezeActiveAfterAnswer] = useState<number | null>(null);

  const [basePointsLeft, setBasePointsLeft] = useState<number[]>([]);
  const [awardedPoints, setAwardedPoints] = useState<number[]>([]);
  const [hintShown, setHintShown] = useState<boolean[]>([]);

  const [communityPct, setCommunityPct] = useState<number[]>([]);
  const [communitySource, setCommunitySource] = useState<'api'|'json'|'local'>('local');

  const inputRefs = useRef<(HTMLInputElement|null)[]>([]);
  const levelTimerRef = useRef<number|null>(null);
  const levelDelayRef = useRef<number|null>(null);

  /* ===== viewport / scroll lock ===== */
  useEffect(() => {
    const setH = () => document.documentElement.style.setProperty('--app-height', `${window.innerHeight}px`);
    setH(); const onOri = () => setTimeout(setH, 250);
    window.addEventListener('orientationchange', onOri);
    return () => window.removeEventListener('orientationchange', onOri);
  }, []);
  useEffect(() => {
    const lock = (started && !gameOver) || showPopup || showRules || showHistory || showFeedback;
    const oh = document.documentElement.style.overflow, ob = document.body.style.overflow;
    if (lock){ document.documentElement.style.overflow='hidden'; document.body.style.overflow='hidden'; }
    else { document.documentElement.style.overflow=''; document.body.style.overflow=''; }
    return () => { document.documentElement.style.overflow=oh; document.body.style.overflow=ob; };
  }, [started, gameOver, showPopup, showRules, showHistory, showFeedback]);

  /* ===== Load players (disable worker to avoid CSP) ===== */
  useEffect(() => {
    let cancelled=false;
    (async ()=>{
      try {
        const res = await fetch('/data/players.csv');
        const text = await res.text();
        const parsed = Papa.parse(text, { header: true, worker: false });
        const rows = parsed.data as RawPlayerRow[];
        const arr: PlayerPath[] = [];
        rows.forEach(r=>{
          const name=r.name?.trim(), pathStr=r.path?.trim(), lvl=r.path_level?.trim();
          if (!name || !pathStr || !lvl) return;
          const level = parseInt(lvl,10); if (Number.isNaN(level)) return;
          const difficulty = r.difficulty ? parseInt(r.difficulty,10) : undefined;
          const position = r.position?.trim() || undefined;
          arr.push({ name, path: pathStr.split(',').map(s=>s.trim()), path_level: level, position, difficulty });
        });
        if (!cancelled) setPlayers(arr);
      } catch (e){ console.error('❌ CSV load', e); }
    })();
    return ()=>{ cancelled=true; };
  }, []);

  /* ===== Derived: daily paths + answer details ===== */
  const dailyPaths = useMemo(()=> pickDailyPaths(players, gameDate), [players, gameDate]);
  const answerDetails = useMemo(()=>{
    return dailyPaths.map(target=>{
      const samePath = players.filter(p=> p.path.join('>')===target.path.join('>'));
      // sort by difficulty asc (undefined -> Infinity)
      return samePath
        .slice()
        .sort((a,b)=> (a.difficulty??1e9) - (b.difficulty??1e9))
        .map(p=>({ name:p.name, position:p.position, difficulty:p.difficulty }));
    });
  }, [players, dailyPaths]);

  /* ===== Init for day ===== */
  useEffect(() => {
    if (!dailyPaths.length) return;

    let g:(Guess|null)[] = Array(dailyPaths.length).fill(null);
    let s=0;
    let ap:number[] = Array(dailyPaths.length).fill(0);

    if (dateParam){
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      const data = history[gameDate];
      if (data){ g=data.guesses||g; s=data.score||0; ap=Array.isArray(data.awardedPoints)?data.awardedPoints:ap; }
      setGuesses(g); setScore(s); setAwardedPoints(ap);
      const startedFlag = getStartedFor(gameDate) || g.some(Boolean);
      const complete = isComplete(g, dailyPaths.length);
      setStarted(startedFlag); setGameOver(complete);
      setShowPopup(complete && !popupDismissed);
      setShowRules(!startedFlag && !complete); setRulesOpenedManually(false);
      const firstNull = g.findIndex(x=>!x); setActiveLevel(firstNull===-1 ? dailyPaths.length-1 : firstNull);
    } else {
      const raw = localStorage.getItem(LS_GUESSES);
      if (raw){
        try{
          const parsed = JSON.parse(raw) as Partial<StoredGuesses>;
          if (parsed.date===gameDate && Array.isArray(parsed.guesses) && parsed.guesses.length===dailyPaths.length){
            g = parsed.guesses as (Guess|null)[]; s = parsed.score ?? 0; ap = Array.isArray(parsed.awardedPoints)?parsed.awardedPoints:ap;
          }
        } catch{}
      }
      setGuesses(g); setScore(s); setAwardedPoints(ap);
      const startedFlag = getStartedFor(gameDate) || g.some(Boolean);
      setStarted(startedFlag);
      const firstNull = g.findIndex(x=>!x); setActiveLevel(firstNull===-1 ? dailyPaths.length-1 : firstNull);
      const complete = isComplete(g, dailyPaths.length);
      setGameOver(complete); setShowPopup(complete && !popupDismissed);
      setShowRules(!startedFlag && !complete); setRulesOpenedManually(false);
    }

    // restore base points & hints
    let base = Array(dailyPaths.length).fill(MAX_BASE_POINTS);
    const savedBase = localStorage.getItem(LS_BASE_PREFIX+gameDate);
    if (savedBase){
      try{
        const parsed = JSON.parse(savedBase);
        if (Array.isArray(parsed)) base = base.map((v,i)=> (typeof parsed[i]==='number' ? Math.max(0, Math.min(100, parsed[i])) : v));
      } catch {}
    }
    setBasePointsLeft(base);
    setHintShown(Array(dailyPaths.length).fill(false));

    setRevealedAnswers(Array(dailyPaths.length).fill(false));
    setFilteredSuggestions(Array(dailyPaths.length).fill([]));
    setPopupDismissed(false);
    setConfettiFired(false);

    setDisplayScore(s);
    prevScoreRef.current = s;
  }, [dailyPaths, gameDate, dateParam]);

  /* ===== Persist state for the day ===== */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
    history[gameDate] = { guesses, score, awardedPoints };
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
    if (!dateParam){
      const payload: StoredGuesses = { date: gameDate, guesses, score, awardedPoints };
      localStorage.setItem(LS_GUESSES, JSON.stringify(payload));
    }
  }, [guesses, score, awardedPoints, gameDate, dailyPaths.length, dateParam]);

  /* Persist base points countdown */
  useEffect(() => {
    if (!dailyPaths.length) return;
    localStorage.setItem(LS_BASE_PREFIX+gameDate, JSON.stringify(basePointsLeft));
  }, [basePointsLeft, dailyPaths.length, gameDate]);

  /* ===== Score flash + count-up (header) ===== */
  useEffect(() => {
    const el = document.querySelector('.score-number'); if (!el) return;
    el.classList.add('score-flash'); const t=window.setTimeout(()=>el.classList.remove('score-flash'),600);
    return ()=> window.clearTimeout(t);
  }, [score]);
  useEffect(() => {
    const start=prevScoreRef.current, end=score; if (start===end){ setDisplayScore(end); return; }
    let raf=0; const duration=900; const t0=performance.now();
    const ease=(p:number)=> (p<0.5? 2*p*p : -1+(4-2*p)*p);
    const step=(t:number)=>{ const p=Math.min(1,(t-t0)/duration); const val=Math.round(start+(end-start)*ease(p)); setDisplayScore(val); if(p<1) raf=requestAnimationFrame(step); else prevScoreRef.current=end; };
    raf=requestAnimationFrame(step); return ()=> cancelAnimationFrame(raf);
  }, [score]);

  /* ===== Final popup count-up ===== */
  useEffect(() => {
    if (!showPopup){ setFinalDisplayScore(0); return; }
    let raf=0; const start=0, end=score, duration=1800; const t0=performance.now();
    const ease=(p:number)=> (p<0.5? 2*p*p : -1+(4-2*p)*p);
    const step=(t:number)=>{ const p=Math.min(1,(t-t0)/duration); const val=Math.round(start+(end-start)*ease(p)); setFinalDisplayScore(val); if(p<1) raf=requestAnimationFrame(step); };
    raf=requestAnimationFrame(step); return ()=> cancelAnimationFrame(raf);
  }, [showPopup, score]);

  /* ===== Completion respecting hold ===== */
  useEffect(() => {
    if (!dailyPaths.length) return;
    const complete = guesses.length===dailyPaths.length && guesses.every(Boolean);
    if (complete){
      if (freezeActiveAfterAnswer!==null) return;
      setGameOver(true);
      if (!showPopup && !popupDismissed) setShowPopup(true);
    } else if (gameOver){ setGameOver(false); }
  }, [guesses, dailyPaths.length, freezeActiveAfterAnswer, showPopup, popupDismissed, gameOver]);

  /* ===== Focus input ===== */
  useEffect(() => {
    if (!started || gameOver) return;
    if (activeLevel>=0){
      const el = inputRefs.current[activeLevel];
      if (el){ try{ (el as any).focus({preventScroll:true}); }catch{ el.focus(); window.scrollTo(0,0);} }
    }
  }, [activeLevel, started, gameOver]);

  /* ===== Per-level countdown (persisted) + auto-hint at 50 ===== */
  useEffect(() => {
    if (!started || gameOver) return;
    const idx = activeLevel;
    if (idx<0 || idx>=dailyPaths.length) return;
    if (guesses[idx]) return;
    if (freezeActiveAfterAnswer!==null) return;

    setBasePointsLeft(prev=>{
      const next = prev.length===dailyPaths.length? [...prev] : Array(dailyPaths.length).fill(MAX_BASE_POINTS);
      if (next[idx]==null) next[idx]=MAX_BASE_POINTS; return next;
    });

    levelDelayRef.current = window.setTimeout(()=>{
      levelTimerRef.current = window.setInterval(()=>{
        setBasePointsLeft(prev=>{
          const n=[...prev]; const cur=n[idx] ?? MAX_BASE_POINTS; const newVal = Math.max(0, cur-1);
          n[idx]=newVal;
          // Auto-reveal hint at 50
          if (newVal<=50 && !hintShown[idx]){
            setHintShown(h=>{
              const c=[...h]; c[idx]=true; return c;
            });
          }
          return n;
        });
      }, TICK_MS);
    }, COUNTDOWN_START_DELAY_MS);

    return ()=>{
      if (levelDelayRef.current){ window.clearTimeout(levelDelayRef.current); levelDelayRef.current=null; }
      if (levelTimerRef.current){ window.clearInterval(levelTimerRef.current); levelTimerRef.current=null; }
    };
  }, [activeLevel, started, gameOver, guesses, freezeActiveAfterAnswer, dailyPaths.length, hintShown]);

  /* ===== One big confetti on final popup ===== */
  useEffect(() => {
    if (showPopup && !confettiFired){
      confetti({ particleCount: 1800, spread: 170, startVelocity: 60, origin: { y: 0.5 } });
      setConfettiFired(true);
    }
  }, [showPopup, confettiFired]);

  /* ===== Community % correct (api → json → local) ===== */
  useEffect(() => {
    if (!dailyPaths.length) return;

    const computeLocal = () => {
      const totals = new Array(dailyPaths.length).fill(0);
      const rights = new Array(dailyPaths.length).fill(0);
      const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '{}');
      Object.values(history).forEach((rec: any) => {
        if (!rec?.guesses || !Array.isArray(rec.guesses)) return;
        if (rec.guesses.length !== dailyPaths.length) return;
        rec.guesses.forEach((g: Guess | null, i: number) => {
          if (g) { totals[i] += 1; if (g.correct) rights[i] += 1; }
        });
      });
      const pct = totals.map((t,i)=> (t ? Math.round((rights[i]/t)*100) : 50));
      setCommunityPct(pct);
      setCommunitySource('local');
    };

    (async ()=>{
      try {
        let used:'api'|'json'|'local'='api';
        let res:Response|null=null;

        try{ res = await fetch(`/api/stats?date=${gameDate}`, { cache:'no-store' }); } catch {}
        if (!res || !res.ok){
          used='json';
          try{ res = await fetch(`/data/stats.json`, { cache:'no-store' }); } catch {}
        }
        if (!res || !res.ok){ computeLocal(); return; }

        let data:any=null;
        try{ data = await res.json(); } catch { computeLocal(); return; }

        const arr =
          Array.isArray(data?.[gameDate]) ? data[gameDate] :
          Array.isArray(data?.levels) ? data.levels : null;

        if (arr && arr.length >= dailyPaths.length){
          const cleaned = arr.slice(0, dailyPaths.length)
            .map((v:any)=> Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
          setCommunityPct(cleaned);
          setCommunitySource(used);
        } else {
          computeLocal();
        }
      } catch {
        computeLocal();
      }
    })();
  }, [dailyPaths.length, gameDate]);

  /* ===== Helpers ===== */
  const sanitizeImageName = (name: string) => name.trim().replace(/\s+/g,'_');
  const stopLevelTimer = () => {
    if (levelDelayRef.current){ window.clearTimeout(levelDelayRef.current); levelDelayRef.current=null; }
    if (levelTimerRef.current){ window.clearInterval(levelTimerRef.current); levelTimerRef.current=null; }
  };
  const startRevealHold = (index:number, then:()=>void, holdMs:number) => {
    setFreezeActiveAfterAnswer(index); stopLevelTimer();
    window.setTimeout(()=>{ setFreezeActiveAfterAnswer(null); then(); }, holdMs);
  };
  const advanceToNext = (index:number) => { if (index<dailyPaths.length-1) setActiveLevel(index+1); };

  /* ===== Suggestions ===== */
  const buildSuggestions = (needle:string) => {
    const n = needle.trim().toLowerCase();
    if (!n) return [];
    // smarter: prioritize startsWith, then includes, then fuzzy-ish by word
    const list = players.map(p=>({ name:p.name, position:p.position }));
    const starts = list.filter(x=> x.name.toLowerCase().startsWith(n));
    const includes = list.filter(x=> !x.name.toLowerCase().startsWith(n) && x.name.toLowerCase().includes(n));
    const words = list.filter(x=>{
      if (starts.includes(x) || includes.includes(x)) return false;
      return x.name.toLowerCase().split(/\s+/).some(w=> w.startsWith(n));
    });
    const merged = [...starts, ...includes, ...words];
    // unique by name
    const uniq: {name:string;position?:string}[] = [];
    const seen = new Set<string>();
    for (const s of merged){
      if (seen.has(s.name)) continue;
      seen.add(s.name); uniq.push(s);
      if (uniq.length>=20) break;
    }
    return uniq;
  };

  const handleInputChange = (index:number, value:string) => {
    const s = buildSuggestions(value);
    const u = [...filteredSuggestions]; u[index]=s; setFilteredSuggestions(u); setHighlightIndex(s.length?0:-1);
  };

  const handleKeyDown = (e:React.KeyboardEvent<HTMLInputElement>, idx:number) => {
    const max = filteredSuggestions[idx]?.length || 0; if (!max) return;
    if (e.key==='ArrowDown'){ setHighlightIndex(p=> (p+1)%max); e.preventDefault(); }
    else if (e.key==='ArrowUp'){ setHighlightIndex(p=> (p-1+max)%max); e.preventDefault(); }
    else if (e.key==='Enter'){
      // Only allow answering via dropdown selection
      if (highlightIndex>=0){
        const sel = filteredSuggestions[idx][highlightIndex];
        handleGuess(idx, sel.name);
      }
      e.preventDefault();
    }
  };

  const hideSuggestionsSoon = (idx:number) => {
    // allow click to fire first
    setTimeout(()=>{
      const u=[...filteredSuggestions]; u[idx]=[]; setFilteredSuggestions(u);
    }, 0);
  };

  /* ===== Guess / Give Up / Hint ===== */
  const handleGuess = (index:number, value:string) => {
    if (guesses[index]) return;
    const correctPath = dailyPaths[index]?.path.join('>');
    const matched = players.find(p => p.name.toLowerCase()===value.toLowerCase() && p.path.join('>')===correctPath);

    const updated=[...guesses];
    updated[index] = { guess:value, correct: !!matched };
    setGuesses(updated);

    const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[index] ?? MAX_BASE_POINTS));
    const multiplier = index+1;
    const awarded = matched ? baseLeft * multiplier : 0;
    setAwardedPoints(prev=>{ const n=[...prev]; n[index]=awarded; return n; });

    if (matched){
      setScore(prev=> prev + awarded);
      const el = inputRefs.current[index]; let x=0.5, y=0.5;
      if (el){ const r=el.getBoundingClientRect(); x=(r.left+r.right)/2 / window.innerWidth; y=r.bottom / window.innerHeight; }
      confetti({ particleCount: 140, spread: 90, startVelocity: 55, origin: { x, y } });
      confetti({ particleCount: 100, spread: 70, startVelocity: 65, origin: { x: Math.min(0.95, x+0.08), y } });
    }

    // clear suggestions
    const sugg=[...filteredSuggestions]; sugg[index]=[]; setFilteredSuggestions(sugg);

    const willComplete = updated.every(Boolean);
    if (willComplete){
      startRevealHold(index, ()=>{ setGameOver(true); setShowPopup(true); }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, ()=> advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const handleSkip = (index:number) => {
    if (guesses[index]) return;
    const updated=[...guesses]; updated[index] = { guess:'No Answer', correct:false };
    setGuesses(updated);
    setAwardedPoints(prev=>{ const n=[...prev]; n[index]=0; return n; });

    const sugg=[...filteredSuggestions]; sugg[index]=[]; setFilteredSuggestions(sugg);

    const willComplete = updated.every(Boolean);
    if (willComplete){
      startRevealHold(index, ()=>{ setGameOver(true); setShowPopup(true); }, FINAL_REVEAL_HOLD_MS);
    } else {
      startRevealHold(index, ()=> advanceToNext(index), REVEAL_HOLD_MS);
    }
  };

  const revealHint = (idx:number) => {
    setHintShown(prev=>{ const n=[...prev]; n[idx]=true; return n; });
    // If above 50, drop to 50
    setBasePointsLeft(prev=>{
      const n=[...prev]; const cur=n[idx] ?? MAX_BASE_POINTS; if (cur>50) n[idx]=50; return n;
    });
  };

  /* ===== Share ===== */
  const shareNow = () => {
    const title = `🏈 Helmets – ${gameDateMMDDYY}`;
    const emojiSquares = guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('');
    const emojiForScore = scoreEmojis(score);
    const text =
`${title}

${emojiSquares}
Score: ${score} ${emojiForScore}

www.helmets-game.com`;
    if (navigator.share){
      navigator.share({ title:'Helmets', text }).catch(()=> navigator.clipboard.writeText(text));
    } else {
      navigator.clipboard.writeText(text);
      alert('Score copied!');
    }
  };

  /* ===== Start game ===== */
  const handleStartGame = () => {
    setStarted(true); setStartedFor(gameDate,true); setShowRules(false); setRulesOpenedManually(false);
    setActiveLevel(-1);
    setTimeout(()=>{ setActiveLevel(0);
      setTimeout(()=>{ const el=inputRefs.current[0]; if (el){ try{ (el as any).focus({preventScroll:true}); }catch{ el.focus(); window.scrollTo(0,0);} } }, 120);
    }, 420);
  };

  const duringActive = started && !gameOver && !showPopup;
  const appFixed = duringActive ? 'app-fixed' : '';
  const prestartClass = !started ? 'is-prestart' : '';

  return (
    <div className={`app-container ${appFixed} ${gameOver ? 'is-complete' : ''} ${prestartClass}`}>
      <header className="game-header">
        <div className="title-row">
          <img className="game-logo" src="/android-chrome-outline-large-512x512.png" alt="Game Logo" />
          <h1 className="game-title">HELMETS</h1>
        </div>
        <div className="date-line">{gameDateHeader}</div>
        <div className="score-line">Score: <span className="score-number">{displayScore}</span></div>
        <button className="rules-button" onClick={()=>{ setRulesOpenedManually(true); setShowRules(true); }}>Rules</button>
      </header>

      {gameOver && (
        <div className="complete-banner">
          <h3>🎯 Game Complete</h3>
          <p>Tap each box to view possible answers</p>
          <div className="complete-actions">
            <button className="primary-button" onClick={shareNow}>Share Score!</button>
            <button className="secondary-button small" onClick={()=> setShowHistory(true)}>Previous day's games</button>
          </div>
        </div>
      )}

      {duringActive && <div className="level-backdrop" aria-hidden="true" />}

      {dailyPaths.map((path, idx) => {
        const isDone = !!guesses[idx];
        const isFeedback = freezeActiveAfterAnswer===idx;
        const isActive = started && !gameOver && ((idx===activeLevel && !isDone) || isFeedback);
        const isCovered = !started || (!isDone && !isActive);

        const blockClass = isDone ? (guesses[idx]!.correct ? 'path-block-correct' : 'path-block-incorrect') : 'path-block-default';
        let stateClass='level-card--locked';
        if (isDone && !isFeedback) stateClass='level-card--done';
        else if (isActive) stateClass='level-card--active';

        const inputEnabled = isActive && !isDone;

        const multiplier = idx+1;
        const wonPoints = awardedPoints[idx] || 0;
        const showPointsNow = gameOver;
        const badgeText = showPointsNow && isDone ? `+${wonPoints}` : `${multiplier}x Points`;
        const badgeClass = showPointsNow && isDone ? (wonPoints>0 ? 'level-badge won' : 'level-badge zero') : 'level-badge';

        const baseLeft = Math.max(0, Math.min(MAX_BASE_POINTS, basePointsLeft[idx] ?? MAX_BASE_POINTS));
        const answers = answerDetails[idx] || [];
        const hintPlayer = answers[0]; // already sorted by difficulty asc
        const hintText = hintPlayer?.position || '—';

        return (
          <div
            key={idx}
            className={`path-block level-card ${blockClass} ${stateClass} ${isCovered ? 'is-covered' : ''}`}
            onClick={()=>{ if (gameOver){ const u=[...revealedAnswers]; u[idx]=!u[idx]; setRevealedAnswers(u); } }}
          >
            {(isActive || gameOver) && <div className="level-tag">Level {idx+1}</div>}
            <div className={badgeClass} aria-hidden="true">{badgeText}</div>

            <div className="level-cover" aria-hidden={!isCovered}>
              {started && <span className="level-cover-label">Level {idx+1}</span>}
            </div>

            <div className="card-body">
              {gameOver && <div className="click-hint">Click to view possible answers</div>}

              <div className="helmet-sequence">
                {path.path.map((team, i)=>(
                  <React.Fragment key={i}>
                    <img
                      src={`/images/${sanitizeImageName(team)}.png`}
                      alt={team}
                      className="helmet-icon"
                      style={{ ['--i' as any]: `${i*160}ms` }}
                    />
                    {i<path.path.length-1 && <span className="arrow">→</span>}
                  </React.Fragment>
                ))}
              </div>

              <div className="guess-input-container">
                <div className={`guess-input ${guesses[idx] ? (guesses[idx]!.correct ? 'correct':'incorrect') : ''}`}>
                  {!guesses[idx] ? (
                    <>
                      <input
                        ref={(el)=> (inputRefs.current[idx]=el)}
                        type="text"
                        placeholder={inputEnabled ? 'Guess Player' : 'Locked'}
                        inputMode="text"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e)=> inputEnabled && handleInputChange(idx, e.target.value)}
                        onKeyDown={(e)=> inputEnabled && handleKeyDown(e, idx)}
                        onBlur={()=> hideSuggestionsSoon(idx)}
                        className="guess-input-field guess-input-mobile font-mobile"
                        disabled={!inputEnabled}
                      />

                      {inputEnabled && filteredSuggestions[idx]?.length>0 && (
                        <div className="suggestion-box fade-in-fast">
                          {filteredSuggestions[idx].slice(0, 6).map((s, i)=>{
                            const typed = inputRefs.current[idx]?.value || '';
                            const match = s.name.toLowerCase().indexOf(typed.toLowerCase());
                            return (
                              <div
                                key={i}
                                className={`suggestion-item ${highlightIndex===i ? 'highlighted' : ''}`}
                                onMouseDown={()=> handleGuess(idx, s.name)}
                              >
                                <span className="suggestion-name">
                                  {match>=0 ? (<>{s.name.slice(0,match)}<strong>{s.name.slice(match, match+typed.length)}</strong>{s.name.slice(match+typed.length)}</>) : s.name}
                                </span>
                                {s.position && <span className="suggestion-pos">{s.position}</span>}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {isActive && (
                        <>
                          <div className="points-wrap">
                            <div className="points-row">
                              <span className="points-label">Points</span>
                              <span className="points-value">{baseLeft}</span>
                            </div>
                            <div className="points-bar">
                              <div className="points-bar-fill" style={{ ['--fill' as any]: `${baseLeft}%` }} />
                              <div className="points-bar-midline" />
                            </div>
                            <div className={`hint-row ${hintShown[idx] ? 'revealed' : ''}`}>
                              <span className="hint-label">HINT</span>
                              <span className="hint-value">{hintShown[idx] ? hintText : '—'}</span>
                            </div>
                            <button
                              type="button"
                              className="hint-button"
                              onClick={()=> revealHint(idx)}
                              disabled={hintShown[idx]}
                              aria-disabled={hintShown[idx]}
                            >
                              HINT (drops to 50)
                            </button>
                          </div>

                          <button className="primary-button skip-button" type="button" onClick={()=> handleSkip(idx)}>
                            Give Up (0 points)
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <div className={`locked-answer ${guesses[idx]!.correct ? 'answer-correct' : 'answer-incorrect blink-red'} locked-answer-mobile font-mobile`}>
                      {guesses[idx]!.correct ? `✅ ${guesses[idx]!.guess}` : `❌ ${guesses[idx]!.guess || 'No Answer'}`}
                      {(!gameOver || isFeedback) && (
                        <div style={{ marginTop: 6, fontSize: '0.9rem', fontWeight: 800 }}>
                          {`+${awardedPoints[idx] || 0}`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Community % bar in game-complete */}
              {gameOver && (
                <div className="community-wrap">
                  <div className="community-row">
                    <span>Users Correct</span>
                    <span>{(communityPct[idx] ?? 0)}%</span>
                  </div>
                  <div className="community-bar">
                    <div className="community-bar-fill" style={{ ['--pct' as any]: (communityPct[idx] ?? 0) }} />
                  </div>
                  {debug && <div className="community-src">source: {communitySource}</div>}
                </div>
              )}

              {gameOver && revealedAnswers[idx] && !!answerDetails[idx]?.length && (
                <div className="possible-answers">
                  <strong>Possible Answers:</strong>
                  <ul className="possible-answers-list">
                    {answerDetails[idx].map((p,i)=>(
                      <li key={i}>👤 {p.name}{p.position ? <span className="pa-pos"> · {p.position}</span> : null}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {!duringActive && !gameOver && (
        <button onClick={()=> setShowHistory(true)} className="fab-button fab-history">📅 History</button>
      )}

      {showHistory && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={()=> setShowHistory(false)}>✖</button>
            <h3>📆 Game History (Last 30 days)</h3>
            <div className="calendar-grid">
              {getLastNDatesPT(30).map((date)=>{
                const isToday = date===todayPT;
                return (
                  <button
                    key={date}
                    className={`calendar-grid-button${isToday ? ' today' : ''}`}
                    onClick={()=> (window.location.href=`/?date=${date}`)}
                  >
                    {date.slice(5)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showFeedback && (
        <div className="popup-modal">
          <div className="popup-content">
            <button className="close-button" onClick={()=> setShowFeedback(false)}>✖</button>
            <h3>Thoughts for Jerry?</h3>
            <div className="email-row">
              <span className="email-emoji">📧</span>
              <span className="email-text">jerry.helmetsgame@gmail.com</span>
            </div>
            <button
              onClick={()=>{ navigator.clipboard.writeText('jerry.helmetsgame@gmail.com'); setCopied(true); setTimeout(()=>setCopied(false),1500); }}
              className="primary-button"
            >
              Copy Email
            </button>
            {copied && <p className="copied-msg">Email copied!</p>}
          </div>
        </div>
      )}

      {showRules && (
        <div className="popup-modal fade-in">
          <div className="popup-content popup-rules">
            {rulesOpenedManually && (
              <button className="close-button" onClick={()=>{ setShowRules(false); setRulesOpenedManually(false); }}>
                ✖
              </button>
            )}
            <h2>WELCOME TO HELMETS!</h2>
            <h3>HOW TO PLAY</h3>

            <ul className="rules-list football-bullets rules-main">
              <li><strong>Match each helmet path to an NFL player</strong></li>
              <li><strong>5 levels: each gets more difficult and is worth more points</strong></li>
              <li><strong>Only one guess per level</strong></li>
              <li><strong>The faster you answer, the more points you get!</strong></li>
              <li><strong>You get 0 points if you give up a level</strong></li>
              <li><strong>Hint when points bar hits 50, can automatically skip to hint</strong></li>
            </ul>

            <h4 className="fine-print-title">Fine Print:</h4>
            <ul className="rules-list football-bullets rules-fineprint">
              <li>Each level has a points multiplier (Level 1 = 1x points, Level 5 = 5x points)</li>
              <li>Player must have played in the year 2000 or later</li>
              <li>College helmet is the player's draft college</li>
              <li>Some paths may have multiple possible answers</li>
            </ul>

            {!started && !gameOver && (
              <button onClick={handleStartGame} className="primary-button" style={{ marginTop: 12 }}>
                Start Game!
              </button>
            )}
          </div>
        </div>
      )}

      {showPopup && (
        <div className="popup-modal fade-in">
          <div className="popup-content popup-final">
            <button className="close-button" onClick={()=> { setShowPopup(false); setPopupDismissed(true); }}>✖</button>
            <h3 className="popup-title">🎉 Game Complete!</h3>
            <p className="popup-date">{gameDateMMDDYY}</p>
            <p className="popup-score">Score: <span className="score-number">{finalDisplayScore}</span></p>
            <p>{guesses.map(g => (g?.correct ? '🟩' : '🟥')).join('')}</p>
            <button onClick={shareNow} className="primary-button">Share Score!</button>
          </div>
        </div>
      )}

      {!duringActive && (
        <div className="footer-actions">
          <button onClick={()=> setShowFeedback(true)} className="feedback-link">
            💬 Feedback
          </button>
        </div>
      )}

      <footer className="site-disclosure">
        Please note: www.helmets-game.com does not own any of the team, league or event logos depicted within this site.
        All sports logos contained within this site are properties of their respective leagues, teams, ownership groups
        and/or organizations.
      </footer>
    </div>
  );
};

export default GameComponent;
