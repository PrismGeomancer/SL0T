import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CONFIG } from '../config';
import { hhmm, hhmmss, pct, sol, timeAgo } from '../lib/format';
import { useInView, useNow, useReducedMotion } from '../lib/hooks';
import type { LaunchRow, LaunchState } from '../lib/types';

const CHIP: Record<LaunchState, string> = { open: 'SPINNING', hit: 'HIT', miss: 'MISS', void: 'VOID' };
export function StatusChip({ state }: { state: LaunchState }) {
  return <span className={`chip ${state}`}>{CHIP[state]}</span>;
}


export function CurveBar({ bps, complete, label }: { bps: number; complete: boolean; label?: ReactNode }) {
  return (
    <div className="curve">
      <div className="row small">
        <span>{label ?? `${pct(bps)}% filled`}</span>
      </div>
      <div className={`curve-bar${complete ? ' done' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bps / 100)}>
        <i style={{ width: `${Math.max(1.5, bps / 100)}%` }} />
      </div>
    </div>
  );
}

/** Floor-card countdown: "{hh:mm} left" / "Stakes closed" / "Resolved" */
export function CardCountdown({ launch }: { launch: LaunchRow }) {
  const now = useNow(15_000);
  if (launch.state !== 'open') return <span className="mono small">Resolved</span>;
  if (now >= launch.stakeCloseAt) return <span className="mono small">Stakes closed</span>;
  return <span className="mono small">{hhmm(launch.deadline - now)} left</span>;
}

/** Coin-page countdown: "Resolves in {hh:mm:ss}" / "Resolved {time ago}" */
export function ResolveCountdown({ launch }: { launch: LaunchRow }) {
  const now = useNow(1000);
  if (launch.state !== 'open') return <span className="mono">Resolved {timeAgo(launch.resolvedAt, now)}</span>;
  const left = launch.deadline - now;
  return (
    <span className="mono" aria-live="off">
      {left > 0 ? `Resolves in ${hhmmss(left)}` : 'Resolving at the next keeper run'}
    </span>
  );
}

export function SplitBar({ hit, miss }: { hit: number; miss: number }) {
  const total = hit + miss;
  const h = total ? (hit / total) * 100 : 50;
  return (
    <div className="pool-bar" aria-label={`HIT ${sol(hit)} SOL, MISS ${sol(miss)} SOL`}>
      <div className="h" style={{ width: `${h}%` }} />
      <div className="m" style={{ width: `${100 - h}%` }} />
    </div>
  );
}

export function CoinImage({ launch, size = '' }: { launch: LaunchRow; size?: '' | 'lg' }) {
  const [broken, setBroken] = useState(false);
  const src = launch.meta?.image;
  if (!src || broken)
    return (
      <div className={`coin-img ${size}`} style={{ display: 'grid', placeItems: 'center', fontFamily: 'var(--f-display)', color: 'var(--gold)' }} aria-hidden>
        {(launch.meta?.symbol ?? '?').slice(0, 2)}
      </div>
    );
  return <img className={`coin-img ${size}`} src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

export const coinName = (l: LaunchRow) => l.meta?.name ?? `Coin ${l.mint.slice(0, 4)}`;
export const coinTicker = (l: LaunchRow) => l.meta?.symbol ?? l.mint.slice(0, 4).toUpperCase();

const clusterQ = () => (CONFIG.cluster === 'devnet' ? '?cluster=devnet' : '');
export const solscan = {
  tx: (sig: string) => `https://solscan.io/tx/${sig}${clusterQ()}`,
  account: (a: string) => `https://solscan.io/account/${a}${clusterQ()}`,
  token: (m: string) => `https://solscan.io/token/${m}${clusterQ()}`,
};
export const pumpUrl = (mint: string) => `https://pump.fun/coin/${mint}`;

/** Animated number that counts up once it scrolls into view. */
export function CountUp({ to, dp = 3, suffix = '', duration = 1100 }: { to: number; dp?: number; suffix?: string; duration?: number }) {
  const [ref, inView] = useInView<HTMLSpanElement>({ threshold: 0.4 });
  const reduced = useReducedMotion();
  const [v, setV] = useState(reduced ? to : 0);
  const done = useRef(false);
  useEffect(() => {
    if (!inView || done.current) return;
    done.current = true;
    if (reduced) return setV(to);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setV(to * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, to, duration]);
  return (
    <span ref={ref} className="mono">
      {v.toFixed(dp)}
      {suffix}
    </span>
  );
}

/** Marquee bulbs around any box. The chase is a CSS animation; it pauses offscreen. */
export function BulbBorder({
  children,
  className = '',
  spacing = 26,
  chase = true,
  lit = true,
  deadIndex,
  style,
}: {
  children: ReactNode;
  className?: string;
  spacing?: number;
  chase?: boolean;
  lit?: boolean;
  deadIndex?: number | null;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pts, setPts] = useState<[number, number][]>([]);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const layout = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const inset = 10;
      const W = w - inset * 2;
      const H = h - inset * 2;
      const nx = Math.max(2, Math.round(W / spacing));
      const ny = Math.max(2, Math.round(H / spacing));
      const out: [number, number][] = [];
      for (let i = 0; i < nx; i++) out.push([inset + (W * i) / nx, inset]);
      for (let i = 0; i < ny; i++) out.push([inset + W, inset + (H * i) / ny]);
      for (let i = 0; i < nx; i++) out.push([inset + W - (W * i) / nx, inset + H]);
      for (let i = 0; i < ny; i++) out.push([inset, inset + H - (H * i) / ny]);
      setPts(out);
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [spacing]);
  return (
    <div ref={ref} className={`bulbs ${lit ? 'lit' : ''} ${chase ? 'chase' : ''} ${visible ? '' : 'paused'} ${className}`} style={style}>
      <div className="bulb-layer" aria-hidden>
        {pts.map(([x, y], i) => (
          <i key={i} className={deadIndex === i ? 'dead popped' : ''} style={{ left: x, top: y }} />
        ))}
      </div>
      {children}
    </div>
  );
}
