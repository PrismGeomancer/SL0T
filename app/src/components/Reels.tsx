import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { sfx } from '../lib/sound';

export type Sym = '7' | 'bar' | 'cherry' | 'bell' | '0' | 'blank';
const POOL: Sym[] = ['7', 'bar', 'cherry', 'bell', '0', 'bar', 'cherry', '7', 'bell'];

export function Symbol({ s }: { s: Sym }) {
  switch (s) {
    case '7':
      return (
        <span className="sym sym-7" aria-label="7">
          <svg viewBox="0 0 64 64">
            <path d="M12 9h42v9L33 57H19l20-36H12z" fill="#7a0d1d" transform="translate(2 3)" />
            <path d="M12 9h42v9L33 57H19l20-36H12z" fill="#ff2e4d" stroke="#ffd0d7" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </span>
      );
    case 'bar':
      return <span className="sym sym-bar">BAR</span>;
    case '0':
      return <span className="sym sym-0">0</span>;
    case 'blank':
      return <span className="sym sym-blank" />;
    case 'cherry':
      return (
        <span className="sym" aria-label="cherry">
          <svg viewBox="0 0 64 64">
            <path d="M32 8c2 10 8 18 18 22M32 8c-4 12-10 20-18 26" stroke="#2d7a2d" strokeWidth="4" fill="none" strokeLinecap="round" />
            <path d="M32 8c6-4 14-4 18 0-6 4-12 4-18 0z" fill="#3fa63f" />
            <circle cx="18" cy="44" r="12" fill="#e0102f" />
            <circle cx="46" cy="40" r="12" fill="#ff2e4d" />
            <circle cx="14" cy="40" r="3" fill="#fff8" />
            <circle cx="42" cy="36" r="3" fill="#fff8" />
          </svg>
        </span>
      );
    case 'bell':
      return (
        <span className="sym" aria-label="bell">
          <svg viewBox="0 0 64 64">
            <path d="M32 8c-11 0-16 9-16 20v10l-6 8h44l-6-8V28c0-11-5-20-16-20z" fill="#ffc24b" stroke="#8a5a00" strokeWidth="3" />
            <circle cx="32" cy="52" r="6" fill="#8a5a00" />
            <path d="M24 20c2-4 5-6 8-6" stroke="#fff8" strokeWidth="3" fill="none" strokeLinecap="round" />
          </svg>
        </span>
      );
  }
}

export interface ReelsHandle {
  /** Spin to `target`; resolves when the last reel settles. */
  spin: (target: Sym[], opts?: { duration?: number; instant?: boolean; only?: number[] }) => Promise<void>;
}

interface Props {
  initial?: Sym[];
  height?: number;
  className?: string;
  label?: string;
}

const rand = () => POOL[Math.floor(Math.random() * POOL.length)];

/** Three DOM reels with weighty deceleration, overshoot and settle. */
export const Reels = forwardRef<ReelsHandle, Props>(function Reels({ initial = ['7', 'cherry', 'bar'], height = 120, className = '', label }, ref) {
  const [strips, setStrips] = useState<Sym[][]>(() => initial.map((s) => [s]));
  const [blur, setBlur] = useState(false);
  const stripRefs = useRef<(HTMLDivElement | null)[]>([]);
  const pending = useRef<{ duration: number; resolve: () => void } | null>(null);
  const current = useRef<Sym[]>(initial);

  useImperativeHandle(ref, () => ({
    spin(target, opts = {}) {
      return new Promise<void>((resolve) => {
        if (opts.instant) {
          current.current = target;
          setStrips(target.map((s) => [s]));
          resolve();
          return;
        }
        const duration = opts.duration ?? 1800;
        const n = 18;
        const moves = (i: number) => !opts.only || opts.only.includes(i);
        const next = target.map((t, i) => (moves(i) ? [current.current[i], ...Array.from({ length: n + i * 5 }, rand), t] : [current.current[i]]));
        if (opts.only) target = target.map((t, i) => (moves(i) ? t : current.current[i]));
        current.current = target;
        pending.current = { duration, resolve };
        setStrips(next);
      });
    },
  }));

  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    setBlur(true);
    let ticks = 0;
    const tickId = setInterval(() => {
      if (ticks++ % 2 === 0) sfx.tick();
    }, 70);
    const anims = strips.map((strip, i) => {
      const el = stripRefs.current[i];
      if (!el) return Promise.resolve();
      if (strip.length === 1) return Promise.resolve();
      const end = -(strip.length - 1) * height;
      const dur = p.duration * (0.55 + 0.225 * i);
      const a = el.animate(
        [
          { transform: 'translateY(0px)', easing: 'cubic-bezier(.45,.05,.55,.3)' },
          { transform: `translateY(${end * 0.2}px)`, offset: 0.18, easing: 'linear' },
          { transform: `translateY(${end - height * 0.22}px)`, offset: 0.86, easing: 'cubic-bezier(.2,.7,.3,1)' },
          { transform: `translateY(${end + height * 0.06}px)`, offset: 0.94, easing: 'ease-in-out' },
          { transform: `translateY(${end}px)` },
        ],
        { duration: dur, fill: 'forwards' },
      );
      return a.finished.then(() => {
        sfx.thunk();
        if (i === 1) setBlur(false);
      });
    });
    void Promise.all(anims).then(() => {
      clearInterval(tickId);
      setBlur(false);
      // collapse strips to the landed symbol (no transform)
      setStrips(current.current.map((s) => [s]));
      stripRefs.current.forEach((el) => el?.getAnimations().forEach((a) => a.cancel()));
      p.resolve();
    });
    return () => clearInterval(tickId);
  }, [strips, height]);

  return (
    <div className={`reels ${blur ? 'blur' : ''} ${className}`} style={{ ['--reel-h' as string]: `${height}px` }} role="img" aria-label={label ?? `Reels: ${current.current.join(', ')}`}>
      <div className="payline" />
      {strips.map((strip, i) => (
        <div className="reel" key={i}>
          <div className="reel-strip" ref={(el) => (stripRefs.current[i] = el)}>
            {strip.map((s, j) => (
              <div className="reel-cell" key={j}>
                <Symbol s={s} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

export const MISS_SETS: Sym[][] = [
  ['7', 'cherry', 'bar'],
  ['bar', '7', 'bell'],
  ['cherry', 'bell', '7'],
  ['7', '7', 'cherry'],
];
export const randomMiss = () => MISS_SETS[Math.floor(Math.random() * MISS_SETS.length)];
export const HIT_SET: Sym[] = ['7', '7', '7'];
export const VOID_SET: Sym[] = ['blank', 'blank', 'blank'];
