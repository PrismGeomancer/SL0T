import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import idl from '../idl/sl0t.json';
import { decodeCurve, decodeGlobalInitialRealTokens, progressBps } from './curve';
import { DEMO_LAUNCHES, DEMO_LOG } from './demo';
import { friendlyError } from './errors';
import { hhmm, hhmmss, pct, short, signedSol, sol, toLamports } from './format';
import { cappedLost, rematchAmount, returnPer, stakeOutcome, winnerPayout } from './math';

const L = 1_000_000_000;

describe('pool math (mirrors programs/sl0t/src/math.rs)', () => {
  it('matches the copy deck worked example: 0.333 SOL', () => {
    expect(winnerPayout(0.2 * L, 0.6 * L, 0.4 * L)).toBe(333_333_333);
    expect(sol(winnerPayout(0.2 * L, 0.6 * L, 0.4 * L))).toBe('0.333');
  });
  it('rounds down and never pays out more than the pool', () => {
    const win = [1, 2, 3];
    const paid = win.reduce((a, x) => a + winnerPayout(x, 6, 100), 0);
    expect(paid).toBe(17 + 35 + 53); // 105 of a 106 pool
    expect(106 - paid).toBe(1); // 1 lamport of rounding dust stays in the vault
    expect(winnerPayout(1, 6, 100)).toBe(1 + 16);
    expect(winnerPayout(2, 6, 100)).toBe(2 + 33);
    expect(winnerPayout(3, 6, 100)).toBe(3 + 50);
  });
  it('previews the return of a new 1 SOL stake', () => {
    // pool 0.6 HIT / 0.4 MISS; adding 1 SOL to HIT makes HIT 1.6
    expect(returnPer(L, 'hit', 0.6 * L, 0.4 * L)).toBe(L + Math.floor((L * 0.4 * L) / (1.6 * L)));
    expect(returnPer(L, 'miss', 0.1 * L, 0)).toBe(L + Math.floor((L * 0.1 * L) / L));
    expect(returnPer(L, 'hit', 0.1 * L, 0)).toBe(L); // nobody on the other side yet
  });
  it('classifies outcomes', () => {
    const l = { hitTotal: 0.6 * L, missTotal: 0.4 * L };
    expect(stakeOutcome({ side: 'hit', amount: 0.2 * L }, { ...l, state: 'open' }).kind).toBe('pending');
    expect(stakeOutcome({ side: 'hit', amount: 0.2 * L }, { ...l, state: 'hit' })).toEqual({ kind: 'won', payout: 333_333_333 });
    expect(stakeOutcome({ side: 'miss', amount: 0.4 * L }, { ...l, state: 'hit' })).toEqual({ kind: 'lost', amount: 0.4 * L });
    expect(stakeOutcome({ side: 'miss', amount: 0.4 * L }, { ...l, state: 'void' })).toEqual({ kind: 'refund', payout: 0.4 * L });
  });
  it('rematch is exactly 2x and the chain caps at max stake', () => {
    expect(rematchAmount(0.1 * L)).toBe(0.2 * L);
    expect(rematchAmount(cappedLost(0.8 * L, L))).toBe(L);
  });
});

describe('pump.fun curve decoding against real mainnet snapshots', () => {
  const fx = JSON.parse(readFileSync(new URL('../../../tests/fixtures/mainnet-curves.json', import.meta.url), 'utf8'));
  it('reads a complete curve', () => {
    const c = decodeCurve(Buffer.from(fx.complete.data[0], 'base64'))!;
    expect(c.complete).toBe(true);
    expect(progressBps(c, 793_100_000_000_000n)).toBe(10_000);
  });
  it('reads an open curve', () => {
    const c = decodeCurve(Buffer.from(fx.open.data[0], 'base64'))!;
    expect(c.complete).toBe(false);
    expect(progressBps(c, 793_100_000_000_000n)).toBeLessThan(10_000);
  });
  it('rejects other accounts', () => {
    const d = Buffer.from(fx.open.data[0], 'base64');
    d[0] ^= 1;
    expect(decodeCurve(d)).toBeNull();
    expect(decodeGlobalInitialRealTokens(new Uint8Array(10))).toBe(793_100_000_000_000n);
  });
  it('progress math', () => {
    const init = 793_100_000_000_000n;
    expect(progressBps({ complete: false, realTokenReserves: init / 2n }, init)).toBe(5000);
    expect(progressBps({ complete: false, realTokenReserves: 0n }, init)).toBe(9999);
  });
});

describe('format', () => {
  it('sol', () => {
    expect(sol(0)).toBe('0');
    expect(sol(L)).toBe('1');
    expect(sol(0.1 * L)).toBe('0.1');
    expect(sol(1)).toBe('<0.001');
    expect(signedSol(-0.25 * L)).toBe('−0.25');
    expect(signedSol(0.25 * L)).toBe('+0.25');
  });
  it('toLamports', () => {
    expect(toLamports('0.1')).toBe(100_000_000);
    expect(toLamports('1,5')).toBe(1_500_000_000);
    expect(toLamports('.')).toBeNull();
    expect(toLamports('abc')).toBeNull();
    expect(toLamports('0.0000000001')).toBeNull();
  });
  it('times', () => {
    expect(hhmm(3661)).toBe('01:01');
    expect(hhmmss(3661)).toBe('01:01:01');
    expect(hhmm(-5)).toBe('00:00');
    expect(pct(4120)).toBe('41');
    expect(pct(250)).toBe('2.5');
    expect(short('5kgnp4QxSM3VEJgrqKeDL4W86Gh2iZNkGAwBXNuMP9Hq')).toBe('5kgn…P9Hq');
  });
});

describe('error mapping (copy deck strings)', () => {
  it('maps wallet + program errors', () => {
    expect(friendlyError(new Error('User rejected the request.'))).toBe('You cancelled the signature. No harm done.');
    expect(friendlyError({ message: 'x', logs: ['Program log: AnchorError ... Error Code: StakesClosed. Error Number: 6001.'] })).toBe('Stakes on this coin are closed.');
    expect(friendlyError({ logs: ['Error Code: NotOnGuestList'] })).toBe('This floor is guest list only.');
    expect(friendlyError({ logs: ['Error Code: RematchExpired'] })).toBe('Your rematch expired.');
    expect(friendlyError({ logs: ['Error Code: RematchAmountFixed'] }, { rematchLamports: 0.2 * L })).toBe('Rematch amount is fixed at 0.2 SOL.');
    expect(friendlyError({ logs: ['Error Code: MaxStakeExceeded'] }, { maxStakeLamports: L })).toBe('Max stake is 1 SOL.');
    expect(friendlyError(new Error('insufficient funds'), { needLamports: 0.15 * L })).toBe('Not enough SOL. You need 0.15 SOL including fees.');
    expect(friendlyError(new Error('Failed to fetch'))).toBe("Couldn't reach the RPC. Check your connection or try again.");
    expect(friendlyError(new Error('Blockhash not found'))).toBe('The network is busy. Try again in a moment.');
    expect(friendlyError(new Error('upload failed: 402'))).toBe('Image upload failed. Try a smaller file.');
    expect(friendlyError(new Error('weird thing'))).toBe('Transaction failed: weird thing');
  });
});

describe('IDL consistency', () => {
  const disc = (s: string) => Array.from(createHash('sha256').update(s).digest().subarray(0, 8));
  it('discriminators are Anchor-derived', () => {
    for (const ix of idl.instructions) expect(ix.discriminator).toEqual(disc(`global:${ix.name}`));
    for (const a of idl.accounts) expect(a.discriminator).toEqual(disc(`account:${a.name}`));
    for (const e of idl.events) expect(e.discriminator).toEqual(disc(`event:${e.name}`));
  });
  it('error codes line up with the program', () => {
    expect(idl.errors.find((e) => e.name === 'NotOnGuestList')?.code).toBe(6000);
    expect(idl.errors.find((e) => e.name === 'AlreadyResolved')?.code).toBe(6005);
  });
  it('Launch.state sits at byte 168 (keeper + frontend filters)', () => {
    const t = idl.types.find((x) => x.name === 'Launch')!;
    const fields = (t.type as { fields: { name: string; type: unknown }[] }).fields;
    const size = (ty: unknown) => (ty === 'pubkey' ? 32 : ty === 'i64' || ty === 'u64' ? 8 : 0);
    let off = 8;
    for (const f of fields) {
      if (f.name === 'state') break;
      off += size(f.type);
    }
    expect(off).toBe(168);
  });
});

describe('demo data', () => {
  it('is flagged demo and internally consistent', () => {
    expect(DEMO_LAUNCHES).toHaveLength(6);
    for (const l of DEMO_LAUNCHES) {
      expect(l.demo).toBe(true);
      expect(l.deadline).toBeGreaterThan(l.openedAt);
      if (l.state === 'hit') expect(l.curveComplete).toBe(true);
    }
    expect(DEMO_LOG.every((r) => r.sig === '')).toBe(true);
  });
});
