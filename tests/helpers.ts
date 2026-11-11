import { BN, Program } from '@coral-xyz/anchor';
import { BankrunProvider } from 'anchor-bankrun';
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Clock, ProgramTestContext, startAnchor } from 'solana-bankrun';

export const idl = JSON.parse(readFileSync(new URL('./idl/sl0t.json', import.meta.url), 'utf8'));
export const SL0T_ID = new PublicKey(idl.address);
export const MOCK_PUMP_ID = new PublicKey('92DA2NnMxr5MvNWDwGFU3YQySJy3GbbeVmxHwkJv9cHa');
export const SOL = LAMPORTS_PER_SOL;
export const sol = (x: number) => new BN(Math.round(x * SOL));

export const DEFAULTS = {
  launchFee: 0.1 * SOL,
  maxStake: 1 * SOL,
  windowSecs: 86_400,
  stakeCloseSecs: 7_200,
  rematchSecs: 86_400,
};

const disc = (s: string) => createHash('sha256').update(s).digest().subarray(0, 8);
const borshString = (s: string) => {
  const b = Buffer.from(s, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

export const pda = {
  config: () => PublicKey.findProgramAddressSync([Buffer.from('config')], SL0T_ID)[0],
  friend: (w: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('friend'), w.toBuffer()], SL0T_ID)[0],
  launch: (mint: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('launch'), mint.toBuffer()], SL0T_ID)[0],
  vault: (launch: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('vault'), launch.toBuffer()], SL0T_ID)[0],
  stake: (launch: PublicKey, owner: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from('stake'), launch.toBuffer(), owner.toBuffer()], SL0T_ID)[0],
  rematch: (owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('rematch'), owner.toBuffer()], SL0T_ID)[0],
  curve: (mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), mint.toBuffer()], MOCK_PUMP_ID)[0],
  pumpGlobal: () => PublicKey.findProgramAddressSync([Buffer.from('global')], MOCK_PUMP_ID)[0],
};

// ---- mock pump.fun instructions (hand-encoded; same discriminators as pump.fun)
export const mockPump = {
  initGlobal: (payer: PublicKey) =>
    new TransactionInstruction({
      programId: MOCK_PUMP_ID,
      keys: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: pda.pumpGlobal(), isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: disc('global:init_global'),
    }),
  createV2: (mint: PublicKey, user: PublicKey, creator = user) =>
    new TransactionInstruction({
      programId: MOCK_PUMP_ID,
      keys: [
        { pubkey: mint, isSigner: true, isWritable: false },
        { pubkey: pda.curve(mint), isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([
        disc('global:create_v2'),
        borshString('Frog Of Wall Street'),
        borshString('FROG'),
        borshString('https://example.invalid/frog.json'),
        creator.toBuffer(),
      ]),
    }),
  setCurve: (signer: PublicKey, mint: PublicKey, realTokenReserves: bigint, complete: boolean) => {
    const amt = Buffer.alloc(8);
    amt.writeBigUInt64LE(realTokenReserves);
    return new TransactionInstruction({
      programId: MOCK_PUMP_ID,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: false },
        { pubkey: pda.curve(mint), isSigner: false, isWritable: true },
      ],
      data: Buffer.concat([disc('global:set_curve'), amt, Buffer.from([complete ? 1 : 0])]),
    });
  },
};

let nonce = 1;
/** Makes otherwise-identical transactions unique (bankrun dedupes by signature). */
export const uniq = () => ComputeBudgetProgram.setComputeUnitPrice({ microLamports: nonce++ });

export type Env = Awaited<ReturnType<typeof setup>>;

export async function setup() {
  const context: ProgramTestContext = await startAnchor('.', [], []);
  const provider = new BankrunProvider(context);
  const program = new Program(idl, provider) as Program<any>;
  const admin = context.payer;
  const keeper = Keypair.generate();
  const client = context.banksClient;

  const fund = (kp: Keypair, lamports = 50 * SOL) =>
    context.setAccount(kp.publicKey, { lamports, data: Buffer.alloc(0), owner: SystemProgram.programId, executable: false });

  const send = async (ixs: TransactionInstruction[], signers: Keypair[], payer?: Keypair) => {
    const tx = new Transaction().add(uniq(), ...ixs);
    if (payer) {
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = (await client.getLatestBlockhash())![0];
      tx.sign(payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey)));
      const res = await client.tryProcessTransaction(tx);
      if (res.result) {
        const err: any = new Error(`${res.result}\n${res.meta?.logMessages.join('\n')}`);
        err.logs = res.meta?.logMessages;
        throw err;
      }
      return res;
    }
    return provider.sendAndConfirm!(tx, signers);
  };

  const now = async () => Number((await client.getClock()).unixTimestamp);
  const warpTo = async (ts: number) => {
    const c = await client.getClock();
    context.setClock(new Clock(c.slot + 10n, c.epochStartTimestamp, c.epoch, c.leaderScheduleEpoch, BigInt(ts)));
  };
  const lamports = async (k: PublicKey) => Number((await client.getAccount(k))?.lamports ?? 0);

  // init mock pump.fun Global + SL0T config
  await send([mockPump.initGlobal(admin.publicKey)], []);
  await program.methods
    .initConfig({
      keeper: keeper.publicKey,
      pumpProgram: MOCK_PUMP_ID,
      launchFeeLamports: new BN(DEFAULTS.launchFee),
      maxStakeLamports: new BN(DEFAULTS.maxStake),
      windowSecs: new BN(DEFAULTS.windowSecs),
      stakeCloseSecs: new BN(DEFAULTS.stakeCloseSecs),
      rematchSecs: new BN(DEFAULTS.rematchSecs),
    })
    .accountsStrict({ admin: admin.publicKey, config: pda.config(), systemProgram: SystemProgram.programId })
    .rpc();

  const addFriend = async (w: PublicKey) =>
    program.methods
      .addFriend(w)
      .accountsStrict({ admin: admin.publicKey, config: pda.config(), friend: pda.friend(w), systemProgram: SystemProgram.programId })
      .preInstructions([uniq()])
      .rpc();

  const newFriend = async () => {
    const kp = Keypair.generate();
    fund(kp);
    await addFriend(kp.publicKey);
    return kp;
  };

  const registerIx = (creator: PublicKey, mint: PublicKey) =>
    program.methods
      .registerLaunch()
      .accountsStrict({
        creator,
        config: pda.config(),
        friend: pda.friend(creator),
        mint,
        bondingCurve: pda.curve(mint),
        launch: pda.launch(mint),
        vault: pda.vault(pda.launch(mint)),
        creatorStake: pda.stake(pda.launch(mint), creator),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

  /** pump.fun create + register_launch in one transaction, like the frontend. */
  const launch = async (creator: Keypair) => {
    const mint = Keypair.generate();
    await send([mockPump.createV2(mint.publicKey, creator.publicKey), await registerIx(creator.publicKey, mint.publicKey)], [creator, mint], creator);
    return { mint: mint.publicKey, launch: pda.launch(mint.publicKey), vault: pda.vault(pda.launch(mint.publicKey)) };
  };

  const stake = async (owner: Keypair, mint: PublicKey, side: 'hit' | 'miss', amount: number) => {
    const l = pda.launch(mint);
    return program.methods
      .stake(side === 'hit' ? { hit: {} } : { miss: {} }, new BN(Math.round(amount)))
      .accountsStrict({
        owner: owner.publicKey,
        config: pda.config(),
        friend: pda.friend(owner.publicKey),
        launch: l,
        vault: pda.vault(l),
        stake: pda.stake(l, owner.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([uniq()])
      .signers([owner])
      .rpc();
  };

  const stakeRematch = async (owner: Keypair, mint: PublicKey, side: 'hit' | 'miss', expected: number) => {
    const l = pda.launch(mint);
    return program.methods
      .stakeRematch(side === 'hit' ? { hit: {} } : { miss: {} }, new BN(Math.round(expected)))
      .accountsStrict({
        owner: owner.publicKey,
        config: pda.config(),
        friend: pda.friend(owner.publicKey),
        launch: l,
        vault: pda.vault(l),
        stake: pda.stake(l, owner.publicKey),
        rematch: pda.rematch(owner.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([uniq()])
      .signers([owner])
      .rpc();
  };

  const resolve = async (mint: PublicKey, resolver: Keypair = keeper) => {
    fund(resolver, Math.max(await lamports(resolver.publicKey), 5 * SOL));
    return program.methods
      .resolve()
      .accountsStrict({ resolver: resolver.publicKey, launch: pda.launch(mint), bondingCurve: pda.curve(mint), pumpGlobal: pda.pumpGlobal() })
      .preInstructions([uniq()])
      .signers([resolver])
      .rpc();
  };

  const setCurve = (mint: PublicKey, realTokenReserves: bigint, complete: boolean) =>
    send([mockPump.setCurve(admin.publicKey, mint, realTokenReserves, complete)], []);

  const claim = async (owner: Keypair, mint: PublicKey, stakeOwner: PublicKey = owner.publicKey) => {
    const l = pda.launch(mint);
    return program.methods
      .claim()
      .accountsStrict({ owner: owner.publicKey, launch: l, vault: pda.vault(l), stake: pda.stake(l, stakeOwner), systemProgram: SystemProgram.programId })
      .preInstructions([uniq()])
      .signers([owner])
      .rpc();
  };

  const claimLoss = async (owner: Keypair, mint: PublicKey) => {
    const l = pda.launch(mint);
    return program.methods
      .claimLoss()
      .accountsStrict({
        owner: owner.publicKey,
        config: pda.config(),
        launch: l,
        stake: pda.stake(l, owner.publicKey),
        rematch: pda.rematch(owner.publicKey),
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([uniq()])
      .signers([owner])
      .rpc();
  };

  const sweepDust = async (mint: PublicKey, signer: Keypair = admin) => {
    const l = pda.launch(mint);
    const launchAcc: any = await program.account.launch.fetch(l);
    return program.methods
      .sweepDust()
      .accountsStrict({ admin: signer.publicKey, config: pda.config(), launch: l, vault: pda.vault(l), creator: launchAcc.creator, systemProgram: SystemProgram.programId })
      .preInstructions([uniq()])
      .signers(signer === admin ? [] : [signer])
      .rpc();
  };

  const fetchLaunch = (mint: PublicKey): Promise<any> => program.account.launch.fetch(pda.launch(mint));
  const fetchStake = (mint: PublicKey, owner: PublicKey): Promise<any> => program.account.stake.fetch(pda.stake(pda.launch(mint), owner));
  const fetchRematch = (owner: PublicKey): Promise<any> => program.account.rematch.fetch(pda.rematch(owner));

  return {
    context, provider, program, admin, keeper, client, fund, send, now, warpTo, lamports, addFriend, newFriend,
    registerIx, launch, stake, stakeRematch, resolve, setCurve, claim, claimLoss, sweepDust, fetchLaunch, fetchStake, fetchRematch,
  };
}

/** Assert the promise rejects with the named Anchor error (or any of the given substrings). */
export async function expectErr(p: Promise<unknown>, ...needles: string[]) {
  try {
    await p;
  } catch (e: any) {
    const text = [String(e?.message ?? e), ...(e?.logs ?? e?.transactionLogs ?? [])].join('\n');
    const errs: { code: number; name: string }[] = idl.errors;
    const ok = needles.some((n) => {
      if (text.includes(n)) return true;
      const code = errs.find((x) => x.name === n)?.code;
      return code !== undefined && (text.includes(`0x${code.toString(16)}`) || text.includes(`custom program error: ${code}`));
    });
    if (!ok) throw new Error(`expected one of [${needles.join(', ')}], got:\n${text}`);
    return;
  }
  throw new Error(`expected failure with ${needles.join(' | ')}, but it succeeded`);
}
