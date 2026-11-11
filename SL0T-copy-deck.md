# SL0T — Copy deck

Voice: a late-night casino floor run by someone with a sense of humour. Short, confident, specific. Numbers over adjectives. No emoji in body copy, no price talk, no promises. The machine is the narrator; it is dry, a little smug, and always honest about the odds.

Italic accent phrases are marked like *this*. Everything in `{curly}` comes from config or chain.

---

## 0. Meta

- Title: `SL0T — Every launch is a pull`
- Description: `A friends-only Solana launchpad. Launch a coin, see if it hits, and if it misses, run it back: double or nothing on the next one.`
- OG title: `SL0T — Every launch is a pull`
- OG description: `Launch. Hit or miss. Run it back.`

---

## 1. Intro (first visit, ~4.5 s, skippable)

Sequence and the text that appears with each beat:

1. Black screen. A single hum. Small mono text, bottom left: `POWERING UP THE FLOOR`
2. Neon tubes flicker on letter by letter: **S — L — 0 — T**. The 0 flickers twice, then holds.
3. A bulb border chases around the marquee. Mono text: `3 REELS · 2 OUTCOMES · 0 HOUSE`
4. The reels spin and land on 7 · 7 · 7. Tagline fades in: *Every launch is a pull.*
5. Button (pulsing): `PULL TO ENTER` — dragging the lever down or clicking it opens the site.

- Skip link, top right: `Skip intro`
- Returning visitors (seen within 7 days): short 1.2 s version, marquee only.
- Reduced motion: static marquee, tagline, and the `Enter` button.

---

## 2. Nav

- Logo: `SL0T`
- Links: `How it works` · `Run it back` · `The floor` · `Log`
- Button (not connected): `Connect wallet`
- Button (connected, on allowlist): `{short address}` + green dot
- Button (connected, not on list): `{short address}` + red dot, tooltip `Not on the guest list`
- Network badge: `DEVNET` (amber) / `MAINNET` (hidden when mainnet)
- Sound toggle: `Sound: off` / `Sound: on`

---

## 3. Hero

- Eyebrow: `A FRIENDS-ONLY LAUNCHPAD ON SOLANA`
- Headline: Every launch is *a pull.*
- Lede: Launch a coin. In 24 hours it either hits or it misses. If it misses, you get one more pull: put your lost fee and the same again on a friend's launch. Double or nothing.
- Primary CTA: `Launch a coin`
- Secondary CTA: `Watch the floor`
- Live ticker strip under the hero (from chain): `{n} launches · {n} hits · {n} misses · {x} SOL in open pools`
  - Empty state: `The floor is quiet. Be the first pull.`
- Small print under CTAs: `Guest list only. Devnet until we say otherwise.`

---

## 4. How it works (3 panels, the reels turn as you scroll)

Section heading: How one pull *works.*

**Panel 1 — Launch**
- Label: `01 · PULL`
- Heading: Launch a coin.
- Body: Name it, give it a ticker and an image, sign once. Your coin goes live on a bonding curve, and your {launchFee} SOL launch fee goes on the line: it backs your own coin to hit.
- Facts:
  - `Supply: 1,000,000,000`
  - `Window: {windowHours}h`
  - `Launch fee: {launchFee} SOL`

**Panel 2 — The reels**
- Label: `02 · SPIN`
- Heading: Hit or miss.
- Body: A launch *hits* when its curve fills and the coin graduates inside the window. Anything else is a miss. No judges, no vibes: the curve either filled or it didn't, and anyone can check.
- Reel states: `7 · 7 · 7 = HIT` / `7 · 🍒 · BAR = MISS`

**Panel 3 — Run it back**
- Label: `03 · AGAIN`
- Heading: Missed? Pull again.
- Body: A miss unlocks one rematch. Lock your lost fee plus the same again, 2x, on any open launch. Call it right and you take your share of the other side. Call it wrong and the 2x is gone.
- CTA: `See how the money moves`

---

## 5. Run it back (the rematch, explained)

Section heading: Double or *nothing.* Mostly double.

Lede: Every launch opens a pool with two sides. HIT backs the coin to graduate. MISS bets it won't. When the window closes, the winning side splits the losing side. SL0T takes nothing.

Three facts in a row:
- `2 sides` — HIT or MISS, pick one.
- `2x` — a rematch always locks twice what you lost.
- `0%` — the house cut. There is no house.

**Worked example** (card with animated numbers)
- Ana launches $FROG. Her 0.1 SOL launch fee sits on HIT. $FROG misses. The 0.1 SOL goes to the MISS side.
- Ana runs it back: she locks 0.2 SOL on HIT for Bo's $DUCK.
- The $DUCK pool: 0.6 SOL on HIT, 0.4 SOL on MISS.
- $DUCK graduates. HIT wins. Ana gets her 0.2 back plus 0.2 / 0.6 of the 0.4 on MISS: *0.333 SOL.*
- If $DUCK had missed, Ana's 0.2 would have gone to the MISS side.

Rules list:
- One rematch per miss. It expires {rematchHours}h after your miss.
- Stakes close {stakeCloseHours}h after a launch opens, so nobody can pile in when the curve is 95% full.
- Max stake per pull: {maxStake} SOL.
- If one side of a pool is empty when it resolves, everyone gets refunded. Nobody wins against nobody.
- Your 2x is locked in the pool vault the moment you sign. You're never charged later.

---

## 6. The floor (live launches grid)

Section heading: The *floor.*
Lede: Every coin launched on SL0T, live. Open ones are still spinning.

Filters: `Spinning` · `Hit` · `Miss` · `Mine`

Card fields:
- `{name}` / `${ticker}`
- Curve bar: `{pct}% filled`
- Countdown: `{hh:mm} left` / `Stakes closed` / `Resolved`
- Pool: `HIT {x} SOL · MISS {y} SOL`
- Status chip: `SPINNING` (gold) · `HIT` (green) · `MISS` (red) · `VOID` (grey)
- Card CTA: `Open`

Empty states:
- No launches at all: `No coins on the floor yet. Somebody has to go first.`
- Filter `Mine`, none: `You haven't pulled yet.`
- Demo mode (no program configured): banner `DEMO FLOOR — sample launches, not real coins.` and every card carries a `DEMO` chip.

---

## 7. Launch page (form)

- Heading: Pull the lever.
- Lede: One signature launches your coin and puts your launch fee on HIT.
- Fields:
  - `Coin name` — placeholder `Frog Of Wall Street` — hint `Up to 32 characters`
  - `Ticker` — placeholder `FROG` — hint `2–10 characters, letters and numbers`
  - `Image` — `Drop an image or click to upload` — hint `PNG, JPG or GIF, max 2 MB. You pay the tiny upload fee from your wallet.`
  - `Description` (optional) — placeholder `One line. Make it count.`
  - `First buy` (optional) — `0` SOL — hint `Buy some of your own coin in the same transaction`
- Summary box:
  - `Launch fee (on HIT): {launchFee} SOL`
  - `Upload + rent + network: ~{est} SOL`
  - `First buy: {x} SOL`
  - `Total: {total} SOL`
- Button: `Pull` → loading `Spinning up…` → done `It's live`
- Gate (not on list): `This floor is guest list only. Ask the host to add {short address}.`

---

## 8. Coin page

- Header: `{name}` `${ticker}` + status chip
- Countdown: `Resolves in {hh:mm:ss}` / `Resolved {time ago}`
- Curve: `{pct}% to graduation` with the bar; on hit: `Graduated. The reels say HIT.`
- Pool panel:
  - `HIT {x} SOL` / `MISS {y} SOL` with a split bar
  - `If HIT wins, 1 SOL on HIT returns {r} SOL`
  - `If MISS wins, 1 SOL on MISS returns {r} SOL`
  - Inputs: side toggle `HIT` / `MISS`, amount
  - If the user has a rematch available: badge `REMATCH READY` and the amount locked to `{2x} SOL`
  - Button: `Lock {amount} SOL on {side}`
  - Closed: `Stakes are closed. Now we wait.`
- Your position: `You have {x} SOL on {side}` / after resolve: `You won {x} SOL` + `Claim` / `You lost {x} SOL. Run it back?`
- Activity list: stakes and claims with Solscan links.
- Links: `Solscan` · `Meteora` · `Copy mint`

---

## 9. Resolve moment (full-screen overlay when a launch you're in resolves while you watch)

- The reels spin for 2.5 s.
- HIT: lands 7 · 7 · 7, gold coins burst, text: *HIT.* `{ticker} graduated.` Button `Claim {x} SOL`
- MISS: lands mismatched, one bulb pops, text: *MISS.* `{ticker} didn't make it.` Button `Run it back` (if eligible) / `Back to the floor`
- VOID: reels stop on blanks, text: `VOID. Nobody took the other side. Refund ready.` Button `Claim refund`

---

## 10. The log

Section heading: The *log.*
Lede: Every launch, every stake, every resolution. Public transactions, nothing off the books.

Columns: `Time` · `Event` · `Coin` · `Wallet` · `Amount` · `Tx`
Event names: `LAUNCH` · `STAKE HIT` · `STAKE MISS` · `REMATCH` · `RESOLVED HIT` · `RESOLVED MISS` · `VOID` · `CLAIM`
Resolution rows show the evidence: `curve {pct}% · migrated: yes/no · checked at slot {slot}`

Empty: `Nothing logged yet.`

---

## 11. How it's resolved (fairness section)

Heading: Who calls it? *The curve does.*
Body: The program reads the Meteora curve itself: graduated means HIT, still on the curve when the window closes means MISS. A keeper calls `resolve` every 15 minutes, but anyone can, and nobody can make it say something the curve doesn't. Nobody can move a vault's SOL except the winners claiming it.
Facts:
- `Keeper: {keeperAddress}`
- `Program: {programId}`
- `Runs: every 15 min on GitHub Actions`
- Link: `Read the program` (repo URL)

---

## 12. My pulls (#/me)

- Heading: Your pulls.
- Stats: `Launched {n}` · `Hits {n}` · `Misses {n}` · `Net {±x} SOL`
- Rematch card: `Rematch ready: {2x} SOL · expires in {hh:mm}` / `No rematch waiting.`
- Claimables: `{n} claims waiting · {x} SOL` + `Claim all`

---

## 13. FAQ

- **Is this a real launchpad?** The coins are real SPL tokens on a Meteora bonding curve. It's an MVP for a small group of friends, on devnet first.
- **Can I lose more than I lock?** No. Whatever you lock is the most you can lose. Nothing is ever taken from your wallet later.
- **Why 2x?** Because a rematch should feel like one. You lost x, you put x back plus x more.
- **What if nobody takes the other side?** The pool is void and everyone is refunded.
- **Who gets the trading fees?** {feeLineFromConfig}. SL0T takes 0% of the pools.
- **Can the host rig it?** The outcome is whether the curve graduated, which anyone can check on chain. The keeper can only resolve; it can't move funds.
- **How do I get on the guest list?** Ask the host.

---

## 14. Toasts

- `Wallet connected.`
- `Wallet disconnected.`
- `Signing… check your wallet.`
- `Coin launched. The reels are spinning.`
- `Locked {x} SOL on {side}.`
- `Rematch locked. Good luck. Actually, luck has nothing to do with it.`
- `Claimed {x} SOL.`
- `Copied.`
- `Upload done.`

## 15. Errors

- `You cancelled the signature. No harm done.`
- `Not enough SOL. You need {x} SOL including fees.`
- `This floor is guest list only.`
- `Stakes on this coin are closed.`
- `Your rematch expired.`
- `Rematch amount is fixed at {2x} SOL.`
- `Max stake is {maxStake} SOL.`
- `Image upload failed. Try a smaller file.`
- `The network is busy. Try again in a moment.`
- `Couldn't reach the RPC. Check your connection or try again.`
- `Transaction failed: {short reason}`

---

## 16. Footer

- Line 1: `SL0T — every launch is a pull.`
- Links: `X` · `GitHub` · `Program` (each hidden when its config value is empty)
- Small print: `A private project for friends. Not financial advice. Meme coins can lose all their value, and anything you lock in a pool can be lost. Only play with what you're fine losing. Devnet until announced.`
- Copyright-free sign-off: `Lights stay on.`
