/**
 * SL0T keeper. Every run: find Open launches, read each pump.fun curve, and
 * call `resolve` on the ones that graduated or whose window closed.
 *
 * `resolve` is permissionless and reads the curve on chain, so this script is
 * only a trigger: it can't choose an outcome and can't touch any funds.
 * Idempotent: a launch someone else resolved first is logged as skipped.
 *
 * Env: RPC_URL, KEEPER_SECRET_KEY (base58 or JSON array), PROGRAM_ID, CLUSTER,
 *      DRY_RUN=1 (optional: log decisions, send nothing)
 */
import { AnchorProvider, Program, Wallet, type Idl } from '@coral-xyz/anchor';
import type * as PumpSdkModule from '@pump-fun/pump-sdk';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import idlJson from './idl/sl0t.json' with { type: 'json' };
import { decide, isBenign, progressBps } from './decide.js';
import { createRequire } from 'node:module';

// The SDK's ESM build isn't flagged as a module, so native ESM can't import it; use its CJS build.
const { PUMP_SDK } = createRequire(import.meta.url)('@pump-fun/pump-sdk') as typeof PumpSdkModule;

const LAUNCH_STATE_OFFSET = 8 + 32 * 4 + 8 * 4; // see programs/sl0t/src/state.rs
const GLOBAL_INITIAL_REAL_TOKENS_OFFSET = 89;

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

function env(name: string, required = true): string {
  const v = process.env[name]?.trim() ?? '';
  if (required && !v) {
    log({ level: 'error', msg: `missing env ${name}` });
    process.exit(2);
  }
  return v;
}

function parseSecret(s: string): Keypair {
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s);
  return Keypair.fromSecretKey(bytes);
}

async function main() {
  const rpcUrl = env('RPC_URL');
  const keeper = parseSecret(env('KEEPER_SECRET_KEY'));
  const programId = new PublicKey(env('PROGRAM_ID'));
  const cluster = env('CLUSTER', false) || 'devnet';
  const dryRun = env('DRY_RUN', false) === '1';

  const connection = new Connection(rpcUrl, 'confirmed');
  const provider = new AnchorProvider(connection, new Wallet(keeper), { commitment: 'confirmed' });
  const program = new Program({ ...(idlJson as Idl), address: programId.toBase58() }, provider);

  const balance = await connection.getBalance(keeper.publicKey);
  log({ level: 'info', msg: 'run', cluster, program: programId.toBase58(), keeper: keeper.publicKey.toBase58(), balanceLamports: balance, dryRun });

  const open = await (program.account as any).launch.all([
    { memcmp: { offset: LAUNCH_STATE_OFFSET, bytes: bs58.encode(Uint8Array.from([0])) } },
  ]);
  if (open.length === 0) {
    log({ level: 'info', msg: 'no open launches' });
    return 0;
  }

  const curves = await connection.getMultipleAccountsInfo(open.map((l: any) => l.account.bondingCurve as PublicKey));
  const slot = await connection.getSlot('confirmed');
  const chainNow = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  const globalCache = new Map<string, bigint>();

  let failures = 0;
  for (let i = 0; i < open.length; i++) {
    const { publicKey: launchKey, account: l } = open[i];
    const info = curves[i];
    const pumpProgram: PublicKey = l.pumpProgram;
    const curve = info && info.owner.equals(pumpProgram) ? PUMP_SDK.decodeBondingCurveNullable(info as any) : null;
    const view = curve ? { complete: curve.complete, realTokenReserves: BigInt(curve.realTokenReserves.toString()) } : null;

    const pumpGlobal = PublicKey.findProgramAddressSync([Buffer.from('global')], pumpProgram)[0];
    if (!globalCache.has(pumpGlobal.toBase58())) {
      const g = await connection.getAccountInfo(pumpGlobal);
      globalCache.set(pumpGlobal.toBase58(), g ? g.data.readBigUInt64LE(GLOBAL_INITIAL_REAL_TOKENS_OFFSET) : 0n);
    }
    const pct = view ? progressBps(view, globalCache.get(pumpGlobal.toBase58())!) : 0;

    const d = decide(
      { deadline: Number(l.deadline), hitTotal: BigInt(l.hitTotal.toString()), missTotal: BigInt(l.missTotal.toString()) },
      view,
      chainNow,
    );
    const base = { launch: launchKey.toBase58(), mint: (l.mint as PublicKey).toBase58(), evidenceSlot: slot, evidencePctBps: pct };
    if (d.action === 'skip') {
      log({ level: 'info', action: 'skip', reason: d.reason, ...base });
      continue;
    }
    if (dryRun) {
      log({ level: 'info', action: 'would-resolve', expected: d.expected, reason: d.reason, ...base });
      continue;
    }
    try {
      const sig = await program.methods
        .resolve()
        .accountsStrict({ resolver: keeper.publicKey, launch: launchKey, bondingCurve: l.bondingCurve, pumpGlobal })
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        ])
        .rpc();
      log({ level: 'info', action: 'resolved', expected: d.expected, reason: d.reason, sig, ...base });
    } catch (e) {
      if (isBenign(e)) {
        log({ level: 'info', action: 'skip', reason: 'already resolved or not yet resolvable on chain', ...base });
      } else {
        failures++;
        log({ level: 'error', action: 'resolve-failed', error: String((e as Error)?.message ?? e), logs: (e as any)?.logs, ...base });
      }
    }
  }
  return failures > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    log({ level: 'error', msg: 'fatal', error: String(e?.stack ?? e) });
    process.exit(1);
  });
