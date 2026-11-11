import { AnchorProvider, BorshCoder, EventParser, Program, type Idl } from '@coral-xyz/anchor';
import { ExtensionType, getExtensionData, TOKEN_2022_PROGRAM_ID, unpackMint } from '@solana/spl-token';
import { unpack as unpackTokenMetadata } from '@solana/spl-token-metadata';
import { clusterApiUrl, Connection, Keypair, PublicKey, type AccountInfo } from '@solana/web3.js';
import bs58 from 'bs58';
import { CONFIG } from '../config';
import idlJson from '../idl/sl0t.json';
import { decodeCurve, decodeGlobalInitialRealTokens, DEFAULT_INITIAL_REAL_TOKENS, progressBps } from './curve';
import type { ChainConfig, LaunchRow, LaunchState, LogRow, RematchRow, Side, StakeRow, TokenMeta } from './types';

export const IDL = { ...(idlJson as Idl), address: CONFIG.programId || (idlJson as Idl).address } as Idl;
export const PROGRAM_ID = new PublicKey(IDL.address);
export const LAUNCH_STATE_OFFSET = 8 + 32 * 4 + 8 * 4;

let _conn: Connection | null = null;
export function connection(): Connection {
  if (!_conn) _conn = new Connection(CONFIG.rpcUrl || clusterApiUrl(CONFIG.cluster), { commitment: 'confirmed' });
  return _conn;
}

/** Read-only program (a throwaway wallet; it never signs). */
let _ro: Program | null = null;
export function readProgram(): Program {
  if (!_ro) {
    const kp = Keypair.generate();
    const wallet = {
      publicKey: kp.publicKey,
      signTransaction: async <T,>(t: T) => t,
      signAllTransactions: async <T,>(t: T[]) => t,
    };
    _ro = new Program(IDL, new AnchorProvider(connection(), wallet as never, { commitment: 'confirmed' }));
  }
  return _ro;
}

const seed = (s: string, ...keys: PublicKey[]) =>
  PublicKey.findProgramAddressSync([Buffer.from(s), ...keys.map((k) => k.toBuffer())], PROGRAM_ID)[0];
export const pda = {
  config: () => seed('config'),
  friend: (w: PublicKey) => seed('friend', w),
  launch: (mint: PublicKey) => seed('launch', mint),
  vault: (launch: PublicKey) => seed('vault', launch),
  stake: (launch: PublicKey, owner: PublicKey) => seed('stake', launch, owner),
  rematch: (owner: PublicKey) => seed('rematch', owner),
};

const enumKey = (e: Record<string, unknown>) => Object.keys(e)[0].toLowerCase();
const num = (x: { toString(): string } | number) => Number(x.toString());
const b58 = (k: PublicKey) => k.toBase58();

// ---------------------------------------------------------------- config

export async function fetchConfig(): Promise<ChainConfig> {
  const c: any = await (readProgram().account as any).config.fetch(pda.config());
  return {
    admin: b58(c.admin),
    keeper: b58(c.keeper),
    pumpProgram: b58(c.pumpProgram),
    launchFee: num(c.launchFeeLamports),
    maxStake: num(c.maxStakeLamports),
    windowSecs: num(c.windowSecs),
    stakeCloseSecs: num(c.stakeCloseSecs),
    rematchSecs: num(c.rematchSecs),
    paused: c.paused,
  };
}

export async function isFriend(wallet: PublicKey): Promise<boolean> {
  const info = await connection().getAccountInfo(pda.friend(wallet));
  return !!info && info.owner.equals(PROGRAM_ID) && info.data.length > 0;
}

// ---------------------------------------------------------------- pump.fun

const globalCache = new Map<string, bigint>();
async function initialRealTokens(pumpProgram: PublicKey): Promise<bigint> {
  const key = pumpProgram.toBase58();
  if (!globalCache.has(key)) {
    const g = PublicKey.findProgramAddressSync([Buffer.from('global')], pumpProgram)[0];
    const info = await connection().getAccountInfo(g);
    globalCache.set(key, info ? decodeGlobalInitialRealTokens(info.data) : DEFAULT_INITIAL_REAL_TOKENS);
  }
  return globalCache.get(key)!;
}

// ---------------------------------------------------------------- token metadata

const metaCache = new Map<string, TokenMeta>();
const META_LS = 'sl0t:meta:v1';
try {
  const raw = localStorage.getItem(META_LS);
  if (raw) for (const [k, v] of Object.entries(JSON.parse(raw) as Record<string, TokenMeta>)) metaCache.set(k, v);
} catch {
  /* storage unavailable */
}
const persistMeta = () => {
  try {
    localStorage.setItem(META_LS, JSON.stringify(Object.fromEntries([...metaCache].slice(-300))));
  } catch {
    /* ignore */
  }
};

function decodeMintMeta(mint: PublicKey, info: AccountInfo<Buffer> | null): { name: string; symbol: string; uri: string } | null {
  if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
  try {
    const m = unpackMint(mint, info, TOKEN_2022_PROGRAM_ID);
    const ext = getExtensionData(ExtensionType.TokenMetadata, m.tlvData);
    if (!ext) return null;
    const t = unpackTokenMetadata(ext);
    return { name: t.name, symbol: t.symbol, uri: t.uri };
  } catch {
    return null;
  }
}

async function fetchJsonImage(uri: string): Promise<{ image?: string; description?: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(uri, { signal: ctl.signal });
    clearTimeout(t);
    const j = await r.json();
    return { image: typeof j.image === 'string' ? j.image : undefined, description: typeof j.description === 'string' ? j.description : undefined };
  } catch {
    return {};
  }
}

export async function loadMeta(mints: PublicKey[]): Promise<Map<string, TokenMeta>> {
  const missing = mints.filter((m) => !metaCache.has(m.toBase58()));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const infos = await connection().getMultipleAccountsInfo(batch);
    await Promise.all(
      batch.map(async (mint, j) => {
        const base = decodeMintMeta(mint, infos[j]);
        if (!base) return;
        const extra = base.uri ? await fetchJsonImage(base.uri) : {};
        metaCache.set(mint.toBase58(), { name: base.name, symbol: base.symbol, ...extra });
      }),
    );
  }
  if (missing.length) persistMeta();
  return new Map(mints.map((m) => [m.toBase58(), metaCache.get(m.toBase58())!]).filter(([, v]) => v) as [string, TokenMeta][]);
}

// ---------------------------------------------------------------- launches

function toLaunchRow(address: PublicKey, a: any): LaunchRow {
  return {
    address: b58(address),
    mint: b58(a.mint),
    creator: b58(a.creator),
    bondingCurve: b58(a.bondingCurve),
    pumpProgram: b58(a.pumpProgram),
    openedAt: num(a.openedAt),
    deadline: num(a.deadline),
    stakeCloseAt: num(a.stakeCloseAt),
    resolvedAt: num(a.resolvedAt),
    state: enumKey(a.state) as LaunchState,
    hitTotal: num(a.hitTotal),
    missTotal: num(a.missTotal),
    stakeCount: a.stakeCount,
    settledCount: a.settledCount,
    evidenceSlot: num(a.evidenceSlot),
    evidencePctBps: a.evidencePctBps,
    evidenceComplete: a.evidenceComplete,
    curvePctBps: a.evidencePctBps,
    curveComplete: a.evidenceComplete,
  };
}

/** Attach live curve progress + token metadata. */
async function enrich(rows: LaunchRow[]): Promise<LaunchRow[]> {
  if (!rows.length) return rows;
  const curves: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < rows.length; i += 100)
    curves.push(...(await connection().getMultipleAccountsInfo(rows.slice(i, i + 100).map((r) => new PublicKey(r.bondingCurve)))));
  const meta = await loadMeta(rows.map((r) => new PublicKey(r.mint)));
  return Promise.all(
    rows.map(async (r, i) => {
      const c = curves[i] ? decodeCurve(curves[i]!.data) : null;
      const init = await initialRealTokens(new PublicKey(r.pumpProgram));
      return {
        ...r,
        curvePctBps: c ? progressBps(c, init) : r.curvePctBps,
        curveComplete: c ? c.complete : r.curveComplete,
        meta: meta.get(r.mint),
      };
    }),
  );
}

export async function fetchLaunches(): Promise<LaunchRow[]> {
  const all = await (readProgram().account as any).launch.all();
  const rows = all.map((x: any) => toLaunchRow(x.publicKey, x.account));
  rows.sort((a: LaunchRow, b: LaunchRow) => b.openedAt - a.openedAt);
  return enrich(rows);
}

export async function fetchLaunch(mint: PublicKey): Promise<LaunchRow | null> {
  const address = pda.launch(mint);
  const a = await (readProgram().account as any).launch.fetchNullable(address);
  if (!a) return null;
  return (await enrich([toLaunchRow(address, a)]))[0];
}

export function decodeLaunchAccount(address: PublicKey, data: Buffer): LaunchRow {
  return toLaunchRow(address, readProgram().coder.accounts.decode('launch', data));
}

// ---------------------------------------------------------------- stakes / rematch

function toStakeRow(address: PublicKey, a: any): StakeRow {
  return { address: b58(address), owner: b58(a.owner), launch: b58(a.launch), side: enumKey(a.side) as Side, amount: num(a.amount), isRematch: a.isRematch };
}

export async function fetchStakesByOwner(owner: PublicKey): Promise<StakeRow[]> {
  const all = await (readProgram().account as any).stake.all([{ memcmp: { offset: 8, bytes: owner.toBase58() } }]);
  return all.map((x: any) => toStakeRow(x.publicKey, x.account));
}

export async function fetchStake(launch: PublicKey, owner: PublicKey): Promise<StakeRow | null> {
  const address = pda.stake(launch, owner);
  const a = await (readProgram().account as any).stake.fetchNullable(address);
  return a ? toStakeRow(address, a) : null;
}

export async function fetchRematch(owner: PublicKey): Promise<RematchRow | null> {
  const a: any = await (readProgram().account as any).rematch.fetchNullable(pda.rematch(owner));
  if (!a) return null;
  return { owner: b58(a.owner), amountLost: num(a.amountLost), sourceLaunch: b58(a.sourceLaunch), expiresAt: num(a.expiresAt), used: a.used };
}

// ---------------------------------------------------------------- the log (from program events)

let parser: EventParser | null = null;
const eventParser = () => (parser ??= new EventParser(PROGRAM_ID, new BorshCoder(IDL)));

export function eventsToRows(sig: string, time: number, logs: string[]): LogRow[] {
  const out: LogRow[] = [];
  let i = 0;
  for (const ev of eventParser().parseLogs(logs)) {
    const d: any = ev.data;
    const id = `${sig}:${i++}`;
    const base = { id, time, sig, launch: d.launch ? b58(d.launch) : '', mint: d.mint ? b58(d.mint) : '' };
    switch (ev.name) {
      case 'LaunchRegistered':
        out.push({ ...base, event: 'LAUNCH', wallet: b58(d.creator), amount: null });
        break;
      case 'Staked': {
        const side = enumKey(d.side);
        out.push({ ...base, event: d.isRematch ? 'REMATCH' : side === 'hit' ? 'STAKE HIT' : 'STAKE MISS', wallet: b58(d.owner), amount: num(d.amount) });
        break;
      }
      case 'Resolved': {
        const s = enumKey(d.state);
        out.push({
          ...base,
          event: s === 'hit' ? 'RESOLVED HIT' : s === 'miss' ? 'RESOLVED MISS' : 'VOID',
          wallet: b58(d.resolver),
          amount: num(d.hitTotal) + num(d.missTotal),
          evidence: { pctBps: d.evidencePctBps, complete: d.curveComplete, slot: num(d.evidenceSlot) },
        });
        break;
      }
      case 'Claimed':
        out.push({ ...base, event: 'CLAIM', wallet: b58(d.owner), amount: num(d.payout), payout: num(d.payout) - num(d.amount) });
        break;
      case 'LossSettled':
        out.push({ ...base, event: 'CLAIM', wallet: b58(d.owner), amount: 0, payout: -num(d.amount), loss: true });
        break;
    }
  }
  return out;
}

/** Last `limit` program transactions, newest first. Pass `address` to scope (e.g. one launch). */
export async function fetchLog(limit = 150, address?: PublicKey): Promise<LogRow[]> {
  const sigs = await connection().getSignaturesForAddress(address ?? PROGRAM_ID, { limit });
  const ok = sigs.filter((s) => !s.err);
  const rows: LogRow[] = [];
  for (let i = 0; i < ok.length; i += 25) {
    const batch = ok.slice(i, i + 25);
    const txs = await connection().getTransactions(
      batch.map((s) => s.signature),
      { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    );
    txs.forEach((tx, j) => {
      if (!tx?.meta?.logMessages) return;
      rows.push(...eventsToRows(batch[j].signature, tx.blockTime ?? batch[j].blockTime ?? 0, tx.meta.logMessages));
    });
  }
  return rows.sort((a, b) => b.time - a.time);
}

export const encodeState = (n: number) => bs58.encode(Uint8Array.from([n]));
