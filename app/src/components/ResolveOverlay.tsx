import { useEffect, useRef, useState } from 'react';
import { sol } from '../lib/format';
import { useReducedMotion } from '../lib/hooks';
import { sfx } from '../lib/sound';
import type { LaunchState } from '../lib/types';
import { HIT_SET, randomMiss, Reels, VOID_SET, type ReelsHandle } from './Reels';
import { BulbBorder } from './ui';

interface Props {
  state: Exclude<LaunchState, 'open'>;
  ticker: string;
  payout?: number; // lamports, for HIT / VOID
  canRematch: boolean;
  onClaim: () => void;
  onRematch: () => void;
  onClose: () => void;
}

/** Full-screen moment when a launch you're in resolves while you watch. */
export function ResolveOverlay({ state, ticker, payout = 0, canRematch, onClaim, onRematch, onClose }: Props) {
  const reels = useRef<ReelsHandle>(null);
  const reduced = useReducedMotion();
  const [done, setDone] = useState(false);
  const [dead, setDead] = useState<number | null>(null);
  const [coins, setCoins] = useState<{ left: number; dur: number; delay: number }[]>([]);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const target = state === 'hit' ? HIT_SET : state === 'miss' ? randomMiss() : VOID_SET;
    void reels.current?.spin(target, { duration: 2500, instant: reduced }).then(() => {
      setDone(true);
      if (state === 'hit') {
        sfx.chime();
        if (!reduced) setCoins(Array.from({ length: 36 }, () => ({ left: Math.random() * 100, dur: 1.4 + Math.random() * 1.6, delay: Math.random() * 0.6 })));
      } else if (state === 'miss') {
        sfx.buzz();
        sfx.pop();
        setDead(5);
      }
    });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, reduced, onClose]);

  useEffect(() => {
    if (done) btn.current?.focus();
  }, [done]);

  return (
    <div className="overlay dim" role="dialog" aria-modal="true" aria-label={`${ticker} resolved`}>
      {coins.length > 0 && (
        <div className="coins" aria-hidden>
          {coins.map((c, i) => (
            <i key={i} style={{ left: `${c.left}%`, animationDuration: `${c.dur}s`, animationDelay: `${c.delay}s` }} />
          ))}
        </div>
      )}
      <div className="resolve">
        <BulbBorder chase={!done} deadIndex={dead} spacing={28} style={{ width: 'min(420px, 86vw)' }}>
          <Reels ref={reels} height={100} initial={['bar', 'cherry', 'bell']} />
        </BulbBorder>
        <div aria-live="assertive" style={{ display: 'grid', gap: 18, justifyItems: 'center', minHeight: 190 }}>
          {done && state === 'hit' && (
            <>
              <h2 className="hit fade-in">HIT.</h2>
              <p className="lede">${ticker} graduated.</p>
              <button ref={btn} className="btn green primary" onClick={onClaim}>
                Claim {sol(payout)} SOL
              </button>
            </>
          )}
          {done && state === 'miss' && (
            <>
              <h2 className="miss fade-in">MISS.</h2>
              <p className="lede">${ticker} didn't make it.</p>
              {canRematch ? (
                <button ref={btn} className="btn gold primary" onClick={onRematch}>
                  Run it back
                </button>
              ) : (
                <a className="btn" href="#/floor" onClick={onClose}>
                  Back to the floor
                </a>
              )}
            </>
          )}
          {done && state === 'void' && (
            <>
              <h2 className="void fade-in">VOID. Nobody took the other side. Refund ready.</h2>
              <button ref={btn} className="btn gold primary" onClick={onClaim}>
                Claim refund
              </button>
            </>
          )}
          {done && (
            <button className="btn sm ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
