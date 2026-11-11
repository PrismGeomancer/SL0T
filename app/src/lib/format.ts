export const LAMPORTS = 1_000_000_000;

/** lamports -> "0.333" style SOL string, trimmed, max `dp` decimals */
export function sol(lamports: number, dp = 3): string {
  const v = lamports / LAMPORTS;
  if (v === 0) return '0';
  const s = v.toFixed(dp);
  const t = s.replace(/\.?0+$/, '');
  if (t === '0' || t === '-0') return v > 0 ? `<${(1 / 10 ** dp).toFixed(dp)}` : '0';
  return t;
}

export function signedSol(lamports: number, dp = 3): string {
  if (lamports === 0) return '0';
  return `${lamports > 0 ? '+' : '−'}${sol(Math.abs(lamports), dp)}`;
}

export function toLamports(solStr: string): number | null {
  const s = solStr.trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
  const [w, f = ''] = s.split('.');
  if (f.length > 9) return null;
  return Number(w || '0') * LAMPORTS + Number((f + '000000000').slice(0, 9));
}

export const short = (addr: string, n = 4) => (addr.length > 2 * n + 1 ? `${addr.slice(0, n)}…${addr.slice(-n)}` : addr);

const pad = (n: number) => String(n).padStart(2, '0');

/** "hh:mm" (hours may exceed 24) */
export function hhmm(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}`;
}

export function hhmmss(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function timeAgo(unix: number, now = Date.now() / 1000): string {
  const d = Math.max(0, Math.floor(now - unix));
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86_400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86_400)}d ago`;
}

export function clock(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const pct = (bps: number) => {
  const v = bps / 100;
  return v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1);
};

export const hours = (secs: number) => {
  const h = secs / 3600;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
};
