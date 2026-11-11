import { useEffect, useMemo, useRef, useState } from 'react';
import { HeroMachine } from '../components/HeroMachine';
import { CardSkeletons, LaunchCard } from '../components/LaunchCard';
import { Reels, type ReelsHandle, type Sym } from '../components/Reels';
import { BulbBorder, CountUp, SplitBar } from '../components/ui';
import { CONFIG, DEMO, IS_DEVNET, programSourceUrl } from '../config';
import { hours, sol } from '../lib/format';
import { useChainConfig, useLaunches, useMedia, useReducedMotion } from '../lib/hooks';
import type { ChainConfig, LaunchRow } from '../lib/types';

const L = 1_000_000_000;

function Ticker({ launches }: { launches: LaunchRow[] | null }) {
  const text = useMemo(() => {
    if (!launches) return null;
    if (!launches.length) return 'The floor is quiet. Be the first pull.';
    const hits = launches.filter((l) => l.state === 'hit').length;
    const misses = launches.filter((l) => l.state === 'miss').length;
    const open = launches.filter((l) => l.state === 'open').reduce((a, l) => a + l.hitTotal + l.missTotal, 0);
    return `${launches.length} launches · ${hits} hits · ${misses} misses · ${sol(open)} SOL in open pools`;
  }, [launches]);
  const items = Array.from({ length: 6 }, (_, i) => (
    <span key={i} aria-hidden={i > 0}>
      {text ?? ' '} {DEMO && text ? <b>· DEMO</b> : null}
    </span>
  ));
  return (
    <div className="ticker" aria-live="polite">
      <div className="ticker-track">
        {items}
      </div>
    </div>
  );
}

function Hero({ launches }: { launches: LaunchRow[] | null }) {
  return (
    <section className="hero" aria-labelledby="hero-h">
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">A FRIENDS-ONLY LAUNCHPAD ON SOLANA</p>
          <h1 id="hero-h">
            Every launch is <em>a pull.</em>
          </h1>
          <p className="lede">
            Launch a coin. In 24 hours it either hits or it misses. If it misses, you get one more pull: put your lost fee and the same again on a friend's launch. Double or nothing.
          </p>
          <div className="hero-ctas">
            <a className="btn primary" href="#/launch">
              Launch a coin
            </a>
            <a className="btn gold" href="#/floor">
              Watch the floor
            </a>
          </div>
          <p className="small">Guest list only. {IS_DEVNET ? 'Devnet until we say otherwise.' : ''}</p>
        </div>
        <HeroMachine />
      </div>
      <div style={{ marginTop: 28 }}>
        <Ticker launches={launches} />
      </div>
    </section>
  );
}

const PANEL_REELS: Sym[][] = [
  ['7', 'cherry', 'bar'],
  ['7', '7', 'bar'],
  ['7', '7', '7'],
];

function HowItWorks({ cfg }: { cfg: ChainConfig | null }) {
  const desktop = useMedia('(min-width: 901px)');
  const reduced = useReducedMotion();
  const pinned = desktop && !reduced;
  const section = useRef<HTMLElement>(null);
  const reels = useRef<ReelsHandle>(null);
  const [active, setActive] = useState(0);
  const last = useRef(0);

  useEffect(() => {
    if (!pinned || !section.current) return;
    let kill = () => {};
    void Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(([{ gsap }, { ScrollTrigger }]) => {
      gsap.registerPlugin(ScrollTrigger);
      const st = ScrollTrigger.create({
        trigger: section.current!.querySelector('.how-pin')!,
        start: 'top top',
        end: '+=220%',
        pin: true,
        scrub: true,
        onUpdate: (self) => {
          const i = Math.min(2, Math.floor(self.progress * 3));
          if (i !== last.current) {
            last.current = i;
            setActive(i);
          }
        },
      });
      kill = () => st.kill();
    });
    return () => kill();
  }, [pinned]);

  // each panel turns one reel
  const shown = useRef(0);
  useEffect(() => {
    if (!pinned) return;
    const from = shown.current;
    shown.current = active;
    if (from === active) return;
    void reels.current?.spin(PANEL_REELS[active], { duration: 900, only: [Math.max(from, active)] });
  }, [active, pinned]);

  const fee = cfg ? sol(cfg.launchFee) : '…';
  const panels = [
    <>
      <p className="label">01 · PULL</p>
      <h3>Launch a coin.</h3>
      <p className="lede">
        Name it, give it a ticker and an image, sign once. Your coin goes live on a bonding curve, and your {fee} SOL launch fee goes on the line: it backs your own coin to hit.
      </p>
      <div className="facts">
        <span className="fact">Supply: 1,000,000,000</span>
        <span className="fact">Window: {cfg ? hours(cfg.windowSecs) : '…'}h</span>
        <span className="fact">Launch fee: {fee} SOL</span>
      </div>
    </>,
    <>
      <p className="label">02 · SPIN</p>
      <h3>Hit or miss.</h3>
      <p className="lede">
        A launch <em className="accent">hits</em> when its curve fills and the coin graduates inside the window. Anything else is a miss. No judges, no vibes: the curve either filled or it didn't, and anyone can check.
      </p>
      <div className="facts">
        <span className="fact" style={{ color: 'var(--hit)' }}>7 · 7 · 7 = HIT</span>
        <span className="fact" style={{ color: 'var(--miss)' }}>7 · 🍒 · BAR = MISS</span>
      </div>
    </>,
    <>
      <p className="label">03 · AGAIN</p>
      <h3>Missed? Pull again.</h3>
      <p className="lede">
        A miss unlocks one rematch. Lock your lost fee plus the same again, 2x, on any open launch. Call it right and you take your share of the other side. Call it wrong and the 2x is gone.
      </p>
      <div>
        <a className="btn gold" href="#/run-it-back">
          See how the money moves
        </a>
      </div>
    </>,
  ];

  return (
    <section id="how" ref={section} className={`section how ${pinned ? '' : 'static'}`} aria-labelledby="how-h" style={pinned ? { paddingTop: 0, paddingBottom: 0 } : undefined}>
      <div className="wrap how-pin">
        <div>
          <div className="section-head">
            <h2 id="how-h">
              How one pull <em>works.</em>
            </h2>
          </div>
          {pinned && (
            <div className="how-reels">
              <BulbBorder spacing={26}>
                <Reels ref={reels} height={130} initial={PANEL_REELS[0]} label="One reel turns per step" />
              </BulbBorder>
              <div className="how-dots" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span key={i} className={i <= active ? 'on' : ''} />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="how-panels">
          {panels.map((p, i) => (
            <div key={i} className={`how-panel ${!pinned || i === active ? 'active' : ''}`} aria-hidden={pinned && i !== active}>
              {p}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RunItBack({ cfg }: { cfg: ChainConfig | null }) {
  return (
    <section id="run-it-back" className="section" aria-labelledby="rib-h">
      <div className="wrap">
        <div className="section-head">
          <h2 id="rib-h">
            Double or <em>nothing.</em> Mostly double.
          </h2>
          <p className="lede">
            Every launch opens a pool with two sides. HIT backs the coin to graduate. MISS bets it won't. When the window closes, the winning side splits the losing side. SL0T takes nothing.
          </p>
        </div>
        <div className="big-facts">
          <div className="card big-fact">
            <div className="n">2 sides</div>
            <p>HIT or MISS, pick one.</p>
          </div>
          <div className="card big-fact">
            <div className="n">2x</div>
            <p>a rematch always locks twice what you lost.</p>
          </div>
          <div className="card big-fact">
            <div className="n">0%</div>
            <p>the house cut. There is no house.</p>
          </div>
        </div>

        <div className="card example">
          <ol>
            <li>Ana launches $FROG. Her 0.1 SOL launch fee sits on HIT. $FROG misses. The 0.1 SOL goes to the MISS side.</li>
            <li>Ana runs it back: she locks 0.2 SOL on HIT for Bo's $DUCK.</li>
            <li>The $DUCK pool: 0.6 SOL on HIT, 0.4 SOL on MISS.</li>
            <li>
              $DUCK graduates. HIT wins. Ana gets her 0.2 back plus 0.2 / 0.6 of the 0.4 on MISS: <em className="accent">0.333 SOL.</em>
            </li>
            <li className="muted">If $DUCK had missed, Ana's 0.2 would have gone to the MISS side.</li>
          </ol>
          <div className="example-math">
            <p className="label">$DUCK pool</p>
            <SplitBar hit={0.6 * L} miss={0.4 * L} />
            <div className="row mono small">
              <span style={{ color: 'var(--hit)' }}>
                HIT <CountUp to={0.6} dp={1} /> SOL
              </span>
              <span style={{ color: 'var(--miss)' }}>
                MISS <CountUp to={0.4} dp={1} /> SOL
              </span>
            </div>
            <p className="mono small muted">0.2 + 0.2 / 0.6 × 0.4 =</p>
            <div className="payout">
              <CountUp to={0.333} dp={3} /> <span style={{ fontSize: '0.45em' }}>SOL</span>
            </div>
          </div>
        </div>

        <ul className="rules">
          <li>One rematch per miss. It expires {cfg ? hours(cfg.rematchSecs) : '…'}h after your miss.</li>
          <li>Stakes close {cfg ? hours(cfg.stakeCloseSecs) : '…'}h after a launch opens, so nobody can pile in when the curve is 95% full.</li>
          <li>Max stake per pull: {cfg ? sol(cfg.maxStake) : '…'} SOL.</li>
          <li>If one side of a pool is empty when it resolves, everyone gets refunded. Nobody wins against nobody.</li>
          <li>Your 2x is locked in the pool vault the moment you sign. You're never charged later.</li>
        </ul>
      </div>
    </section>
  );
}

function FloorPreview({ launches, loading }: { launches: LaunchRow[] | null; loading: boolean }) {
  const top = (launches ?? [])
    .filter((l) => l.state === 'open')
    .sort((a, b) => b.hitTotal + b.missTotal - (a.hitTotal + a.missTotal))
    .slice(0, 6);
  return (
    <section id="floor-preview" className="section" aria-labelledby="floor-h">
      <div className="wrap">
        <div className="section-head">
          <h2 id="floor-h">
            The <em>floor.</em>
          </h2>
          <p className="lede">Every coin launched on SL0T, live. Open ones are still spinning.</p>
        </div>
        {loading && !launches ? (
          <CardSkeletons n={3} />
        ) : top.length ? (
          <div className="grid">
            {top.map((l) => (
              <LaunchCard key={l.address} launch={l} />
            ))}
          </div>
        ) : (
          <div className="empty">No coins on the floor yet. Somebody has to go first.</div>
        )}
        <div style={{ marginTop: 24 }}>
          <a className="btn gold" href="#/floor">
            Watch the floor
          </a>
        </div>
      </div>
    </section>
  );
}

function Resolved({ cfg }: { cfg: ChainConfig | null }) {
  const keeper = CONFIG.keeperAddress || (cfg && !DEMO ? cfg.keeper : '');
  const src = programSourceUrl();
  return (
    <section id="resolved" className="section" aria-labelledby="res-h">
      <div className="wrap fair">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2 id="res-h">
            Who calls it? <em>The curve does.</em>
          </h2>
          <p className="lede">
            The program reads the pump.fun curve itself: graduated means HIT, still on the curve when the window closes means MISS. A keeper calls <code className="mono">resolve</code> every 15 minutes, but anyone can, and nobody can make it say something the curve doesn't. Nobody can move a vault's SOL except the winners claiming it.
          </p>
          {src && (
            <div>
              <a className="btn gold" href={src} target="_blank" rel="noreferrer">
                Read the program
              </a>
            </div>
          )}
        </div>
        <div className="panel kv">
          <div>
            <span>Keeper</span>
            <span>{keeper || (DEMO ? 'demo' : '…')}</span>
          </div>
          <div>
            <span>Program</span>
            <span>{CONFIG.programId || 'not deployed yet (demo)'}</span>
          </div>
          <div>
            <span>Runs</span>
            <span>every 15 min on GitHub Actions</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ['Is this a real launchpad?', "The coins are real tokens on a pump.fun bonding curve. It's an MVP for a small group of friends, on devnet first."],
  ['Can I lose more than I lock?', 'No. Whatever you lock is the most you can lose. Nothing is ever taken from your wallet later.'],
  ['Why 2x?', 'Because a rematch should feel like one. You lost x, you put x back plus x more.'],
  ['What if nobody takes the other side?', 'The pool is void and everyone is refunded.'],
  ['Who gets the trading fees?', `${CONFIG.feeLine}. SL0T takes 0% of the pools.`],
  ['Can the host rig it?', 'The outcome is whether the curve graduated, which anyone can check on chain. The keeper can only resolve; it can\'t move funds.'],
  ['How do I get on the guest list?', 'Ask the host.'],
];

function Faq() {
  return (
    <section id="faq" className="section" aria-labelledby="faq-h">
      <div className="wrap">
        <div className="section-head">
          <h2 id="faq-h">
            Questions at the <em>bar.</em>
          </h2>
        </div>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Landing() {
  const cfg = useChainConfig();
  const { data: launches, loading } = useLaunches(30_000);
  const reduced = useReducedMotion();
  const desktop = useMedia('(min-width: 901px)');

  // Lenis smooth scroll on desktop, synced with ScrollTrigger
  useEffect(() => {
    if (reduced || !desktop) return;
    let destroy = () => {};
    void Promise.all([import('lenis'), import('gsap'), import('gsap/ScrollTrigger')]).then(([{ default: Lenis }, { gsap }, { ScrollTrigger }]) => {
      gsap.registerPlugin(ScrollTrigger);
      const lenis = new Lenis({ duration: 1.05, smoothWheel: true });
      lenis.on('scroll', ScrollTrigger.update);
      const tick = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
      destroy = () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
      };
    });
    return () => destroy();
  }, [reduced, desktop]);

  return (
    <main id="main" tabIndex={-1}>
      <Hero launches={launches} />
      <HowItWorks cfg={cfg} />
      <RunItBack cfg={cfg} />
      <FloorPreview launches={launches} loading={loading} />
      <Resolved cfg={cfg} />
      <Faq />
    </main>
  );
}
