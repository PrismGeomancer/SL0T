import type { LaunchRow, LaunchState, Side, StakeRow } from './types';

/** Same as programs/sl0t/src/math.rs: amount + floor(amount * losing / winning). */
export function winnerPayout(amount: number, winningTotal: number, losingTotal: number): number {
  if (winningTotal <= 0) return amount;
  const share = (BigInt(Math.round(amount)) * BigInt(Math.round(losingTotal))) / BigInt(Math.round(winningTotal));
  return amount + Number(share);
}

/** "If HIT wins, 1 SOL on HIT returns {r} SOL" — including the stake itself joining the pool. */
export function returnPer(stake: number, side: Side, hitTotal: number, missTotal: number): number {
  const win = (side === 'hit' ? hitTotal : missTotal) + stake;
  const lose = side === 'hit' ? missTotal : hitTotal;
  if (lose === 0) return stake; // nobody on the other side: VOID refund
  return winnerPayout(stake, win, lose);
}

export function winningSide(state: LaunchState): Side | null {
  return state === 'hit' ? 'hit' : state === 'miss' ? 'miss' : null;
}

export type Outcome =
  | { kind: 'pending' }
  | { kind: 'won'; payout: number }
  | { kind: 'refund'; payout: number }
  | { kind: 'lost'; amount: number };

export function stakeOutcome(stake: Pick<StakeRow, 'side' | 'amount'>, launch: Pick<LaunchRow, 'state' | 'hitTotal' | 'missTotal'>): Outcome {
  if (launch.state === 'open') return { kind: 'pending' };
  if (launch.state === 'void') return { kind: 'refund', payout: stake.amount };
  const w = winningSide(launch.state)!;
  if (stake.side !== w) return { kind: 'lost', amount: stake.amount };
  const [win, lose] = w === 'hit' ? [launch.hitTotal, launch.missTotal] : [launch.missTotal, launch.hitTotal];
  return { kind: 'won', payout: winnerPayout(stake.amount, win, lose) };
}

/** Rematch amount the program will demand: 2x amount_lost (already capped at claim_loss). */
export const rematchAmount = (amountLost: number) => amountLost * 2;

/** Mirrors math::capped_amount_lost, for previews before claim_loss runs. */
export const cappedLost = (amount: number, maxStake: number) => Math.min(amount, Math.floor(maxStake / 2));
