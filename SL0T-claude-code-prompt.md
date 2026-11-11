# Claude Code prompt — build SL0T

You are building **SL0T**, a friends-only Solana launchpad MVP with a "double or nothing" rematch mechanic, a scheduled keeper, and a premium, animation-heavy website hosted on GitHub Pages. Read this whole file before writing code. The copy lives in `SL0T-copy-deck.md` in this folder: use it word for word.

Work in this order and commit after each phase: **1 program → 2 keeper → 3 frontend shell + design system → 4 intro + landing → 5 app pages → 6 tests + polish → 7 README**. If something in this spec is impossible or wrong when you check the real SDK or docs, stop, say so, and propose the closest working alternative instead of faking it.

---

## 0. The product in one paragraph

A friend (on the allowlist) launches a coin on **pump.fun** (through our site, using pump.fun's own program) and pays a launch fee, which is automatically staked on **HIT** for their own coin. A launch **hits** if its pump.fun bonding curve completes (graduates) within the window (default 24 h); otherwise it **misses**. Every launch has a pool with two sides, HIT and MISS. When it resolves, the winning side splits the losing side pro rata. 0% house cut. A miss gives the launcher one **rematch**: they can lock exactly 2x their lost amount on either side of any other open launch. All SOL sits in a program-owned vault per launch. A keeper running on GitHub Actions resolves launches. Nothing is ever pulled from a wallet later: you only lose what you lock.

---

## 1. Repo layout

```
sl0t/
  programs/sl0t/            Anchor program (Rust)
  tests/                    Anchor tests (TS, bankrun or local validator)
  keeper/                   Node + TS resolver script
  app/                      Vite + React + TypeScript frontend
  .github/workflows/
    pages.yml               build app/ and deploy to GitHub Pages
    keeper.yml              cron keeper
  README.md
```

Use pnpm. Node 20. Anchor 0.31.x. Pump SDK: `@pump-fun/pump-sdk` (official) and `@pump-fun/pump-swap-sdk` only if needed.

---

## 2. Anchor program `sl0t`

### Accounts
- `Config` (PDA `["config"]`): `admin`, `keeper`, `pump_program` (pump.fun program id `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`, stored so it can be changed if pump.fun migrates), `launch_fee_lamports` (default 0.1 SOL), `max_stake_lamports` (default 1 SOL), `window_secs` (default 86_400), `stake_close_secs` (default 7_200), `rematch_secs` (default 86_400), `paused: bool`, `bump`.
- `Friend` (PDA `["friend", wallet]`): `wallet`, `added_at`, `bump`. Existence = on the allowlist.
- `Launch` (PDA `["launch", mint]`): `creator`, `mint`, `bonding_curve` (pump.fun PDA `["bonding-curve", mint]`), `opened_at`, `deadline`, `stake_close_at`, `state` (Open | Hit | Miss | Void), `hit_total`, `miss_total`, `resolved_at`, `evidence_slot: u64`, `evidence_pct_bps: u16`, `bump`.
- `Vault` (PDA `["vault", launch]`): system account holding the pool's lamports. Program is the only signer.
- `Stake` (PDA `["stake", launch, owner]`): `owner`, `launch`, `side` (Hit | Miss), `amount`, `is_rematch`, `claimed`, `bump`. One stake per wallet per launch (adding to the same side is allowed; switching sides is not).
- `Rematch` (PDA `["rematch", owner]`): `owner`, `amount_lost`, `source_launch`, `expires_at`, `used: bool`, `bump`. Created or overwritten when the owner's stake loses and they claim/acknowledge the loss.

### Instructions
- `init_config(params)` — admin only, once.
- `update_config(params)` — admin only. Cannot change anything that would affect open launches' math retroactively (window, stake close are copied into each `Launch` at open).
- `add_friend(wallet)` / `remove_friend(wallet)` — admin only.
- `register_launch()` — signer must be a Friend. Called **in the same transaction** as pump.fun's create instruction (and optional first buy) built by the frontend. Verifies the bonding curve account is the correct PDA for the mint under `config.pump_program`, is owned by it, and is not complete; creates `Launch` + `Vault`; transfers `launch_fee_lamports` from creator to vault; creates the creator's `Stake` on Hit.
- `stake(side, amount)` — signer must be a Friend; `now < launch.stake_close_at`; `launch.state == Open`; `amount <= max_stake`; transfers lamports to vault; updates totals.
- `stake_rematch(side)` — like `stake`, but amount is forced to `2 * rematch.amount_lost`, requires `!rematch.used && now < rematch.expires_at`, launch must not be the rematch's `source_launch`, marks `used`, sets `is_rematch = true`. Still respects `max_stake` (if 2x exceeds it, fail with a clear error; config default must make this impossible at default fees).
- `resolve(outcome, evidence_slot, evidence_pct_bps)` — signer must be `config.keeper` (or admin). Allowed when `now >= deadline`, or earlier only for outcome Hit. If either side total is 0 → state Void regardless of outcome. Writes evidence fields. Emits an event.
  - **Do this, not as a stretch:** pass the pump.fun bonding curve account and read its `complete` flag (find its exact byte offset in the pump.fun IDL and add a test against a real mainnet account snapshot). `Hit` requires `complete == true`; `Miss` requires `complete == false` and `now >= deadline`. Then the keeper is only a trigger and can't lie, and `resolve` can be permissionless (anyone may call it). If pump.fun's layout makes this unreliable, fall back to keeper-attested resolution and say so in the README.
- `claim()` — stake owner only, after resolution, once. Winner: `amount + floor(amount * losing_total / winning_total)` using u128 math. Void: `amount` back. Loser: nothing paid, but create/overwrite their `Rematch` with `amount_lost = amount`, `expires_at = now + rematch_secs`. Chained rematches are allowed: a lost rematch unlocks another one at 2x of that amount (capped by `max_stake`). Close the `Stake` account and return its rent to the owner.
- `sweep_dust()` — admin only, only when every stake of a resolved launch is claimed: send leftover rounding dust to the last claimer or close the vault to the creator. Document which.

### Rules
- No instruction lets admin or keeper withdraw from a vault.
- All math checked; no `unwrap` on arithmetic.
- Clear custom errors matching the copy deck error list (`NotOnGuestList`, `StakesClosed`, `RematchExpired`, `RematchAmountFixed`, `MaxStakeExceeded`, `AlreadyResolved`, `NotResolvable`, ...).
- Events for every state change so the frontend log can be built from transactions.

### Tests (must pass in CI)
Happy path HIT; happy path MISS; Void when one side empty; early HIT resolve; MISS cannot resolve early; stake after close fails; non-friend fails; rematch exact 2x, expiry, single use, cannot rematch on source launch; claim math including rounding; double claim fails; keeper cannot withdraw; launcher's launch fee lands on HIT.

---

## 3. pump.fun integration

- SDK: `@pump-fun/pump-sdk`. Read its current README and types before writing code. Use `createV2Instruction` (the v1 `createInstruction` is deprecated) and the SDK's buy instruction for the optional first buy. Graduation = `BondingCurve.complete === true`; use the SDK's graduation-progress helper for the curve % shown in the UI and logged as evidence.
- Mint addresses: generate the mint keypair in the browser; it signs the transaction alongside the wallet. Vanity `...pump` suffixes are optional, skip them for the MVP.
- Token metadata (image + JSON): first try pump.fun's own metadata upload endpoint from the browser; if CORS blocks it from GitHub Pages, upload via Irys with the user's wallet paying, or let the user paste an image URL. Say which one you shipped.
- The launch transaction = [pump.fun create (+ optional first buy)] + [sl0t `register_launch`], signed once by the wallet and the mint keypair. If it doesn't fit in one transaction, send two back to back and handle the half-done state (coin created, not registered) with a "Finish registering" button.
- Devnet: check whether pump.fun's program is usable on devnet. If it isn't, run the sl0t program tests on a local validator with the pump.fun program cloned from mainnet (`--clone` / `--clone-upgradeable-program`), and do the first live loop on mainnet with tiny amounts (launch fee 0.01 SOL, max stake 0.05 SOL). Say which you did.
- Fees: pump.fun takes its own trading fees and the creator gets creator fees as normal. SL0T takes nothing; `feeLine` in config explains this.

---

## 4. Keeper (`keeper/` + `.github/workflows/keeper.yml`)

- TS script, run with `pnpm keeper`. Env: `RPC_URL`, `KEEPER_SECRET_KEY` (base58 or JSON array), `PROGRAM_ID`, `CLUSTER`.
- Every run: fetch all `Launch` accounts with state Open. For each: read the pump.fun bonding curve through the SDK. If `complete` → `resolve(Hit)`. Else if `now >= deadline` → `resolve(Miss)`. Pass `evidence_slot` (slot you read at) and `evidence_pct_bps` (curve progress).
- Idempotent, safe to run twice at once (GitHub Actions `concurrency` group too). Log a JSON line per action. Exit non-zero only on real failures.
- Workflow: `schedule: cron: '*/15 * * * *'` plus `workflow_dispatch`. Secrets: `RPC_URL`, `KEEPER_SECRET_KEY`. Note in README that GitHub may delay scheduled runs by several minutes and disables schedules on repos with no activity for 60 days.
- Keeper wallet only needs a little SOL for fees. It has no power over funds.

---

## 5. Frontend (`app/`)

### Stack
Vite + React 18 + TypeScript, `@solana/wallet-adapter-react` (+ ui, wallets: Phantom, Solflare, Backpack via Wallet Standard), `@coral-xyz/anchor` client from the IDL, Three.js (lazy-loaded) for the reels, GSAP + ScrollTrigger for scroll choreography, Lenis for smooth scroll, Zustand or React Query for state. No backend. Hash router (`#/`, `#/floor`, `#/launch`, `#/coin/:mint`, `#/log`, `#/me`). `vite.config.ts` base from env (`/sl0t/` for project pages).

### Config (`app/src/config.ts`) — single source of truth
```ts
export const CONFIG = {
  cluster: 'devnet',           // 'devnet' | 'mainnet-beta'
  rpcUrl: '',                  // Helius URL goes here later; empty = public cluster RPC
  programId: '',               // empty = DEMO MODE (see below)
  keeperAddress: '',
  links: { x: '', github: '', telegram: '' }, // empty hides the button
  feeLine: '',                 // FAQ answer for trading fees, e.g. pump.fun's standard fees, creator fees to the creator, 0% to SL0T
}
```
Empty link → its button is not rendered. Empty `programId` → **demo mode**: the floor shows 6 seeded sample launches, every card and page carries a `DEMO` chip and the demo banner from the copy deck, and every write button explains it's a demo.

### Design system — "Vegas neon on black" (design A)
- Colours: background `#07060A`, surface `#120F17`, line `#2A2333`, neon red `#FF2E4D`, gold `#FFC24B`, hot pink `#FF4FD8` (sparingly), HIT green `#3DFF9A`, MISS red `#FF2E4D`, text `#F4EEE6`, muted `#9C93A6`.
- Type: display **Bungee** (and **Bungee Shade** for the big marquee only), UI **Space Grotesk**, numbers **JetBrains Mono** (tabular). Self-host the fonts (no Google Fonts request at runtime).
- Neon: layered `text-shadow`/`drop-shadow` glow + a subtle SVG turbulence flicker on the logo only. Tubes have a dim "off" state visible behind the lit state.
- Marquee bulb borders: a reusable `<BulbBorder>` component (CSS-only chasing lights, pauses offscreen).
- Texture: very subtle grain overlay and a radial vignette. Reflections on a glossy floor under the hero machine.
- Motion language: mechanical and weighty. Reels decelerate with overshoot and settle (custom easing). Lever has spring physics. UI transitions 200–300 ms, nothing floaty.
- Sound (off by default, toggle in nav, remembered in localStorage): synthesize with WebAudio — lever clunk, reel tick per symbol, settle thunk, HIT chime, MISS buzz. No audio files needed.

### Pages and choreography
1. **Intro** — exactly as the copy deck section 1 describes: hum, tube-by-tube neon ignition of S L 0 T (the 0 flickers twice), chasing bulbs, reels land 7·7·7, tagline, "PULL TO ENTER" with a draggable lever (click works too). Skippable, short version for returning visitors, static version for reduced motion. Must not block LCP: the intro is an overlay over the already-rendered hero.
2. **Landing (`#/`)** — hero with a 3D slot machine (Three.js: cabinet, three reel cylinders with a canvas-texture symbol strip, glass, emissive bulbs, bloom via `UnrealBloomPass` on desktop only). The machine reacts to the cursor (slight parallax) and the lever is pullable at any time (spins for fun, outcome purely cosmetic and labelled "just for fun" in a tiny tooltip). Live ticker strip below. Then the sections in copy-deck order: How it works (pinned 3-panel ScrollTrigger sequence where each panel turns one reel), Run it back (worked example with numbers counting up), The floor preview (top 6 live launches), How it's resolved, FAQ, footer.
3. **Floor (`#/floor`)** — grid of launch cards with live curve bars and countdowns, filters, polling every 15 s (and websocket `onAccountChange` for the visible ones).
4. **Launch (`#/launch`)** — form from the copy deck, image drop zone with preview, live cost summary, the lever as the submit button, then a full-screen spin while the transaction confirms.
5. **Coin (`#/coin/:mint`)** — header, countdown, curve progress, pool panel with HIT/MISS split bar and payout preview, stake form with rematch handling, your position, activity list, resolve overlay (copy deck section 9).
6. **Log (`#/log`)** — table built from program events/transactions, with Solscan links and resolution evidence.
7. **Me (`#/me`)** — stats, rematch card with countdown, claimables with "Claim all" (batch claims into as few transactions as fit).

### Quality bar
- Looks finished at 320, 375, 768, 1280, 1920 px. On mobile the 3D machine becomes a lighter 2.5D version (CSS 3D or a pre-rendered sprite) to keep it smooth.
- 60 fps target on a mid laptop; pause Three.js and bulb animations when offscreen or tab hidden; cap DPR at 2.
- `prefers-reduced-motion`: no intro animation, no bloom, reels jump to result.
- Accessible: real buttons, focus rings in gold, aria-live for toasts and countdowns, contrast AA for body text.
- Lighthouse: performance ≥ 85 on desktop for the landing page (lazy-load Three.js after first paint).
- No console errors. Wallet errors mapped to the copy deck error strings.
- Every number shown is read from chain or config. No invented stats, no fake activity outside demo mode.

---

## 6. GitHub Pages
- `pages.yml`: on push to main, build `app/` with `VITE_BASE=/<repo>/`, upload with `actions/upload-pages-artifact`, deploy with `actions/deploy-pages`.
- Add `404.html` = `index.html` copy as a fallback even though we use hash routing.
- The Helius RPC key will be added later by the owner into `CONFIG.rpcUrl` (or a `VITE_RPC_URL` build secret). Document that frontend RPC keys are public and should be restricted to the Pages domain in the Helius dashboard.

---

## 7. README
Setup, local validator/devnet flow, `anchor deploy`, adding friends, setting secrets, running the keeper manually, deploying Pages. A **Limitations** section in plain words: keeper trust model (or the on-chain check if you built it), GitHub cron delays, RPC key visibility, small amounts only until audited, not audited.

---

## 8. Final checks before you report back
- `anchor test`, `pnpm -C app build`, `pnpm -C app test`, `pnpm -C keeper typecheck` all pass.
- Grep the repo for leftover placeholder text, `lorem`, `TODO` in user-facing strings, and for words like `guarantee`, `profit`, `100x`, `moon`.
- Check the ticker is spelled `SL0T` (with a zero) everywhere it's the brand.
- Run the full loop with two wallets (devnet if pump.fun works there, otherwise mainnet with tiny amounts): launch, stake both sides, resolve HIT via keeper, claim; launch, resolve MISS, rematch 2x, claim.

End with a short summary: what you verified live (and on which cluster), what is mocked or demo-only, what you couldn't test and why, and any spec items you changed and why.
