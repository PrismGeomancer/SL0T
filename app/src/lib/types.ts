export type LaunchState = 'open' | 'hit' | 'miss' | 'void';
export type Side = 'hit' | 'miss';

export interface ChainConfig {
  admin: string;
  keeper: string;
  pumpProgram: string;
  launchFee: number; // lamports
  maxStake: number; // lamports
  windowSecs: number;
  stakeCloseSecs: number;
  rematchSecs: number;
  paused: boolean;
}

export interface TokenMeta {
  name: string;
  symbol: string;
  image?: string;
  description?: string;
}

export interface LaunchRow {
  address: string;
  mint: string;
  creator: string;
  bondingCurve: string;
  pumpProgram: string;
  openedAt: number;
  deadline: number;
  stakeCloseAt: number;
  resolvedAt: number;
  state: LaunchState;
  hitTotal: number; // lamports
  missTotal: number;
  stakeCount: number;
  settledCount: number;
  evidenceSlot: number;
  evidencePctBps: number;
  evidenceComplete: boolean;
  /** live curve read (0..10000) */
  curvePctBps: number;
  curveComplete: boolean;
  meta?: TokenMeta;
  demo?: boolean;
}

export interface StakeRow {
  address: string;
  owner: string;
  launch: string;
  side: Side;
  amount: number;
  isRematch: boolean;
}

export interface RematchRow {
  owner: string;
  amountLost: number;
  sourceLaunch: string;
  expiresAt: number;
  used: boolean;
}

export type LogEventName = 'LAUNCH' | 'STAKE HIT' | 'STAKE MISS' | 'REMATCH' | 'RESOLVED HIT' | 'RESOLVED MISS' | 'VOID' | 'CLAIM';

export interface LogRow {
  id: string;
  time: number; // unix secs
  event: LogEventName;
  launch: string;
  mint: string;
  wallet: string;
  amount: number | null; // lamports
  sig: string;
  evidence?: { pctBps: number; complete: boolean; slot: number };
  /** for CLAIM rows: what was paid out; for LOSS settle rows: negative */
  payout?: number;
  loss?: boolean;
}
