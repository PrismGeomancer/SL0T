/** Pure resolution logic, mirrored from the program's `resolve`. */

export type Decision =
  | { action: 'resolve'; expected: 'hit' | 'miss' | 'void'; reason: string }
  | { action: 'skip'; reason: string };

export interface LaunchView {
  deadline: number; // unix secs
  hitTotal: bigint;
  missTotal: bigint;
}

export interface CurveView {
  complete: boolean;
  realTokenReserves: bigint;
}

export function decide(launch: LaunchView, curve: CurveView | null, nowSecs: number): Decision {
  if (!curve) return { action: 'skip', reason: 'bonding curve account not found' };
  const oneSided = launch.hitTotal === 0n || launch.missTotal === 0n;
  if (curve.complete) {
    return { action: 'resolve', expected: oneSided ? 'void' : 'hit', reason: 'curve complete' };
  }
  if (nowSecs >= launch.deadline) {
    return { action: 'resolve', expected: oneSided ? 'void' : 'miss', reason: 'window closed, curve not complete' };
  }
  return { action: 'skip', reason: `open, ${launch.deadline - nowSecs}s left` };
}

/** Same formula as programs/sl0t/src/pump.rs `progress_bps`. */
export function progressBps(curve: CurveView, initialRealTokens: bigint): number {
  if (curve.complete) return 10_000;
  if (initialRealTokens === 0n || curve.realTokenReserves >= initialRealTokens) return 0;
  const bps = ((initialRealTokens - curve.realTokenReserves) * 10_000n) / initialRealTokens;
  return Number(bps > 9_999n ? 9_999n : bps);
}

/** Errors that mean "someone else got there first / not yet": not failures. */
export function isBenign(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err) + JSON.stringify((err as { logs?: unknown })?.logs ?? '');
  return /AlreadyResolved|NotResolvable|0x1775|0x1776|already been processed/.test(s);
}
