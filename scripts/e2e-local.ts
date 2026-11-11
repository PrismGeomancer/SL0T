/**
 * End-to-end loop against a local validator that has pump.fun cloned from devnet.
 * Uses the REAL pump.fun create_v2 instruction (via @pump-fun/pump-sdk) + sl0t.
 *
 *   keys/{admin,keeper,ana,bo}.json must exist and be funded.
 *   RPC_URL=http://127.0.0.1:8899 pnpm tsx scripts/e2e-local.ts
 */
import anchor, { type Idl } from '@coral-xyz/anchor';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const { AnchorProvider, BN, Program, Wallet } = anchor;
const pump = createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof import('@pump-fun/pump-sdk');
const idl = JSON.parse(readFileSync(new URL('../tests/idl/sl0t.json', import.meta.url), 'utf8')) as Idl & { address: string };
const rpc = process.env.RPC_URL || 'http://127.0.0.1:8899';
const conn = new Connection(rpc, 'confirmed');
const load = (n: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(new URL(`../keys/${n}.json`, import.meta.url), 'utf8'))));
const [admin, keeper, ana, bo] = ['admin', 'keeper', 'ana', 'bo'].map(load);
const PID = new PublicKey(idl.address);
const seed = (s: string, ...k: PublicKey[]) => PublicKey.findProgramAddressSync([Buffer.from(s), ...k.map((x) => x.toBuffer())], PID)[0];
const prog = (kp: Keypair) => new Program(idl, new AnchorProvider(conn, new Wallet(kp), { commitment: 'confirmed' })) as any;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const L = 1e9;
const bal = async (k: PublicKey) => (await conn.getBalance(k)) / L;
let failed = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!ok) failed++;
};
const side = (s: 'hit' | 'miss') => (s === 'hit' ? { hit: {} } : { miss: {} });
const state = (l: any) => Object.keys(l.state)[0];

async function launch(creator: Keypair) {
  const mint = Keypair.generate();
  const create = await pump.PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: 'Frog Of Wall Street', symbol: 'FROG', uri: 'https://example.invalid/f.json', creator: creator.publicKey, user: creator.publicKey, mayhemMode: false });
  const l = seed('launch', mint.publicKey);
  const reg = await prog(creator).methods.registerLaunch().accountsStrict({
    creator: creator.publicKey, config: seed('config'), friend: seed('friend', creator.publicKey), mint: mint.publicKey,
    bondingCurve: pump.bondingCurvePda(mint.publicKey), launch: l, vault: seed('vault', l), creatorStake: seed('stake', l, creator.publicKey),
    instructions: SYSVAR_INSTRUCTIONS_PUBKEY, systemProgram: SystemProgram.programId,
  }).instruction();
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), create, reg);
  const sig = await sendAndConfirmTransaction(conn, tx, [creator, mint]);
  return { mint: mint.publicKey, launch: l, sig, size: tx.serialize({ requireAllSignatures: false }).length };
}

const stake = (who: Keypair, launch: PublicKey, s: 'hit' | 'miss', lamports: number) =>
  prog(who).methods.stake(side(s), new BN(lamports)).accountsStrict({ owner: who.publicKey, config: seed('config'), friend: seed('friend', who.publicKey), launch, vault: seed('vault', launch), stake: seed('stake', launch, who.publicKey), systemProgram: SystemProgram.programId }).rpc();

const rematch = (who: Keypair, launch: PublicKey, s: 'hit' | 'miss', lamports: number) =>
  prog(who).methods.stakeRematch(side(s), new BN(lamports)).accountsStrict({ owner: who.publicKey, config: seed('config'), friend: seed('friend', who.publicKey), launch, vault: seed('vault', launch), stake: seed('stake', launch, who.publicKey), rematch: seed('rematch', who.publicKey), systemProgram: SystemProgram.programId }).rpc();

const claim = (who: Keypair, launch: PublicKey) =>
  prog(who).methods.claim().accountsStrict({ owner: who.publicKey, launch, vault: seed('vault', launch), stake: seed('stake', launch, who.publicKey), systemProgram: SystemProgram.programId }).rpc();

const claimLoss = (who: Keypair, launch: PublicKey) =>
  prog(who).methods.claimLoss().accountsStrict({ owner: who.publicKey, config: seed('config'), launch, stake: seed('stake', launch, who.publicKey), rematch: seed('rematch', who.publicKey), systemProgram: SystemProgram.programId }).rpc();

function runKeeper() {
  const out = execFileSync('pnpm', ['-s', '-C', 'keeper', 'keeper'], {
    encoding: 'utf8',
    env: { ...process.env, RPC_URL: rpc, KEEPER_SECRET_KEY: JSON.stringify(Array.from(keeper.secretKey)), PROGRAM_ID: PID.toBase58(), CLUSTER: 'localnet' },
  });
  return out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
}

(async () => {
  console.log('--- 1. real pump.fun create_v2 + register_launch in one transaction');
  const A = await launch(ana);
  console.log(`   FROG mint ${A.mint.toBase58()}  tx ${A.size} bytes  ${A.sig.slice(0, 12)}…`);
  check('transaction fits in 1232 bytes', A.size <= 1232, `(${A.size})`);
  let la = await (prog(ana).account as any).launch.fetch(A.launch);
  check('launch is open, fee on HIT', state(la) === 'open' && la.hitTotal.toNumber() === 0.1 * L);

  console.log('--- 2. non-friend and double-sided stakes are rejected');
  const stranger = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(stranger.publicKey, 2 * L));
  try { await stake(stranger, A.launch, 'miss', 0.1 * L); check('non-friend rejected', false); } catch (e: any) { check('non-friend rejected', /NotOnGuestList|guest list/i.test(String(e?.message) + (e?.logs ?? []))); }

  console.log('--- 3. bo takes MISS; window closes; keeper resolves MISS');
  await stake(bo, A.launch, 'miss', 0.2 * L);
  la = await (prog(ana).account as any).launch.fetch(A.launch);
  check('pool is 0.1 HIT / 0.2 MISS', la.hitTotal.toNumber() === 0.1 * L && la.missTotal.toNumber() === 0.2 * L);
  const early = runKeeper().filter((r) => r.launch === A.launch.toBase58());
  check('keeper does not resolve early', early.every((r) => r.action === 'skip'), JSON.stringify(early.map((r) => r.action)));
  await sleep(Math.max(0, la.deadline.toNumber() * 1000 - Date.now()) + 3000);
  const acts = runKeeper().filter((r) => r.launch === A.launch.toBase58());
  check('keeper resolved it', acts.some((r) => r.action === 'resolved'), JSON.stringify(acts.map((r) => `${r.action}:${r.expected ?? ''}`)));
  la = await (prog(ana).account as any).launch.fetch(A.launch);
  check('state is MISS with evidence', state(la) === 'miss' && la.evidenceSlot.toNumber() > 0 && la.evidenceComplete === false, `pct=${la.evidencePctBps}bps slot=${la.evidenceSlot}`);

  console.log('--- 4. claims: bo wins, ana loses and unlocks a 2x rematch');
  const b0 = await bal(bo.publicKey);
  await claim(bo, A.launch);
  const gain = (await bal(bo.publicKey)) - b0;
  check('bo gets 0.2 + 0.1 = 0.3 SOL (+ stake rent back)', gain > 0.3 && gain < 0.31, `(+${gain.toFixed(5)})`);
  await claimLoss(ana, A.launch);
  const rm = await (prog(ana).account as any).rematch.fetch(seed('rematch', ana.publicKey));
  check('rematch = lost 0.1, locks 0.2', rm.amountLost.toNumber() === 0.1 * L && !rm.used);

  console.log('--- 5. ana runs it back (exactly 2x) on bo\'s next launch');
  await prog(admin).methods.updateConfig({ admin: null, keeper: null, pumpProgram: null, launchFeeLamports: null, maxStakeLamports: null, windowSecs: new BN(60), stakeCloseSecs: new BN(30), rematchSecs: null, paused: null }).accountsStrict({ admin: admin.publicKey, config: seed('config') }).rpc();
  const B = await launch(bo);
  try { await rematch(ana, B.launch, 'hit', 0.15 * L); check('wrong rematch amount rejected', false); } catch (e: any) { check('wrong rematch amount rejected', /RematchAmountFixed|fixed/i.test(String(e?.message) + (e?.logs ?? []))); }
  await rematch(ana, B.launch, 'hit', 0.2 * L);
  const sa = await (prog(ana).account as any).stake.fetch(seed('stake', B.launch, ana.publicKey));
  check('rematch stake is 0.2 SOL on HIT, marked rematch', sa.amount.toNumber() === 0.2 * L && sa.isRematch === true);
  try { await rematch(ana, A.launch, 'hit', 0.2 * L); check('rematch is single use', false); } catch { check('rematch is single use', true); }

  console.log('--- 6. one-sided pool: B has no MISS side, so it voids and refunds');
  await sleep(61_000);
  const acts2 = runKeeper().filter((r) => r.launch === B.launch.toBase58());
  const lb = await (prog(ana).account as any).launch.fetch(B.launch);
  check('B resolved VOID (nobody on MISS)', state(lb) === 'void', JSON.stringify(acts2.map((r) => `${r.action}:${r.expected ?? ''}`)));
  const a0 = await bal(ana.publicKey);
  await claim(ana, B.launch);
  check('ana refunded 0.2 SOL', (await bal(ana.publicKey)) - a0 > 0.2);

  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERROR', e?.logs ?? e);
  process.exit(1);
});
