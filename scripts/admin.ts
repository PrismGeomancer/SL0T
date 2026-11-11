/**
 * SL0T admin CLI.
 *
 *   pnpm admin init [--keeper <pubkey>] [--fee 0.1] [--max 1] [--window-h 24] [--close-h 2] [--rematch-h 24]
 *   pnpm admin add <wallet> [<wallet> ...]
 *   pnpm admin remove <wallet>
 *   pnpm admin update [--keeper <pubkey>] [--fee x] [--max x] [--window-h x] [--close-h x] [--rematch-h x] [--pause|--unpause]
 *   pnpm admin show
 *   pnpm admin friends
 *   pnpm admin sweep <mint>
 *
 * Env: RPC_URL (default devnet), ADMIN_KEYPAIR (path, default ~/.config/solana/id.json), PROGRAM_ID (default: IDL address)
 */
import anchor, { type Idl } from '@coral-xyz/anchor';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const { AnchorProvider, BN, Program, Wallet } = anchor;
const idl = JSON.parse(readFileSync(new URL('../app/src/idl/sl0t.json', import.meta.url), 'utf8')) as Idl & { address: string };
const PUMP = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

const rpc = process.env.RPC_URL || 'https://api.devnet.solana.com';
const kpPath = (process.env.ADMIN_KEYPAIR || '~/.config/solana/id.json').replace('~', homedir());
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(kpPath, 'utf8'))));
const programId = new PublicKey(process.env.PROGRAM_ID || idl.address);
const provider = new AnchorProvider(new Connection(rpc, 'confirmed'), new Wallet(admin), { commitment: 'confirmed' });
const program = new Program({ ...idl, address: programId.toBase58() }, provider) as Program<any>;

const seed = (s: string, ...k: PublicKey[]) => PublicKey.findProgramAddressSync([Buffer.from(s), ...k.map((x) => x.toBuffer())], programId)[0];
const config = seed('config');

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) {
    const k = rest[i].slice(2);
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
    flags.set(k, v);
  } else positional.push(rest[i]);
}
const lamports = (k: string) => (flags.has(k) ? new BN(Math.round(Number(flags.get(k)) * LAMPORTS_PER_SOL)) : null);
const hours = (k: string) => (flags.has(k) ? new BN(Math.round(Number(flags.get(k)) * 3600)) : null);
const key = (k: string) => (flags.has(k) ? new PublicKey(flags.get(k)!) : null);

async function main() {
  switch (cmd) {
    case 'init': {
      const sig = await program.methods
        .initConfig({
          keeper: key('keeper') ?? admin.publicKey,
          pumpProgram: key('pump') ?? PUMP,
          launchFeeLamports: lamports('fee') ?? new BN(0.1 * LAMPORTS_PER_SOL),
          maxStakeLamports: lamports('max') ?? new BN(1 * LAMPORTS_PER_SOL),
          windowSecs: hours('window-h') ?? new BN(86_400),
          stakeCloseSecs: hours('close-h') ?? new BN(7_200),
          rematchSecs: hours('rematch-h') ?? new BN(86_400),
        })
        .accountsStrict({ admin: admin.publicKey, config, systemProgram: SystemProgram.programId })
        .rpc();
      console.log('config initialised', config.toBase58(), sig);
      break;
    }
    case 'update': {
      const sig = await program.methods
        .updateConfig({
          admin: key('admin'),
          keeper: key('keeper'),
          pumpProgram: key('pump'),
          launchFeeLamports: lamports('fee'),
          maxStakeLamports: lamports('max'),
          windowSecs: hours('window-h'),
          stakeCloseSecs: hours('close-h'),
          rematchSecs: hours('rematch-h'),
          paused: flags.has('pause') ? true : flags.has('unpause') ? false : null,
        })
        .accountsStrict({ admin: admin.publicKey, config })
        .rpc();
      console.log('config updated', sig);
      break;
    }
    case 'add':
      for (const w of positional) {
        const wallet = new PublicKey(w);
        const sig = await program.methods
          .addFriend(wallet)
          .accountsStrict({ admin: admin.publicKey, config, friend: seed('friend', wallet), systemProgram: SystemProgram.programId })
          .rpc();
        console.log('added', w, sig);
      }
      break;
    case 'remove': {
      const wallet = new PublicKey(positional[0]);
      const sig = await program.methods
        .removeFriend(wallet)
        .accountsStrict({ admin: admin.publicKey, config, friend: seed('friend', wallet) })
        .rpc();
      console.log('removed', positional[0], sig);
      break;
    }
    case 'show':
      console.log(JSON.stringify(await program.account.config.fetch(config), (_, v) => (v && typeof v === "object" && v.constructor?.name === "PublicKey" ? v.toBase58() : v && v.constructor?.name === "BN" ? v.toString() : v), 2));
      break;
    case 'friends':
      for (const f of await program.account.friend.all()) console.log((f.account as any).wallet.toBase58());
      break;
    case 'sweep': {
      const mint = new PublicKey(positional[0]);
      const launch = seed('launch', mint);
      const l: any = await program.account.launch.fetch(launch);
      const sig = await program.methods
        .sweepDust()
        .accountsStrict({ admin: admin.publicKey, config, launch, vault: seed('vault', launch), creator: l.creator, systemProgram: SystemProgram.programId })
        .rpc();
      console.log('swept', sig);
      break;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0]);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error(e?.logs ?? e);
  process.exit(1);
});
