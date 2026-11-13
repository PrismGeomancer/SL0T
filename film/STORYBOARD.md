# SL0T launch film, 20 s, 1920x1080, 30 fps

## PAGE
- Problem: launching a coin is a lonely gamble. Nobody is watching and a miss is just gone.
- Audience: Solana friend groups who launch on pump.fun.
- Goal: make them want a seat on the floor (launch, stake, run it back).
- Emotion: the thrill of a pull, then the smug relief of "run it back".
- The one true thing: a miss is not the end. One rematch, 2x, on a friend's launch.

## Inventory
| | |
|---|---|
| logo shape | coin, neon ring, marquee bulbs, reel window, slashed zero |
| core control | the lever |
| material | neon tube, chrome, lacquer, bulbs, glossy casino floor |
| key verb | pull |
| success moment | 7 7 7 = HIT, gold coins |
| failure moment | 7, cherry, BAR = MISS, one bulb pops |
| voice | dry, smug machine, honest about odds ("luck has nothing to do with it") |
| colour logic | gold = you act (pull / rematch / bulbs), green = HIT, red = MISS |
| type | Bungee (display), Space Grotesk (UI), JetBrains Mono (numbers) |
| never | emoji, price talk, promises, hype |

## Idea (chosen)
**The reels spin for 24 hours.** One lever pull is the whole launch window: the card's countdown runs while the reels blur, the curve stalls, the reels slam to a stop on MISS. Then the same lever, pulled again with 2x locked, lands 777. The film is two pulls: the second one answers the first.
Others considered: a typographic essay on the odds (no proof, house style); a single held shot orbiting the machine (beautiful, but never says what the product is).
Cover-the-logo test: a launchpad where the reels ARE the 24 h window and the rematch is a second pull. No competitor could use it.

## World
Dark casino floor, glossy mirror floor, red neon haze behind, gold bulb bokeh in the air, real 3D machine (ported from the site's own `three/machine.ts`: cabinet, three reel cylinders, bulbs, lever, marquee). UI is the site's own CSS (card, chip, curve bar, pool bar, buttons), magnified by the camera 3x, over the defocused machine.

## Beats (30 fps)
| f | role | buys | picture | handoff |
|---|---|---|---|---|
| 0-102 | hook | "this is a slot machine for coin launches" | macro of the knob in side profile, yank, whip back to the front, reels blur, bulbs chase. "Launch a coin." / "Hit or miss." | the lever pull is the cut |
| 102-232 | proof 1 | the reels ARE the window: clock runs, curve stalls | machine defocused left, $FROG card magnified right. Countdown 23:59 to 00:00, curve stuck at 71% | reels slam to a stop at 00:00 |
| 232-272 | turn | the result is physical | front mid-wide, reels land 7 / cherry / BAR, one bulb pops, lights sag | cut on the landing |
| 272-322 | turn | it's a MISS and the machine says so | close on the window, "MISS." then "Run it back." | |
| 322-400 | proof 2 | a miss unlocks one rematch at 2x | mirrored arrangement, dim, $DUCK card, REMATCH READY, amount 0.1 to 0.2 SOL, cursor presses Lock | the press cuts to the knob |
| 400-528 | payoff | the second pull answers the first | the same knob macro, yank, whip, push to the window, 777, gold coin fountain, "HIT." "$DUCK graduated." Claim 0.333 SOL | hard cut |
| 528-600 | cta | name, line, who it is for | full machine, mirror floor, marquee SL0T (the 0 flickers twice), "Every launch is a pull." then one small line | ends on bulbs still chasing |

Importance: the point beats are MISS (turn), the 777 (payoff) and the end line = 3 of 7. Everything else is supporting.
Hero moment (screenshot-worthy): 777 landing with coin fountain, window close, bloom.
Sound: dry. Hum, ratchet ticks tied to reel speed, lever thunk, bulb pop + buzz, silence before 777, bell, coins, end hum. Procedural (no ElevenLabs key).
