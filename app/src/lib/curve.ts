/**
 * Read-only pump.fun decoding, same offsets as programs/sl0t/src/pump.rs.
 * Kept dependency-free so the floor doesn't need the pump SDK bundle.
 */
export const BONDING_CURVE_DISCRIMINATOR = [23, 183, 248, 55, 96, 216, 172, 96];
export const GLOBAL_INITIAL_REAL_TOKENS_OFFSET = 89;
export const DEFAULT_INITIAL_REAL_TOKENS = 793_100_000_000_000n;

export interface CurveRead {
  realTokenReserves: bigint;
  realQuoteReserves: bigint;
  complete: boolean;
  creator: Uint8Array;
}

const u64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getBigUint64(0, true);

export function decodeCurve(data: Uint8Array): CurveRead | null {
  if (data.length < 81) return null;
  for (let i = 0; i < 8; i++) if (data[i] !== BONDING_CURVE_DISCRIMINATOR[i]) return null;
  if (data[48] > 1) return null;
  return {
    realTokenReserves: u64(data, 24),
    realQuoteReserves: u64(data, 32),
    complete: data[48] === 1,
    creator: data.slice(49, 81),
  };
}

export function decodeGlobalInitialRealTokens(data: Uint8Array): bigint {
  if (data.length < GLOBAL_INITIAL_REAL_TOKENS_OFFSET + 8) return DEFAULT_INITIAL_REAL_TOKENS;
  return u64(data, GLOBAL_INITIAL_REAL_TOKENS_OFFSET);
}

export function progressBps(c: Pick<CurveRead, 'complete' | 'realTokenReserves'>, initial: bigint): number {
  if (c.complete) return 10_000;
  if (initial === 0n || c.realTokenReserves >= initial) return 0;
  const bps = ((initial - c.realTokenReserves) * 10_000n) / initial;
  return Number(bps > 9_999n ? 9_999n : bps);
}
