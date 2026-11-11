import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '../lib/hooks';
import { sfx } from '../lib/sound';
import { useStore } from '../lib/store';
import { Lever } from './Lever';
import { NeonLetters } from './NeonLogo';
import { HIT_SET, Reels, type ReelsHandle } from './Reels';
import { BulbBorder } from './ui';

const SEEN_KEY = 'sl0t:intro-seen';
const WEEK = 7 * 24 * 3600 * 1000;

function seenRecently(): boolean {
  try {
    const t = Number(localStorage.getItem(SEEN_KEY));
    return !!t && Date.now() - t < WEEK;
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Should the intro show for this visit? Only on the landing route. */
export function introMode(reduced: boolean): 'full' | 'short' | 'static' {
  if (reduced) return 'static';
  return seenRecently() ? 'short' : 'full';
}

/**
 * Overlay over the already-rendered hero (never blocks LCP).
 * full (~4.5 s): hum, tube-by-tube ignition, chase, 7·7·7, tagline, PULL TO ENTER.
 * short (1.2 s): marquee only, then it lets you in.
 * static: reduced motion — marquee, tagline, Enter.
 */
export function Intro({ mode }: { mode: 'full' | 'short' | 'static' }) {
  const setIntroOpen = useStore((s) => s.setIntroOpen);
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(mode === 'full' ? 0 : 4);
  const [flicker, setFlicker] = useState(-1);
  const [beat, setBeat] = useState(mode === 'full' ? 0 : 5);
  const [leaving, setLeaving] = useState(false);
  const reels = useRef<ReelsHandle>(null);
  const timers = useRef<number[]>([]);

  const close = useCallback(() => {
    markSeen();
    setLeaving(true);
    window.setTimeout(() => setIntroOpen(false), 500);
  }, [setIntroOpen]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    if (mode === 'full') {
      at(50, () => sfx.hum());
      at(600, () => setLit(1));
      at(850, () => setLit(2));
      at(1100, () => {
        setFlicker(2);
        setLit(3);
      }); // the 0 flickers twice, then holds
      at(1900, () => {
        setFlicker(-1);
        setLit(4);
      });
      at(2100, () => setBeat(2));
      at(2600, () => {
        setBeat(3);
        void reels.current?.spin(HIT_SET, { duration: 1300 }).then(() => setBeat(4));
      });
      at(4100, () => setBeat(5));
    } else if (mode === 'short') {
      at(1200, close);
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [mode, close]);

  return (
    <div className={`overlay intro ${leaving ? 'leaving' : ''}`} role="dialog" aria-modal="true" aria-label="SL0T intro">
      {mode !== 'static' && (
        <button className="intro-skip" onClick={close}>
          Skip intro
        </button>
      )}
      {mode === 'full' && beat < 2 && <div className="intro-status">POWERING UP THE FLOOR</div>}
      <div className="intro-inner">
        <BulbBorder className="intro-marquee" chase={!reduced && beat >= 2} lit={beat >= 2 || mode !== 'full'} spacing={30}>
          <span className="intro-logo-wrap" style={{ display: 'block' }}>
            <NeonLetters lit={lit} flicker={flicker} />
          </span>
        </BulbBorder>
        {mode !== 'short' && (
          <>
            <div className="intro-mono">{beat >= 2 || mode === 'static' ? '3 REELS · 2 OUTCOMES · 0 HOUSE' : ' '}</div>
            {mode === 'full' && (
              <div style={{ width: 'min(360px, 80vw)', opacity: beat >= 3 ? 1 : 0, transition: 'opacity 300ms' }}>
                <Reels ref={reels} height={84} initial={['bar', 'cherry', 'bell']} label="Reels landing on 7, 7, 7" />
              </div>
            )}
            <div className="intro-tag">{beat >= 4 || mode === 'static' ? <span className="fade-in">Every launch is <em>a pull.</em></span> : ' '}</div>
            <div className="intro-cta">
              {mode === 'static' ? (
                <button className="btn gold primary" onClick={close} autoFocus>
                  Enter
                </button>
              ) : beat >= 5 ? (
                <>
                  <button className="btn gold primary pulse fade-in" onClick={close} autoFocus>
                    PULL TO ENTER
                  </button>
                  <div className="fade-in">
                    <Lever onPull={close} ariaLabel="Pull to enter" />
                  </div>
                </>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
