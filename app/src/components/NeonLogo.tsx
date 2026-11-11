/** S L 0 T in neon tubes. `lit` = how many letters are on (0..4); `flicker` = letter index flickering. */
export function NeonLetters({ lit = 4, flicker = -1, className = '' }: { lit?: number; flicker?: number; className?: string }) {
  return (
    <span className={`intro-logo ${className}`} aria-label="SL0T">
      {['S', 'L', '0', 'T'].map((ch, i) => (
        <span key={i} data-ch={ch} className={`tube ${i < lit ? 'lit' : ''} ${i === flicker ? 'flicker' : ''}`} aria-hidden>
          <span>{ch}</span>
        </span>
      ))}
    </span>
  );
}

/** Subtle SVG turbulence used on the logo only (referenced as filter: url(#neon-flicker)). */
export function NeonFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden focusable="false">
      <filter id="neon-flicker" x="-10%" y="-20%" width="120%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.04" numOctaves="1" seed="3" result="t">
          <animate attributeName="seed" values="3;7;3;11;3" dur="2.4s" repeatCount="indefinite" calcMode="discrete" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="t" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}
