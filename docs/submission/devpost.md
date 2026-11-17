# Siegemate: Devpost entry

Draft of 2026-11-16 against main `9aba2f4`. Every claim was checked against the source (`src/xr/**`, `src/share/**`,
`src/scene/**`), the commit log and the plans in `docs/superpowers/plans/`. Nothing has been played on a real Quest:
every number below is from the IWER emulator or desktop Chrome and is labelled so. Lines in **[square brackets]** are
notes for the owner, not text to paste. The plain-text form boxes are in `docs/submission/plain/`. Written as "I" (a
solo entry). No em or en dashes.

Deadline: Tue Nov 18 2026, 12:00 PT (20:00 UTC). Freeze the build at 08:00 PT.

---

## Project name (60 characters max; this one is 49)

```
Siegemate: Living Chess Armies on Your Real Table
```

## Elevator pitch (200 characters max; this one is 196)

```
Mixed reality chess in the Meta Quest browser: pinch a sculpted soldier, send it marching across your real table, and watch it fight. Your room becomes the battleground. No install, works offline.
```

## Track and division

- Track: **Gaming**
- Division: **Adapted / Significantly Updated**. The earlier project is my own 3D chess game for desktop and phone
  browsers. Everything in mixed reality is new in the window (see "What is new since Sep 24" below).

---

## Inspiration

My earlier browser chess game already had chess pieces that were characters: three armies of sculpted,
rigged figures that walk to their squares, fight over every capture and burn away when they lose. On a monitor all of
that happens behind glass, and you click on it.

Passthrough changes the scale. On a real table the figures are the size of toy soldiers, close enough to lean over,
and you give orders with your own hand. I wanted that feeling of a battle laid out on the kitchen table, and I wanted
the room to take part: when you play on the snowy map it should snow around you.

I also wanted it to be easy to start. A link in the Quest browser, no install, and after the first visit it should play
the computer anywhere, offline.

## What it does

Siegemate is single-player chess against the computer, played on your real table in mixed reality.

- **Place the board.** Press Play on your table in the Meta Quest browser and look at a table. A ring finds the
  surface; pinch and the board stands there, squares about 5.75 cm across. With no table in sight for 8 seconds, it
  stands at seat height on a plinth instead.
- **Give orders by hand.** Pinch one of your figures and its legal squares light up, with a green order line from the
  figure to your fingers. Let go over a lit square and the figure turns, walks there at the pace of its rank and
  squares up. From further away, the hand's ray does the same. Touch controllers do everything hands do.
- **Watch the fight.** A capture is a short battle on the table: melee figures strike on the hit frame, casters throw
  fire, the Grande Armée fires muskets, and the loser burns away from the feet up.
- **Three armies.** Ivory Kingdom (medieval European), Sun Empire (Mesoamerican) and Napoleon's Grande Armée, chosen per
  side.
- **The room becomes the battleground.** Six maps, and each restyles the real room: a veil that darkens and tints the
  passthrough (never past 50%), weather falling around you (pollen, sand, snow, rain or rising embers), and the board's
  light pooling on the table. Switch mid-match from the headset menu; board, music and room follow.
- **Comfortable at a table.** Raise or lower the board 2 cm at a time, move, turn and resize it with two hands, switch
  sound and music, change side and strength (Squire, Knight, Warlord). Holding the Meta button to recentre keeps the
  board where it was on the table. The Quest menu pauses everything.
- **Promotion** brings up a Queen, Rook, Bishop, Knight card on your edge of the board.
- **Share the battle.** A finished game becomes a link with the whole game packed into the address, so it needs no
  server and opens offline. On the headset the result card shows it as a QR code; on a phone or computer, Share sends a
  1200×630 battle card with the link.
- **Offline.** After the first visit, the whole game, every army and every battleground is cached by a service
  worker, and the computer's search runs on the device.

## How I built it

The 2D game is a static Vite, React and TypeScript site with three.js for the scene, chess.js for the rules and a
negamax search with alpha-beta and quiescence in a Web Worker. The mixed reality edition adds a layer, `src/xr`, that
opens a WebXR `immersive-ar` session on the same scene engine and switches the engine into a table mode.

- **Session:** `local-floor`, with `hand-tracking` and `hit-test` as optional features (nothing else, since every
  optional feature can add a prompt). 72 Hz target frame rate, fixed foveation, framebuffer scale 1.0.
- **Renderer:** three.js resolves to `super-three` 0.185, Meta's fork, so both eyes can render in one multiview pass.
- **Table mode:** the board, figures and effects move under a scaled root (one game tile becomes about 5 cm). The
  hall's scenery, post-processing, shadow maps and every camera move are switched off, and the table gets its own key
  light that turns with the board.
- **Hands and controllers:** my own pinch tracker, one order handler per hand, panels drawn into canvas textures with
  poke and ray presses, and a pressed-button reader that turns a controller's trigger and grip into the same start,
  hold, end and lost events a pinch gives, so both run through the same code.
- **Room theming:** three extra draws per battleground (a veil, one instanced field of weather, a light pool).
- **Offline:** vite-plugin-pwa and Workbox precache the game; on a first visit, registration waits until the armies
  have loaded, so filling the cache does not slow the game's own first download.
- **Sharing:** a compact codec for the `#r=` link, a canvas-drawn battle card, Web Share with fallbacks, and a vendored
  QR encoder (uqr) so codes are made offline.
- **Testing:** unit tests in Vitest, and Playwright scripts that drive Meta's IWER emulator with scripted hands and
  Touch controllers: entering, placing, playing, two-hand resizing, recentring, promotion, controllers, the share QR,
  offline play and a performance check.
- I built it with Claude Code as a coding partner, working from written plans in `docs/superpowers/plans/`.

## Challenges I ran into

- **No headset.** Everything was built and tested in the IWER emulator. That caught real bugs but not everything:
  the session code never set `renderer.xr.enabled`, so headset frames came from the 2D camera metres
  away. I found it from a phone screenshot of a tiny board, fixed it, and added a check to the end-to-end test.
- **Additive light versus passthrough.** Additive effects also added to the framebuffer's alpha, which the compositor
  reads as "cover the room", so the table glow showed as a grey disc. Each additive material now leaves alpha alone on
  the table.
- **Draw calls.** The desktop game drew 455 calls a frame. Merging each figure's props, instancing the rings and crests
  and batching the board brought a figure to 2.75 draws and the board to 5. A table frame is now about 105 to 107 calls
  per eye in the emulator, inside a 150 budget.
- **The first frame on the table.** Every shader on the table differs from its 2D twin, so all of them compiled on the
  first frame the board was visible. They now compile behind the placement ring: 0 compiles when the board appears, in
  the emulator.
- **Stray pinches.** Opening your hand swings its ray, so a release used to land on the wrong square. A release is now
  judged by where the ray was 100 ms earlier, and a pinch that starts off the board plays nothing.
- **A frozen promotion.** The desktop promotion picker waited for a mouse click, so reaching the last rank in the
  headset froze the game. It is now a card on the table.

## Accomplishments that I'm proud of

- Hands-first from start to finish, with Touch controllers as a full alternative, and a side can switch mid-game.
- The armies keep their whole fight choreography on the table.
- The room theming stays comfortable by rule: the veil never passes 50%, and weather stays at least 70 cm from the eyes
  and out of the space in front of the face.
- A shared battle is just a link, with no server or account, and it plays back offline.
- Offline play against the computer after the first visit, proven by an end-to-end test that cuts the network.

## What I learned

- In passthrough, alpha is light. Anything that writes alpha darkens the real room.
- Teach by doing. The hints wait for the player to do each step, one gesture at a time, and say "trigger" instead of
  "pinch" when controllers are in hand.
- The first frame matters most in a headset. A stall when the board appears is felt as the room jumping.
- Emulator tests catch logic, not feel. Pinch thresholds, board size and reach are still waiting for a real headset.

## What's next for Siegemate

- Tune on a real Quest: pinch thresholds, default board size and reach, frame timing during fights.
- Online two-player with room codes through a small relay, with the opponent's head and hands drawn as a faint ghost
  across the board.
- Then social features built on it.
- A Meta Horizon Store build (Trusted Web Activity), so it can be installed like any app.
- **[Target launch date, if the form asks: owner to fill.]**

## What Meta VR capability(ies) did you use in your project?

Plain text: `docs/submission/plain/meta-capabilities.txt`.

- **Passthrough mixed reality:** a WebXR `immersive-ar` session in the Meta Quest browser puts the board on your real
  table, and each battleground restyles the real room (veil, weather, light on the table).
- **Hand tracking:** pinch to order a figure, pinch along the hand's ray from a distance, poke panels with a fingertip,
  and pinch both edges of the board to move, turn and resize it.
- **Hit-test:** finds a real surface within reach and at table height for the board.
- **Touch controllers and haptics:** trigger, grips, thumbstick and A/X, with a short pulse on taking an order,
  playing it and pressing a button.
- **System recentre:** the reference space's `reset` event keeps the board on its spot of the table.
- **Session visibility:** the Quest menu or taking the headset off pauses the clocks, the search and the sound.
- **Frame rate and foveation:** `updateTargetFrameRate(72)` and fixed foveation.
- **Multiview stereo** through super-three, Meta's three.js fork (unverified on a device; the emulator cannot run it).
- **Immersive Web Emulator (IWER):** every mixed reality test runs in it with scripted hands and controllers.

## Describe how Hand Interactions are implemented into your experience.

Plain text: `docs/submission/plain/hand-interactions.txt`.

Siegemate is played with bare hands from the first screen to the result card, through WebXR hand tracking.

- **Pinch detection:** my own tracker measures thumb tip to index tip. A pinch starts under 1.5 cm and ends past
  2.5 cm, so it does not flicker at the edge, and it rides out tracking gaps up to 0.15 s.
- **Ordering a figure:** a pinch within 3 cm of one of your figures takes hold of the order. Its legal squares light,
  a green line runs from the figure to your fingers and a ring marks the square under them. Open your hand over a lit
  square and the figure marches there. Lose the hand mid-order and nothing is played.
- **At a distance:** a pinch with the hand's ray on the board works the same way along the ray, or as click then
  click. The release is judged by where the ray was 100 ms before you opened your hand, and a ray swept across the
  board only plays a square you pressed on or rested on for 150 ms. A pinch with the ray off the board does nothing.
- **Panels:** buttons are poked with a fingertip (7 mm press, re-armed after backing out, never from behind) or pressed
  along the ray. Every button has hover and pressed states and a short sound; targets are at least 22 mm with 12 mm
  between them. A pinch that starts on a panel never reaches the board behind it.
- **Two hands:** pinch both edges of the board within 0.3 s and 10 cm of it to move, turn and resize it (0.6× to
  1.6×). Nothing moves until the hands have travelled 2 cm, turned 5° or spread 5%.
- **The system gesture:** a pinch with the palm facing you is the Quest menu gesture, and the game ignores it.
- **Teaching:** one hint at a time ("Pinch to place", "Pinch a soldier, drop on a glow"), each waiting until you do it.
- **Controllers:** the trigger and grips feed the same code as the pinches, for players who prefer them.

## Built with (25 tags max; this is 24)

```
typescript, webxr, three.js, super-three, meta-quest, hand-tracking, passthrough, mixed-reality, hit-test, iwer, chess.js, web-workers, web-audio, react, vite, vitest, playwright, workbox, pwa, service-worker, gltf-transform, meshoptimizer, cloudflare-pages, claude-code
```

---

## Try it

| Field | Value |
|---|---|
| Play in the headset (judge link) | `https://siegemate.pages.dev` (open in the Meta Quest browser) |
| Demo video (public YouTube or Vimeo) | **[PLACEHOLDER: video URL; title and description in `handoff.md`]** |
| Source code | **[PLACEHOLDER: repository URL, if it is made public]** |

## For judges: two-minute path

Plain text: `docs/submission/plain/for-judges.txt`.

```
- Sit at a table. Hands or Touch controllers both work.
- Open https://siegemate.pages.dev in the Meta Quest browser and press Play on your table. The first visit needs the internet; after that it plays offline.
- Look at the table until a ring sits on it, then pinch (or pull the trigger) to place the board. No table? After 8 seconds it stands at seat height.
- You play white against the computer at Knight strength. Pinch a soldier and let go on a glowing square. The computer answers.
- Take a piece to see a fight. Pinch both edges of the board to move or resize it.
- Menu (on the slab beside the board, or A/X): change Battleground to Frostfall or Siege at Dusk and watch the room change. Height ▲/▼, Sound and Music are there too.
- At the end, Share this battle on the result card shows a QR code of the replay link.
- Exit asks twice. Holding the Meta button to recentre keeps the board on the table.
```

## What is new since Sep 24 2026 (Adapted division)

Plain text: `docs/submission/plain/whats-new.txt`.

Before: my earlier 3D chess game for desktop and phone browsers, with the chess rules (chess.js), the computer
opponent in a Web Worker, the three sculpted armies with their animations and capture fights, the battlegrounds and
the music. It was imported into this repository as its first commit (`ca13508`, Nov 13 2026).

New in the window, all committed from Nov 13 to Nov 16 2026:

- The whole mixed reality edition: the WebXR passthrough session, table mode in the scene engine, placing the board on
  a real table with hit-test, and the seat-height fallback.
- Hand play (pinch orders, ray, poke, two-hand move, turn and resize) and full Touch controller play.
- Everything in the headset UI: hints, the control slab, the menu, the promotion card and the result card.
- The room taking on the battleground (veil, weather, light on the table).
- Offline play after the first visit (service worker), with every asset self-hosted.
- Sharing: replay links, the battle card and the headset QR code.
- The Quest performance work: compressed assets, merged and instanced draws, multiview, shader warm-up behind the
  placement ring, panel redraws capped at 15 Hz.
- The new name and look (Siegemate), and audio changes for the table (a quieter mix and a limiter).

---

## Unconfirmed / owner to check

- Confirmed by the owner (Nov 16): the earlier game pre-dates Sep 24 2026, so the division is Adapted. The
  repository's history starts at its import on Nov 13, so be ready to show the earlier game if a judge asks.
- The rules' exact wording for Adapted / Significantly Updated (`research/01-rules.md` has it second hand: "existing
  project with a meaningful new feature shipped in the window").
- Meta VR Start membership before submitting, and the Devpost registration.
- The Devpost form's real fields and limits, including whether it asks for a target launch date or a "future of VR"
  answer (`plain/future-of-vr.txt` is ready in case).
- Video rules: the competition research (`research/01-rules.md`, second hand) says under 3 minutes, real device or
  emulator footage, public on YouTube or Vimeo, and warns against AI-generated video. The film is emulator capture,
  labelled so on every frame; its narrator is a synthetic voice (Fish Audio), which the suggested YouTube description in
  `handoff.md` states. Confirm on the rules page that a TTS narrator is fine.
- Assets carried over from the earlier game (figures, clips, music, sound effects): if any were made with AI tools,
  check the rules on AI-generated content and the tools' terms.
- Licence: MIT (decided Nov 16), in `LICENSE`.
- Repository URL and video URL (placeholders above).
- That the live site matches main at the freeze. Last deploy: `4350869` (Nov 16, Cloudflare deployment fb8dfba6),
  with the share QR, promotion card, height controls and Lane B fixes. Re-checked Nov 17 11:50 PT: the live bundle
  carries build `4350869`, and no app file has changed on main since (only the film harness and docs).
- Whether Web Share or the clipboard work in the Quest Browser 2D page. The headset share path is the QR code; the
  phone and desktop path is tested in Chrome only.
- That judges play on Quest 3 or 3S. Nothing has been run on any Quest; frame rate on a device is unknown.
- "I" against "we": written as a solo entry.
