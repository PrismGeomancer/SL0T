/**
 * DEMO MODE data: shown only while CONFIG.programId is empty. Every card and
 * page using it carries a DEMO chip and the demo banner. Not real coins.
 */
import type { ChainConfig, LaunchRow, LogRow } from './types';

const L = 1_000_000_000;
const T0 = Math.floor(Date.now() / 1000);
const H = 3600;

export const DEMO_CONFIG: ChainConfig = {
  admin: 'DEMO',
  keeper: 'DEMO',
  pumpProgram: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  launchFee: 0.1 * L,
  maxStake: 1 * L,
  windowSecs: 24 * H,
  stakeCloseSecs: 2 * H,
  rematchSecs: 24 * H,
  paused: false,
};

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
// plausible-looking placeholder addresses, deterministic per index
const fakeKey = (n: number) => Array.from({ length: 44 }, (_, i) => B58[(n * 31 + i * 17 + ((i * i * (n + 3)) % 29)) % B58.length]).join('');

function demo(
  n: number,
  name: string,
  symbol: string,
  hue: number,
  openedAgoH: number,
  state: LaunchRow['state'],
  hit: number,
  miss: number,
  pctBps: number,
): LaunchRow {
  const openedAt = T0 - openedAgoH * H;
  const resolved = state !== 'open';
  return {
    address: fakeKey(n),
    mint: fakeKey(n + 50),
    creator: fakeKey(n + 80),
    bondingCurve: fakeKey(n + 20),
    pumpProgram: DEMO_CONFIG.pumpProgram,
    openedAt,
    deadline: openedAt + DEMO_CONFIG.windowSecs,
    stakeCloseAt: openedAt + DEMO_CONFIG.stakeCloseSecs,
    resolvedAt: resolved ? Math.min(T0 - 600, openedAt + (state === 'hit' ? 9 * H : DEMO_CONFIG.windowSecs)) : 0,
    state,
    hitTotal: hit * L,
    missTotal: miss * L,
    stakeCount: 3,
    settledCount: 0,
    evidenceSlot: resolved ? 312_000_000 + n * 1000 : 0,
    evidencePctBps: resolved ? pctBps : 0,
    evidenceComplete: state === 'hit',
    curvePctBps: pctBps,
    curveComplete: state === 'hit',
    meta: { name, symbol, image: demoImage(symbol, hue) },
    demo: true,
  };
}

function demoImage(symbol: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><defs><radialGradient id="g" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="hsl(${hue} 90% 55%)"/><stop offset="1" stop-color="hsl(${hue} 70% 14%)"/></radialGradient></defs><rect width="120" height="120" fill="#120F17"/><circle cx="60" cy="60" r="46" fill="url(#g)" stroke="#FFC24B" stroke-width="4"/><text x="60" y="70" font-family="Verdana" font-weight="700" font-size="${symbol.length > 4 ? 18 : 24}" text-anchor="middle" fill="#F4EEE6">${symbol}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const DEMO_LAUNCHES: LaunchRow[] = [
  demo(1, 'Frog Of Wall Street', 'FROG', 140, 0.7, 'open', 0.6, 0.35, 4120),
  demo(2, 'Duck Season', 'DUCK', 48, 1.4, 'open', 0.6, 0.4, 7330),
  demo(3, 'Late Night Cherry', 'CHRY', 350, 5, 'open', 0.2, 0.9, 1880),
  demo(4, 'Triple Seven', 'SVN', 10, 19, 'open', 1.1, 0.5, 8650),
  demo(5, 'Bar None', 'BAR', 280, 14, 'hit', 0.9, 0.7, 10_000),
  demo(6, 'House Always', 'HOUSE', 200, 30, 'miss', 0.3, 0.8, 2610),
];

export const DEMO_LOG: LogRow[] = DEMO_LAUNCHES.flatMap((l, i) => {
  const rows: LogRow[] = [
    { id: `d${i}a`, time: l.openedAt, event: 'LAUNCH', launch: l.address, mint: l.mint, wallet: l.creator, amount: null, sig: '' },
    { id: `d${i}b`, time: l.openedAt + 5, event: 'STAKE HIT', launch: l.address, mint: l.mint, wallet: l.creator, amount: DEMO_CONFIG.launchFee, sig: '' },
    { id: `d${i}c`, time: l.openedAt + 900, event: 'STAKE MISS', launch: l.address, mint: l.mint, wallet: fakeKey(90 + i), amount: l.missTotal, sig: '' },
  ];
  if (l.hitTotal > DEMO_CONFIG.launchFee)
    rows.push({ id: `d${i}d`, time: l.openedAt + 1800, event: i === 1 ? 'REMATCH' : 'STAKE HIT', launch: l.address, mint: l.mint, wallet: fakeKey(95 + i), amount: l.hitTotal - DEMO_CONFIG.launchFee, sig: '' });
  if (l.state !== 'open')
    rows.push({
      id: `d${i}e`,
      time: l.resolvedAt,
      event: l.state === 'hit' ? 'RESOLVED HIT' : l.state === 'miss' ? 'RESOLVED MISS' : 'VOID',
      launch: l.address,
      mint: l.mint,
      wallet: 'keeper',
      amount: l.hitTotal + l.missTotal,
      sig: '',
      evidence: { pctBps: l.evidencePctBps, complete: l.evidenceComplete, slot: l.evidenceSlot },
    });
  return rows;
}).sort((a, b) => b.time - a.time);

export const demoLaunch = (mint: string) => DEMO_LAUNCHES.find((l) => l.mint === mint) ?? null;
