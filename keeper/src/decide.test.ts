import { describe, expect, it } from 'vitest';
import { decide, isBenign, progressBps } from './decide';

const L = (deadline: number, hit = 100n, miss = 100n) => ({ deadline, hitTotal: hit, missTotal: miss });
const open = { complete: false, realTokenReserves: 400_000_000_000_000n };
const done = { complete: true, realTokenReserves: 0n };

describe('decide', () => {
  it('resolves HIT early when the curve completes', () => {
    expect(decide(L(2_000), done, 1_000)).toMatchObject({ action: 'resolve', expected: 'hit' });
  });
  it('never resolves MISS early', () => {
    expect(decide(L(2_000), open, 1_999).action).toBe('skip');
  });
  it('resolves MISS at the deadline', () => {
    expect(decide(L(2_000), open, 2_000)).toMatchObject({ action: 'resolve', expected: 'miss' });
  });
  it('expects VOID with one side empty', () => {
    expect(decide(L(2_000, 100n, 0n), done, 1)).toMatchObject({ expected: 'void' });
    expect(decide(L(2_000, 100n, 0n), open, 3_000)).toMatchObject({ expected: 'void' });
  });
  it('skips a missing curve', () => {
    expect(decide(L(0), null, 10).action).toBe('skip');
  });
});

describe('progressBps', () => {
  const init = 793_100_000_000_000n;
  it('matches the program', () => {
    expect(progressBps({ complete: false, realTokenReserves: init }, init)).toBe(0);
    expect(progressBps({ complete: false, realTokenReserves: init / 2n }, init)).toBe(5_000);
    expect(progressBps({ complete: false, realTokenReserves: 0n }, init)).toBe(9_999);
    expect(progressBps(done, init)).toBe(10_000);
    expect(progressBps({ complete: false, realTokenReserves: init * 2n }, init)).toBe(0);
  });
});

describe('isBenign', () => {
  it('treats races as benign', () => {
    expect(isBenign(new Error('Error Code: AlreadyResolved'))).toBe(true);
    expect(isBenign(new Error('custom program error: 0x1776'))).toBe(true);
    expect(isBenign(new Error('insufficient funds'))).toBe(false);
  });
});
