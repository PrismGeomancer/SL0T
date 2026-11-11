import { useEffect, useRef, useState } from 'react';
import { useMedia, useReducedMotion } from '../lib/hooks';
import { sfx } from '../lib/sound';
import type { Machine } from '../three/machine';
import { Lever } from './Lever';
import { NeonLetters } from './NeonLogo';
import { HIT_SET, randomMiss, Reels, type ReelsHandle } from './Reels';
import { BulbBorder } from './ui';

const hasWebGL = () => {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
};

/** CSS 2.5D cabinet: the mobile machine, and the first paint on desktop. */
function Machine2D() {
  const reels = useRef<ReelsHandle>(null);
  const [busy, setBusy] = useState(false);
  const pull = async () => {
    if (busy) return;
    setBusy(true);
    await reels.current?.spin(Math.random() < 0.3 ? HIT_SET : randomMiss(), { duration: 1500 });
    setBusy(false);
  };
  return (
    <div className="machine2d">
      <div className="cab">
        <BulbBorder className="cab-top" spacing={22} style={{ ['--bulb-pad' as string]: '14px 10px' }}>
          <NeonLetters className="" />
        </BulbBorder>
        <div className="cab-body">
          <Reels ref={reels} height={96} initial={['7', 'cherry', 'bar']} label="Slot reels, just for fun" />
          <div className="cab-tray" />
        </div>
        <div className="cab-lever">
          <Lever onPull={pull} ariaLabel="Pull the lever (just for fun)" scale={0.9} />
        </div>
      </div>
      <div className="floor-reflect" />
    </div>
  );
}

export function HeroMachine() {
  const desktop = useMedia('(min-width: 901px)');
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready3d, setReady3d] = useState(false);
  const machine = useRef<Machine | null>(null);

  useEffect(() => {
    if (!desktop || reduced || !hasWebGL()) return;
    let cancelled = false;
    const start = () => {
      void import('../three/machine').then(({ createMachine }) => {
        if (cancelled || !canvasRef.current) return;
        machine.current = createMachine(canvasRef.current, {
          bloom: true,
          reduced,
          onPull: () => sfx.clunk(),
          onTick: () => sfx.tick(),
          onSettle: () => sfx.thunk(),
        });
        setReady3d(true);
      });
    };
    // after first paint, when idle: keep LCP on the copy
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const id = ric ? ric(start, { timeout: 2500 }) : window.setTimeout(start, 900);
    return () => {
      cancelled = true;
      if (!ric) clearTimeout(id);
      machine.current?.dispose();
      machine.current = null;
      setReady3d(false);
    };
  }, [desktop, reduced]);

  return (
    <div className="hero-stage">
      <div className="hero-glow" />
      <div style={{ position: 'absolute', inset: 0, opacity: ready3d ? 0 : 1, transition: 'opacity 400ms', pointerEvents: ready3d ? 'none' : 'auto' }}>
        <Machine2D />
      </div>
      {desktop && !reduced && (
        <>
          <canvas ref={canvasRef} aria-hidden style={{ opacity: ready3d ? 1 : 0, transition: 'opacity 600ms', cursor: 'pointer' }} />
          {ready3d && (
            <button
              className="btn sm ghost"
              style={{ position: 'absolute', right: '4%', top: '46%' }}
              onClick={() => void machine.current?.pull()}
              aria-label="Pull the lever (just for fun)"
            >
              Pull
            </button>
          )}
        </>
      )}
      <span className="fun-tip">just for fun</span>
    </div>
  );
}
