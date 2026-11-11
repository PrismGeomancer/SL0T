import { useEffect, useRef, useState } from 'react';
import { sfx } from '../lib/sound';

interface Props {
  onPull: () => void;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
  scale?: number;
  type?: 'button' | 'submit';
}

const MAX = 62; // degrees
const TRIGGER = 40;

/** A draggable lever with spring physics. Click, Enter or Space pulls it too. */
export function Lever({ onPull, label, disabled, ariaLabel, scale = 1, type = 'button' }: Props) {
  const [angle, setAngle] = useState(0);
  const angleRef = useRef(0);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const raf = useRef(0);
  const suppressClick = useRef(false);

  const set = (a: number) => {
    angleRef.current = a;
    setAngle(a);
  };

  const springBack = () => {
    cancelAnimationFrame(raf.current);
    let v = 0;
    let last = performance.now();
    const k = 170;
    const c = 11;
    const step = (t: number) => {
      const dt = Math.min(0.032, (t - last) / 1000);
      last = t;
      const a = angleRef.current;
      v += (-k * a - c * v) * dt;
      const next = a + v * dt;
      if (Math.abs(next) < 0.2 && Math.abs(v) < 2) return set(0);
      set(next);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const fire = () => {
    sfx.clunk();
    onPull();
  };

  /** auto pull for click / keyboard: swing down, fire, spring back */
  const autoPull = () => {
    if (disabled) return;
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const from = angleRef.current;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 180);
      set(from + (MAX - from) * (k * k));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else {
        fire();
        springBack();
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return (
    <div style={{ display: 'grid', justifyItems: 'center', transform: scale !== 1 ? `scale(${scale})` : undefined }}>
      <button
        type={type}
        className="lever"
        aria-label={ariaLabel ?? label ?? 'Pull the lever'}
        disabled={disabled}
        onPointerDown={(e) => {
          if (disabled) return;
          cancelAnimationFrame(raf.current);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = { y: e.clientY, moved: false };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dy = e.clientY - drag.current.y;
          if (Math.abs(dy) > 4) drag.current.moved = true;
          set(Math.max(0, Math.min(MAX, dy * 0.55)));
        }}
        onPointerUp={() => {
          if (!drag.current) return;
          const moved = drag.current.moved;
          drag.current = null;
          if (!moved) return; // a plain click: handled by onClick
          suppressClick.current = true;
          if (angleRef.current >= TRIGGER) fire();
          springBack();
        }}
        onPointerCancel={() => {
          drag.current = null;
          springBack();
        }}
        onClick={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.preventDefault();
            return;
          }
          if (type === 'submit') {
            // let the form validate and submit; animate for feel
            e.preventDefault();
            autoPull();
            return;
          }
          autoPull();
        }}
      >
        <span className="lever-base" />
        <span className="lever-arm" style={{ transform: `perspective(380px) rotateX(${-angle}deg)` }}>
          <span className="lever-knob" />
        </span>
      </button>
      {label && <div className="lever-label">{label}</div>}
    </div>
  );
}
