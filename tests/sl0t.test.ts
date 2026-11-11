import { Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULTS, Env, MOCK_PUMP_ID, SOL, expectErr, pda, setup } from './helpers';

const state = (s: any) => Object.keys(s)[0]; // { hit: {} } -> 'hit'

let env: Env;
let ana: Keypair, bo: Keypair, cy: Keypair, dee: Keypair;

beforeAll(async () => {
  env = await setup();
  [ana, bo, cy, dee] = await Promise.all([env.newFriend(), env.newFriend(), env.newFriend(), env.newFriend()]);
});

/** lamports an owner should get from a claim: payout + the closed Stake's rent */
async function expectClaimDelta(owner: Keypair, mint: PublicKey, expectedPayout: number) {
  const stakeRent = await env.lamports(pda.stake(pda.launch(mint), owner.publicKey));
  const before = await env.lamports(owner.publicKey);
  await env.claim(owner, mint);
  const after = await env.lamports(owner.publicKey);
  expect(after - before).toBe(expectedPayout + stakeRent);
}

describe('register_launch', () => {
  it("puts the launcher's launch fee on HIT and funds the vault", async () => {
    const { mint, vault } = await env.launch(ana);
    const l = await env.fetchLaunch(mint);
    expect(state(l.state)).toBe('open');
    expect(l.hitTotal.toNumber()).toBe(DEFAULTS.launchFee);
    expect(l.missTotal.toNumber()).toBe(0);
    expect(l.stakeCount).toBe(1);
    expect(l.deadline.toNumber() - l.openedAt.toNumber()).toBe(DEFAULTS.windowSecs);
    expect(l.stakeCloseAt.toNumber() - l.openedAt.toNumber()).toBe(DEFAULTS.stakeCloseSecs);
    const s = await env.fetchStake(mint, ana.publicKey);
    expect(state(s.side)).toBe('hit');
    expect(s.amount.toNumber()).toBe(DEFAULTS.launchFee);
    const rent = Number((await env.client.getRent()).minimumBalance(0n));
    expect(await env.lamports(vault)).toBe(DEFAULTS.launchFee + rent);
  });

  it('rejects a wallet that is not on the guest list', async () => {
    const stranger = Keypair.generate();
    env.fund(stranger);
    await expectErr(env.launch(stranger), 'NotOnGuestList');
  });

  it('rejects registering without pump.fun create in the same transaction', async () => {
    const mint = Keypair.generate();
    const { mockPump } = await import('./helpers');
    await env.send([mockPump.createV2(mint.publicKey, ana.publicKey)], [ana, mint], ana);
    await expectErr(env.send([await env.registerIx(ana.publicKey, mint.publicKey)], [ana], ana), 'CreateNotInTransaction');
  });

  it("rejects registering someone else's curve", async () => {
    const mint = Keypair.generate();
    const { mockPump } = await import('./helpers');
    await expectErr(
      env.send([mockPump.createV2(mint.publicKey, ana.publicKey, bo.publicKey), await env.registerIx(ana.publicKey, mint.publicKey)], [ana, mint], ana),
      'NotCurveCreator',
    );
  });
});

describe('happy path HIT (early resolve)', () => {
  it('resolves HIT as soon as the curve completes and pays winners pro rata', async () => {
    const { mint } = await env.launch(ana); // 0.1 HIT
    await env.stake(bo, mint, 'miss', 0.2 * SOL);
    await env.stake(cy, mint, 'hit', 0.3 * SOL);
    await env.setCurve(mint, 0n, true);
    await env.resolve(mint); // before the deadline: allowed for HIT
    const l = await env.fetchLaunch(mint);
    expect(state(l.state)).toBe('hit');
    expect(l.evidencePctBps).toBe(10_000);
    expect(l.evidenceComplete).toBe(true);
    expect(l.evidenceSlot.toNumber()).toBeGreaterThan(0);

    await expectClaimDelta(ana, mint, 0.15 * SOL); // 0.1 + 0.1 * 0.2 / 0.4
    await expectClaimDelta(cy, mint, 0.45 * SOL); // 0.3 + 0.3 * 0.2 / 0.4
    await expectErr(env.claim(bo, mint), 'NotAWinner');
    await env.claimLoss(bo, mint);
    const r = await env.fetchRematch(bo.publicKey);
    expect(r.amountLost.toNumber()).toBe(0.2 * SOL);
    expect(r.used).toBe(false);
    expect(r.sourceLaunch.toBase58()).toBe(pda.launch(mint).toBase58());
  });

  it('records progress evidence from a real mainnet complete-curve snapshot', async () => {
    const { mint } = await env.launch(ana);
    await env.stake(bo, mint, 'miss', 0.1 * SOL);
    const fx = JSON.parse(readFileSync(new URL('./fixtures/mainnet-curves.json', import.meta.url), 'utf8'));
    const data = Buffer.from(fx.complete.data[0], 'base64');
    expect(data[48]).toBe(1);
    const curve = pda.curve(mint);
    const acc = await env.client.getAccount(curve);
    env.context.setAccount(curve, { lamports: acc!.lamports, data, owner: MOCK_PUMP_ID, executable: false });
    await env.resolve(mint);
    const l = await env.fetchLaunch(mint);
    expect(state(l.state)).toBe('hit');
    expect(l.evidencePctBps).toBe(10_000);
  });
});

describe('happy path MISS', () => {
  it('cannot resolve MISS before the deadline, then resolves MISS after it', async () => {
    const { mint } = await env.launch(ana);
    await env.stake(bo, mint, 'miss', 0.3 * SOL);
    await env.setCurve(mint, 396_550_000_000_000n, false); // 50% sold
    await expectErr(env.resolve(mint), 'NotResolvable');
    const l0 = await env.fetchLaunch(mint);
    await env.warpTo(l0.deadline.toNumber());
    await env.resolve(mint);
    const l = await env.fetchLaunch(mint);
    expect(state(l.state)).toBe('miss');
    expect(l.evidencePctBps).toBe(5_000);
    expect(l.evidenceComplete).toBe(false);
    await expectErr(env.resolve(mint), 'AlreadyResolved');

    await expectClaimDelta(bo, mint, 0.4 * SOL); // 0.3 + 0.3 * 0.1 / 0.3
    await env.claimLoss(ana, mint);
    const r = await env.fetchRematch(ana.publicKey);
    expect(r.amountLost.toNumber()).toBe(DEFAULTS.launchFee);
  });
});

describe('VOID', () => {
  it('voids when one side is empty and refunds everyone', async () => {
    const { mint } = await env.launch(cy);
    await env.setCurve(mint, 0n, true); // even a graduated curve is VOID with nobody on MISS
    await env.resolve(mint);
    const l = await env.fetchLaunch(mint);
    expect(state(l.state)).toBe('void');
    await expectClaimDelta(cy, mint, DEFAULTS.launchFee);
    await expectErr(env.claimLoss(cy, mint), 'AccountNotInitialized', 'NotALoser');
  });
});

describe('stakes', () => {
  it('fails after stakes close', async () => {
    const { mint } = await env.launch(ana);
    const l = await env.fetchLaunch(mint);
    await env.warpTo(l.stakeCloseAt.toNumber());
    await expectErr(env.stake(bo, mint, 'miss', 0.1 * SOL), 'StakesClosed');
  });

  it('fails for a non-friend', async () => {
    const { mint } = await env.launch(ana);
    const stranger = Keypair.generate();
    env.fund(stranger);
    await expectErr(env.stake(stranger, mint, 'miss', 0.1 * SOL), 'NotOnGuestList');
  });

  it('allows adding to the same side, blocks switching sides, enforces max stake', async () => {
    const { mint } = await env.launch(ana);
    await env.stake(bo, mint, 'miss', 0.4 * SOL);
    await env.stake(bo, mint, 'miss', 0.4 * SOL);
    expect((await env.fetchStake(mint, bo.publicKey)).amount.toNumber()).toBe(0.8 * SOL);
    await expectErr(env.stake(bo, mint, 'hit', 0.1 * SOL), 'SideLocked');
    await expectErr(env.stake(bo, mint, 'miss', 0.3 * SOL), 'MaxStakeExceeded');
    await expectErr(env.stake(cy, mint, 'hit', 0), 'ZeroAmount');
  });
});

describe('rematch', () => {
  it('locks exactly 2x, is single use, cannot go on the source launch, and expires', async () => {
    // dee loses 0.15 on MISS
    const first = await env.launch(ana);
    await env.stake(dee, first.mint, 'miss', 0.15 * SOL);
    await env.setCurve(first.mint, 0n, true);
    await env.resolve(first.mint);
    await env.claimLoss(dee, first.mint);
    const r = await env.fetchRematch(dee.publicKey);
    expect(r.amountLost.toNumber()).toBe(0.15 * SOL);

    const next = await env.launch(bo);
    await expectErr(env.stakeRematch(dee, next.mint, 'hit', 0.15 * SOL), 'RematchAmountFixed');
    await env.stakeRematch(dee, next.mint, 'hit', 0.3 * SOL);
    const s = await env.fetchStake(next.mint, dee.publicKey);
    expect(s.amount.toNumber()).toBe(0.3 * SOL);
    expect(s.isRematch).toBe(true);
    expect((await env.fetchRematch(dee.publicKey)).used).toBe(true);

    const third = await env.launch(cy);
    await expectErr(env.stakeRematch(dee, third.mint, 'hit', 0.3 * SOL), 'RematchUsed');
  });

  it('cannot be used on the launch that was lost', async () => {
    // A launch whose stake window is still open after the loss is impossible
    // (resolution needs the window or a graduation), so this checks the guard
    // directly: lose on a launch, then try the rematch on the same pool.
    const src = await env.launch(cy);
    await env.stake(ana, src.mint, 'miss', 0.1 * SOL);
    await env.setCurve(src.mint, 0n, true);
    await env.resolve(src.mint);
    await env.claimLoss(ana, src.mint);
    await expectErr(env.stakeRematch(ana, src.mint, 'hit', 0.2 * SOL), 'RematchOnSourceLaunch', 'AlreadyResolved');
  });

  it('expires after rematch_secs', async () => {
    const src = await env.launch(bo);
    await env.stake(cy, src.mint, 'miss', 0.1 * SOL);
    await env.setCurve(src.mint, 0n, true);
    await env.resolve(src.mint);
    await env.claimLoss(cy, src.mint);
    const r = await env.fetchRematch(cy.publicKey);
    await env.warpTo(r.expiresAt.toNumber());
    const target = await env.launch(ana);
    await expectErr(env.stakeRematch(cy, target.mint, 'hit', 0.2 * SOL), 'RematchExpired');
  });

  it('chains: a lost rematch unlocks another one, capped at max stake', async () => {
    const f = await env.newFriend();
    const src = await env.launch(ana);
    await env.stake(f, src.mint, 'miss', 0.8 * SOL);
    await env.setCurve(src.mint, 0n, true);
    await env.resolve(src.mint);
    await env.claimLoss(f, src.mint);
    expect((await env.fetchRematch(f.publicKey)).amountLost.toNumber()).toBe(0.5 * SOL); // 2x capped at 1 SOL
    const next = await env.launch(bo);
    await env.stakeRematch(f, next.mint, 'miss', 1 * SOL);
    await env.setCurve(next.mint, 0n, true);
    await env.resolve(next.mint);
    await env.claimLoss(f, next.mint);
    const r = await env.fetchRematch(f.publicKey);
    expect(r.amountLost.toNumber()).toBe(0.5 * SOL);
    expect(r.used).toBe(false);
  });
});

describe('claims and funds safety', () => {
  it('rounds down, never overpays, and sweeps dust to the creator', async () => {
    const [w1, w2] = [await env.newFriend(), await env.newFriend()];
    const { mint, vault } = await env.launch(ana); // 0.1 HIT
    await env.stake(w1, mint, 'hit', 1); // 1 lamport
    await env.stake(w2, mint, 'hit', 2); // 2 lamports
    await env.stake(bo, mint, 'miss', 100);
    await env.setCurve(mint, 0n, true);
    await env.resolve(mint);
    const winTotal = 0.1 * SOL + 3;
    const share = (x: number) => x + Math.floor((x * 100) / winTotal);
    await expectClaimDelta(w1, mint, share(1));
    await expectClaimDelta(w2, mint, share(2));
    await expectErr(env.sweepDust(mint), 'NotAllSettled');
    await expectClaimDelta(ana, mint, share(0.1 * SOL));
    await env.claimLoss(bo, mint);

    const rent = Number((await env.client.getRent()).minimumBalance(0n));
    const left = await env.lamports(vault);
    const paid = share(1) + share(2) + share(0.1 * SOL);
    expect(left).toBe(rent + winTotal + 100 - paid);
    expect(left - rent).toBeGreaterThanOrEqual(0);

    await expectErr(env.sweepDust(mint, env.keeper), 'Unauthorized', 'ConstraintHasOne');
    const before = await env.lamports(ana.publicKey);
    await env.sweepDust(mint);
    expect(await env.lamports(vault)).toBe(0);
    expect((await env.lamports(ana.publicKey)) - before).toBe(left);
  });

  it('double claim fails', async () => {
    const { mint } = await env.launch(ana);
    await env.stake(bo, mint, 'miss', 0.1 * SOL);
    await env.setCurve(mint, 0n, true);
    await env.resolve(mint);
    await env.claim(ana, mint);
    await expectErr(env.claim(ana, mint), 'AccountNotInitialized', 'could not find account', 'Could not find');
  });

  it("keeper cannot withdraw: not from someone else's stake, not via sweep", async () => {
    const { mint } = await env.launch(ana);
    await env.stake(bo, mint, 'miss', 0.1 * SOL);
    await env.setCurve(mint, 0n, true);
    await env.resolve(mint, env.keeper);
    env.fund(env.keeper);
    await expectErr(env.claim(env.keeper, mint, ana.publicKey), 'ConstraintSeeds', 'ConstraintHasOne');
    await expectErr(env.sweepDust(mint, env.keeper), 'Unauthorized', 'ConstraintHasOne');
  });

  it('claim before resolution fails', async () => {
    const { mint } = await env.launch(ana);
    await expectErr(env.claim(ana, mint), 'NotResolved');
  });
});
