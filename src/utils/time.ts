export function getPTDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return { y, m, d };
}
export function toPTISO(date: Date) { const { y, m, d } = getPTDateParts(date); return `${y}-${m}-${d}`; }
export function todayPTISO() { return toPTISO(new Date()); }
export function isoToMDYYYY(iso: string) { const [y,m,d]=iso.split('-'); return `${parseInt(m,10)}/${parseInt(d,10)}/${y}`; }
export function isoToMDYY(iso: string) { const [y,m,d]=iso.split('-'); return `${parseInt(m,10)}/${parseInt(d,10)}/${y.slice(-2)}`; }
export function getLastNDatesPT(n: number) {
  const base = new Date(); const out: string[] = [];
  for (let i = 0; i < n; i++) { const d = new Date(base); d.setDate(base.getDate() - i); out.push(toPTISO(d)); }
  return out;
}
