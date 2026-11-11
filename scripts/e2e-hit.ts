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
  console.log('--- HIT path: a real graduation');
  const A = await launch(ana);
  console.log(`   coin ${A.mint.toBase58()}`);
  await stake(bo, A.launch, 'miss', 0.3 * L);
  await stake(ana, A.launch, 'hit', 0.1 * L).catch(() => {}); // ana adds to her HIT side

  const buyer = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(buyer.publicKey, 300 * L));
  const online = new pump.OnlinePumpSdk(conn);
  const { TOKEN_2022_PROGRAM_ID } = createRequire(import.meta.url)('@solana/spl-token');
  const global = await online.fetchGlobal();
  const feeConfig = await online.fetchFeeConfig().catch(() => null);
  // the SDK picks a random fee/buyback recipient; make every candidate exist locally
  const cands = new Set<string>();
  const g: any = global;
  for (const v of [g.feeRecipient, ...(g.feeRecipients ?? []), ...(g.buybackFeeRecipients ?? []), ...(g.reservedFeeRecipients ?? []), g.withdrawAuthority, g.creatorFeeRecipient]) if (v?.toBase58) cands.add(v.toBase58());
  for (const a of cands) if (!(await conn.getAccountInfo(new PublicKey(a)))) await conn.confirmTransaction(await conn.requestAirdrop(new PublicKey(a), 1 * L));
  console.log(`   funded ${cands.size} fee-recipient candidates`);
  const st = await online.fetchBuyState(A.mint, buyer.publicKey, TOKEN_2022_PROGRAM_ID);
  const amount = st.bondingCurve.realTokenReserves;
  const { NATIVE_MINT } = createRequire(import.meta.url)('@solana/spl-token');
  const solCost = pump.getBuySolAmountFromTokenAmount({ global, feeConfig, mintSupply: st.bondingCurve.tokenTotalSupply, bondingCurve: st.bondingCurve, amount, quoteMint: NATIVE_MINT });
  console.log(`   buying out the curve: ${Number(solCost.toString()) / L} SOL`);
  const ixs = await pump.PUMP_SDK.buyInstructions({ global, bondingCurveAccountInfo: st.bondingCurveAccountInfo, bondingCurve: st.bondingCurve, associatedUserAccountInfo: st.associatedUserAccountInfo, mint: A.mint, user: buyer.publicKey, amount, solAmount: solCost, slippage: 5, tokenProgram: TOKEN_2022_PROGRAM_ID });
  let done = false;
  for (let i = 0; i < 12 && !done; i++) {
    try {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
      if (i === 0) { tx.feePayer = buyer.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; const keys = tx.compileMessage().accountKeys; for (const idx of [1, 2, 3, 4]) { const k = keys[idx]; const inf = await conn.getAccountInfo(k); console.log('   acct', idx, k.toBase58(), inf ? `${inf.lamports} lamports, ${inf.data.length}B` : 'MISSING'); } }
      await sendAndConfirmTransaction(conn, tx, [buyer]);
      done = true;
    } catch (e: any) {
      const m = String(e?.message ?? e);
      if (!/AccountNotFound|not found|Provided owner|invalid account/i.test(m) || i === 11) { console.log('buy failed:', m.slice(0, 400), (e?.logs ?? []).slice(-6)); break; }
    }
  }
  const raw = await conn.getAccountInfo(pump.bondingCurvePda(A.mint));
  const complete = raw!.data[48] === 1;
  check('pump.fun curve is complete after the buy', complete);
  if (!complete) process.exit(1);

  const early = (await (prog(ana).account as any).launch.fetch(A.launch));
  check('deadline has NOT passed yet (early HIT)', Date.now() / 1000 < early.deadline.toNumber());
  const acts = runKeeper().filter((r) => r.launch === A.launch.toBase58());
  check('keeper resolved HIT early', acts.some((r) => r.action === 'resolved' && r.expected === 'hit'), JSON.stringify(acts.map((r) => `${r.action}:${r.expected ?? ''}`)));
  const la = await (prog(ana).account as any).launch.fetch(A.launch);
  check('state HIT, evidence 100% / complete', state(la) === 'hit' && la.evidencePctBps === 10000 && la.evidenceComplete === true, `pct=${la.evidencePctBps}`);

  const a0 = await bal(ana.publicKey);
  await claim(ana, A.launch);
  const got = (await bal(ana.publicKey)) - a0;
  // ana had 0.2 on HIT (0.1 fee + 0.1 add); HIT total 0.2, MISS 0.3 => ana wins 0.5
  check('ana (only HIT staker) wins 0.2 + 0.3 = 0.5 SOL', got > 0.5 && got < 0.51, `(+${got.toFixed(5)})`);
  await claimLoss(bo, A.launch);
  const rm = await (prog(bo).account as any).rematch.fetch(seed('rematch', bo.publicKey));
  check('bo lost 0.3 and gets a 0.6 rematch', rm.amountLost.toNumber() === 0.3 * L);
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL HIT CHECKS PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('ERROR', e?.logs ?? e);
  process.exit(1);
});
