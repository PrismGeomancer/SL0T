# SL0T — every launch is a pull

A friends-only Solana launchpad. A friend on the guest list launches a coin on **pump.fun**, and the launch fee goes on **HIT** for their own coin. If the bonding curve graduates inside the window (24 h by default), the launch **hits**; otherwise it **misses**. Every launch has a two-sided pool, HIT and MISS. The winning side splits the losing side pro rata, with a 0% house cut. A loss unlocks one **rematch**: lock exactly 2x what you lost on any other open launch.

```
programs/sl0t/        Anchor program (Rust, Anchor 0.31.1)
programs/mock-pump/   TEST ONLY: a pump.fun stand-in (same layouts + create_v2 discriminator). Never deploy.
tests/                Program tests (vitest + anchor-bankrun) + a real mainnet curve snapshot
keeper/               Node/TS resolver (pnpm keeper)
app/                  Vite + React + TS site (GitHub Pages, hash routing)
scripts/              admin CLI, IDL generator / sync
.github/workflows/    program.yml (CI tests), keeper.yml (cron), pages.yml (deploy)
```

## How it works on chain

| Account | Seeds | What |
|---|---|---|
| `Config` | `config` | admin, keeper, pump program, fee, max stake, window, stake close, rematch window, paused |
| `Friend` | `friend, wallet` | exists = on the guest list |
| `Launch` | `launch, mint` | one pool per coin. Window and stake-close times are copied in at open |
| `Vault` | `vault, launch` | system account holding the pool. Only the program signs for it |
| `Stake` | `stake, launch, owner` | one per wallet per launch. You can add to your side; you can't switch sides |
| `Rematch` | `rematch, owner` | 2x unlock after a loss. Single use, expires |

Instructions: `init_config`, `update_config`, `add_friend`, `remove_friend`, `register_launch`, `stake`, `stake_rematch`, `resolve`, `claim`, `claim_loss`, `sweep_dust`.

- **`register_launch`** must run in the same transaction as pump.fun's `create_v2` for that mint (checked through the instructions sysvar). It also checks that the curve is the right PDA, is owned by pump.fun, isn't complete, and that its creator is the signer.
- **`resolve` is permissionless and reads the curve itself.** `BondingCurve.complete` (byte 48) means HIT, at any time. Not complete at or after the deadline means MISS. One side empty means VOID. Evidence (slot, curve %, complete) is written to the `Launch` and emitted as an event. The keeper is only a trigger: it can't pick an outcome.
- **`claim`** covers winners and VOID refunds: `amount + floor(amount × losing / winning)` in u128. **`claim_loss`** settles a losing stake and opens or overwrites the owner's `Rematch` (`amount_lost` is capped at `max_stake / 2`, so chained rematches stop growing at the max stake). Both close the `Stake` and return its rent.
- **`sweep_dust`** (admin) runs only after every stake is settled. It sends the vault's leftover rounding dust, plus the vault rent deposit the creator paid at launch, **to the launch creator**.
- No instruction lets the admin or the keeper move pool funds anywhere else.

## Setup

Requirements: Node 20, pnpm 10, Rust stable, Solana CLI 2.x (Agave), Anchor CLI 0.31.1.

```sh
pnpm install
anchor build                 # builds sl0t + mock-pump, writes target/idl/sl0t.json
pnpm idl:sync                # copies the compiler IDL to app/, keeper/, tests/
cargo test -p sl0t --lib     # unit tests incl. the real mainnet curve snapshot
anchor test --skip-local-validator   # bankrun program tests (no validator needed)
pnpm -C app test && pnpm -C app build
pnpm -C keeper typecheck && pnpm -C keeper test
```

Until the Anchor toolchain has run once, `app/src/idl/sl0t.json` comes from `scripts/gen-idl.mjs` (same discriminators and layout). CI compares the two and warns if they drift.

The program ID is `5kgnp4QxSM3VEJgrqKeDL4W86Gh2iZNkGAwBXNuMP9Hq`. Its keypair is in `target/deploy/sl0t-keypair.json`, which is git-ignored. Back it up and never commit it. To use your own ID: `anchor keys sync`, then `pnpm idl:gen`.

## Deploy (devnet first)

pump.fun's program (`6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`) and its Global account are live on devnet, so the whole loop runs on devnet.

```sh
solana config set --url devnet
solana airdrop 2                              # or a faucet
anchor deploy -p sl0t --provider.cluster devnet   # -p sl0t: never deploy mock-pump
# init right after deploying: the first caller of init_config becomes admin
RPC_URL=https://api.devnet.solana.com pnpm admin init --keeper <KEEPER_PUBKEY> --fee 0.1 --max 1
pnpm admin add <friend wallet> <friend wallet> ...
pnpm admin show
```

For mainnet, start small: `--fee 0.01 --max 0.05`.

Other admin commands: `pnpm admin remove <wallet>`, `pnpm admin update --pause|--unpause|--fee x|...`, `pnpm admin friends`, `pnpm admin sweep <mint>`.

## Keeper

```sh
RPC_URL=... KEEPER_SECRET_KEY='[1,2,...]' PROGRAM_ID=5kgn... CLUSTER=devnet pnpm keeper
DRY_RUN=1 ...  # log decisions, send nothing
```

Each run lists Open launches, reads each curve with the pump SDK, and calls `resolve` on those that graduated or reached their deadline. It logs one JSON line per launch. It's idempotent: a launch someone else already resolved is logged as `skip`. It exits non-zero only on real failures. The keeper wallet only needs a little SOL for fees.

GitHub Actions (`keeper.yml`, every 15 min plus a manual run button) needs:
- **Secrets:** `RPC_URL`, `KEEPER_SECRET_KEY`
- **Variables:** `PROGRAM_ID`, `CLUSTER`

## Website (GitHub Pages)

`app/src/config.ts` is the single source of truth. Empty values fall back to build variables:

| config | build var (Pages) | notes |
|---|---|---|
| `cluster` | var `CLUSTER` | `devnet` / `mainnet-beta` |
| `rpcUrl` | secret `VITE_RPC_URL` | your Helius URL |
| `programId` | var `PROGRAM_ID` | **empty = demo mode** (6 sample launches, all labelled DEMO, no writes) |
| `keeperAddress` | var `KEEPER_ADDRESS` | shown in "Who calls it?" |
| `links.github` | automatic | repo URL; empty links hide their buttons |

Enable Pages with source "GitHub Actions". Every push to `main` builds `app/` with `VITE_BASE=/<repo>/` and deploys it; `404.html` is a copy of `index.html`. For local dev, copy `app/.env.example` to `app/.env.local` and run `pnpm -C app dev`.

**The RPC key is public.** Anything in a frontend build ships to every visitor. In the Helius dashboard, restrict the key to your Pages domain (allowed origins), and use a different, unrestricted key for the keeper secret.

Token images and metadata are uploaded to **Irys**, paid from the creator's wallet. Uploads under 100 KiB are free on mainnet; on devnet the fee is devnet SOL and the files aren't permanent. pump.fun's own upload endpoint rejects cross-origin requests from Pages (403).

## Limitations, in plain words

- **Not audited.** Small amounts only, among friends, until it is.
- **Who resolves.** The outcome comes from the pump.fun curve on chain, not from the keeper, and anyone can call `resolve`. If the keeper is down, launches simply wait, and funds stay safe in their vaults. One edge: if a curve completes *after* the deadline but before anyone resolves it, it counts as HIT. The keeper runs every 15 minutes to keep that gap small.
- **GitHub cron is best effort.** Scheduled runs can be several minutes late, and GitHub disables schedules on repos with no activity for 60 days. Push something, or re-enable the workflow.
- **pump.fun can change.** The program reads `real_token_reserves` (offset 24), `complete` (offset 48) and `creator` (offset 49), plus `initial_real_token_reserves` (offset 89) from pump.fun's Global account, as of pump SDK 4.3.1. A pump.fun layout change would break `register_launch` and `resolve`; it would not put funds at risk. The pump program ID is stored in `Config`, and in each `Launch` at open.
- **First buy is a second transaction.** create_v2 + buy + register_launch is larger than the 1232-byte transaction limit. Create + register is atomic in transaction 1; the optional first buy follows in transaction 2. Both are signed in one wallet prompt. If transaction 2 fails, the coin is still launched and registered.
- **Config init race.** `init_config` makes its first caller the admin, so run it right after deploying.
- **Rematch slot.** You have one rematch slot. Settling a new loss overwrites an unused rematch, so the site's "Claim all" holds losses back while a rematch is live.
- **The log** is built from the last few hundred program transactions read through your RPC.
