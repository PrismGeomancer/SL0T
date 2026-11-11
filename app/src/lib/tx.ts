import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import {
  ComputeBudgetProgram,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
  type Signer,
} from '@solana/web3.js';
import { connection, IDL, pda } from './chain';
import type { LaunchRow, Side, StakeRow } from './types';

export function writeProgram(wallet: AnchorWallet): Program {
  return new Program(IDL, new AnchorProvider(connection(), wallet, { commitment: 'confirmed' }));
}

const sideArg = (s: Side) => (s === 'hit' ? { hit: {} } : { miss: {} });
const priority = () => [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 })];

/** Sign one or more transactions in a single wallet prompt, then send in order, confirming each. */
export async function signAndSend(
  wallet: AnchorWallet,
  txs: { ixs: TransactionInstruction[]; signers?: Signer[] }[],
  onSent?: (sig: string, i: number) => void,
): Promise<string[]> {
  const conn = connection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const built = txs.map(({ ixs, signers }) => {
    const tx = new Transaction({ feePayer: wallet.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    if (signers?.length) tx.partialSign(...signers);
    return tx;
  });
  const signed = built.length === 1 ? [await wallet.signTransaction(built[0])] : await wallet.signAllTransactions(built);
  const sigs: string[] = [];
  for (let i = 0; i < signed.length; i++) {
    const sig = await conn.sendRawTransaction(signed[i].serialize(), { maxRetries: 5 });
    onSent?.(sig, i);
    const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    if (res.value.err) {
      const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }).catch(() => null);
      const err: Error & { logs?: string[] } = new Error(`Transaction ${i + 1} failed: ${JSON.stringify(res.value.err)}`);
      err.logs = tx?.meta?.logMessages ?? [];
      throw err;
    }
    sigs.push(sig);
  }
  return sigs;
}

// ---------------------------------------------------------------- stake

export async function stakeIx(wallet: AnchorWallet, launch: LaunchRow, side: Side, lamports: number) {
  const l = new PublicKey(launch.address);
  return writeProgram(wallet)
    .methods.stake(sideArg(side), new BN(lamports))
    .accountsStrict({
      owner: wallet.publicKey,
      config: pda.config(),
      friend: pda.friend(wallet.publicKey),
      launch: l,
      vault: pda.vault(l),
      stake: pda.stake(l, wallet.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function rematchIx(wallet: AnchorWallet, launch: LaunchRow, side: Side, lamports: number) {
  const l = new PublicKey(launch.address);
  return writeProgram(wallet)
    .methods.stakeRematch(sideArg(side), new BN(lamports))
    .accountsStrict({
      owner: wallet.publicKey,
      config: pda.config(),
      friend: pda.friend(wallet.publicKey),
      launch: l,
      vault: pda.vault(l),
      stake: pda.stake(l, wallet.publicKey),
      rematch: pda.rematch(wallet.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function sendStake(wallet: AnchorWallet, launch: LaunchRow, side: Side, lamports: number, rematch: boolean) {
  const ix = rematch ? await rematchIx(wallet, launch, side, lamports) : await stakeIx(wallet, launch, side, lamports);
  return (await signAndSend(wallet, [{ ixs: [...priority(), ix] }]))[0];
}

// ---------------------------------------------------------------- claims

export async function claimIx(wallet: AnchorWallet, launch: LaunchRow, won: boolean) {
  const l = new PublicKey(launch.address);
  const program = writeProgram(wallet);
  if (won) {
    return program.methods
      .claim()
      .accountsStrict({ owner: wallet.publicKey, launch: l, vault: pda.vault(l), stake: pda.stake(l, wallet.publicKey), systemProgram: SystemProgram.programId })
      .instruction();
  }
  return program.methods
    .claimLoss()
    .accountsStrict({
      owner: wallet.publicKey,
      config: pda.config(),
      launch: l,
      stake: pda.stake(l, wallet.publicKey),
      rematch: pda.rematch(wallet.publicKey),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/** Pack claims into as few transactions as fit (measured, not guessed). */
export async function buildClaimBatches(wallet: AnchorWallet, items: { launch: LaunchRow; stake: StakeRow; won: boolean }[]) {
  // A loss writes the single Rematch PDA; only the last loss processed wins it.
  // Send losses after wins so the newest rematch is the one that sticks.
  const ordered = [...items].sort((a, b) => Number(b.won) - Number(a.won) || a.launch.resolvedAt - b.launch.resolvedAt);
  const ixs = await Promise.all(ordered.map((it) => claimIx(wallet, it.launch, it.won)));
  const batches: TransactionInstruction[][] = [];
  let cur: TransactionInstruction[] = [];
  const fits = (list: TransactionInstruction[]) => {
    const tx = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: PublicKey.default.toBase58() }).add(...priority(), ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...list);
    try {
      return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length <= 1232;
    } catch {
      return false;
    }
  };
  for (const ix of ixs) {
    if (cur.length && (!fits([...cur, ix]) || cur.length >= 8)) {
      batches.push(cur);
      cur = [];
    }
    cur.push(ix);
  }
  if (cur.length) batches.push(cur);
  return batches.map((b) => ({ ixs: [...priority(), ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, 60_000 * b.length + 20_000) }), ...b] }));
}

// ---------------------------------------------------------------- launch

export interface LaunchInput {
  name: string;
  symbol: string;
  uri: string;
  firstBuyLamports: number;
}

/**
 * tx 1 (atomic): pump.fun create_v2 + sl0t register_launch, signed by wallet + mint keypair.
 * tx 2 (optional): the first buy. create+buy+register doesn't fit in one 1232-byte transaction,
 * so the buy rides in a second transaction signed in the same wallet prompt.
 */
export async function buildLaunchTxs(wallet: AnchorWallet, input: LaunchInput) {
  const { Keypair } = await import('@solana/web3.js');
  const sdk = await import('@pump-fun/pump-sdk');
  const mint = Keypair.generate();
  const user = wallet.publicKey;

  const createIx = await sdk.PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    creator: user,
    user,
    mayhemMode: false,
  });

  const l = pda.launch(mint.publicKey);
  const registerIx = await writeProgram(wallet)
    .methods.registerLaunch()
    .accountsStrict({
      creator: user,
      config: pda.config(),
      friend: pda.friend(user),
      mint: mint.publicKey,
      bondingCurve: sdk.bondingCurvePda(mint.publicKey),
      launch: l,
      vault: pda.vault(l),
      creatorStake: pda.stake(l, user),
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const txs: { ixs: TransactionInstruction[]; signers?: Signer[] }[] = [
    { ixs: [ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...priority(), createIx, registerIx], signers: [mint] },
  ];

  if (input.firstBuyLamports > 0) {
    const online = new sdk.OnlinePumpSdk(connection());
    const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig().catch(() => null)]);
    const solAmount = new BN(input.firstBuyLamports);
    const { NATIVE_MINT } = await import('@solana/spl-token');
    const amount = sdk.getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_MINT });
    // Use the SDK's create-and-buy builder and keep only the ATA + buy legs.
    const all = await sdk.PUMP_SDK.createV2AndBuyInstructions({
      global,
      mint: mint.publicKey,
      name: input.name,
      symbol: input.symbol,
      uri: input.uri,
      creator: user,
      user,
      amount: amount.muln(98).divn(100), // 2% slippage room in case someone buys first
      solAmount,
      mayhemMode: false,
    });
    const buyLegs = all.filter((ix) => !(ix.programId.equals(sdk.PUMP_PROGRAM_ID) && ix.data.subarray(0, 8).equals(createIx.data.subarray(0, 8))));
    txs.push({ ixs: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ...priority(), ...buyLegs] });
  }

  return { mint: mint.publicKey, txs };
}

/** Rough rent the launch transaction creates (shown as "~" in the summary). */
export async function estimateLaunchRent(firstBuy: boolean): Promise<number> {
  const c = connection();
  const sizes = [8 + 205, 8 + 84, 0, 166, 400, 170, ...(firstBuy ? [170] : [])]; // launch, stake, vault, curve, mint+metadata, curve ATA, user ATA
  const rents = await Promise.all(sizes.map((s) => c.getMinimumBalanceForRentExemption(s)));
  return rents.reduce((a, b) => a + b, 0) + 15_000; // + signatures/priority
}
