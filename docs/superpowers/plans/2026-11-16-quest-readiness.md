# Quest readiness, sharing and submission (Nov 16–18)

Deadline: **Tue Nov 18 2026, 12:00 PT (20:00 UTC)**. Freeze the build at 08:00 PT. Rollback point: `4350869` (deployment fb8dfba6; earlier `d5597c4`), live
at https://siegemate.pages.dev. Baseline: 181 unit tests green.

No headset is available, so everything below is verified in the IWER emulator only. **Emulator-green is not
Quest-verified.** Device-dependent tuning (pinch thresholds, palm-normal joints, multiview on hardware, default
board size and reach) stays as it is; see "Not changed blind" at the end.

Sources: two read-only audits (interaction/ergonomics; passthrough/perf/audio/settings) run on Nov 16, plus a
study of the Shadow Locks submission pipeline. The P0 promotion freeze and the stuck pause were re-checked by hand.

## Lane A — headset correctness and ergonomics (`src/xr/**` except roomTheme/roomStyler, promotion in `sceneEngine.ts`, `GameShell.tsx` XR hooks)

P0
1. Promotion freezes the game in the headset. The picker is placed in front of the 2D camera and is answered only by
   a DOM click or keyboard (`sceneEngine.ts` 4489, 4620, call sites 5019 and 5144). In table mode, show a
   Queen/Rook/Bishop/Knight card on the table UI that calls `engine.choosePromotion`, and don't build the 2D picker.
   An e2e that actually promotes.
2. Leaving through the Quest menu leaves the game paused for good (`GameShell.tsx` 357, `mixedReality.ts` teardown).
   Unpause in teardown.

P1
3. Stray pinches play moves: begin a ray "aim" only if the ray was on the board when the pinch started; tap only when
   release square = start square, or a lit square hovered ≥150 ms; use the aim from ~100 ms before release.
4. Two-hand board grab: both pinches must close within 300 ms of each other and within 10 cm of the board; dead zone
   2 cm / 5° / 5% before anything moves; snap scale to 1.0 within ±5%.
5. Height: menu ▲/▼ (±2 cm per press, clamped ±25 cm), remembered; controller thumbstick Y does the same.
6. Playing black: check whether the rig turns so the player's own army is near; if not, add π to the yaw.
7. Seed the headset menu's strength and side from the game snapshot.
8. Reference-space `reset` (Meta-button recenter): re-place the board.
9. Table search: count only visible time; fallback after 8 s, not 4 s.
10. Menu: Sound on/off and Music on/off toggles; Exit asks to confirm; press and hover blips on every panel button.
11. Panels face the player once when shown, not every frame; gaps between buttons ≥ 12 mm.
12. Drop the unused `anchors` and `plane-detection` session features (requested, never read, may add a prompt).
13. Pinch `end`/`lost` events reach an ordering hand even inside a panel's poke volume.
14. Hand rays drawn only while they hit the board or a panel.
15. Controllers: A/X opens the menu.

## Lane B — Quest performance, passthrough comfort, audio (`src/audio/**`, `src/scene/**` except promotion, `src/xr/roomTheme.ts`, `src/xr/roomStyler.ts`, `index.html`, `src/main.tsx`)

1. Shader warm-up: keep the same light set in 2D and table mode (pre-add the table hemisphere/key at intensity 0),
   and compile programs before the first table frame (`compileAsync` behind the placement reticle), so entering MR
   doesn't stall.
2. Coach panel: stop re-uploading a 1260×240 canvas every frame (redraw ≤15 Hz, no mipmaps).
3. Weather comfort: particles ≥0.7 m from the eyes and out of the forward cone; sand ≤0.3 m/s; no rain/sand
   sheets across the face.
4. Audio: drop the castle-hall ambience bed on the table and lower the score; compressor/limiter on master; resume
   the AudioContext when the session or page becomes visible, suspend when hidden.
5. Capture fights on the table: cap the clip-wait stall (≤0.8 s) so a capture never holds the game.
6. Fix embers/pollen darkening the room after a theme switch (`roomStyler` sets additive blending back).
7. Arena switch on the table: no PMREM rebuild mid-session; prefetch the next score.
8. When XR is supported, skip the 7 s intro fly-in so "Play on your table" shows at once; register the service
   worker after the game is interactive.
9. `index.html` share tags point at an old rork.live host and describe the desktop game: rewrite for Siegemate
   with the Pages URL and a new og image.
10. Small per-frame allocations in the XR loop (roomStyler colours, readHead vector, per-input ray).

## Lane C — sharing (offline, no server)

- Replay link: the whole game (moves, armies, battleground, result, sides) in the URL hash, e.g.
  `https://siegemate.pages.dev/#r=…`. Opening it plays the game back on the board with the armies, from the cache when
  offline. A broken or tampered link falls back to the menu with a short notice.
- Battle card: a 1200×630 image of the final position, the result, both armies and the battleground; Web Share with
  the file and the link where available, otherwise download + copy link.
- Headset: the result card gets "Share this battle", showing a QR code of the replay link (generated locally) and
  the short link, so a phone can pick it up.

## Lane D — demo film (emulator)

- A Playwright + IWER capture harness for Siegemate modelled on Shadow Locks (`tests/video`, virtual clock, scripted
  hands, a photographed CC0 room behind passthrough, labelled "Emulator capture · simulated room").
- Shots: placing the board on a table, pinching a figure and carrying it, a capture fight, promotion card, the room
  changing with the battleground, the menu (height, sound), the result card with the share QR, offline play.
- Narration: Fish Audio REST, `model: s2.1-pro-free` header, S2 `[emotion]` tags at sentence starts, generated after
  the cut is timed; -14 LUFS film, voice ducking the game sound.

## Lane E — README, Devpost, images

- README rewritten for the mixed reality edition; a strong first paragraph; images distinct from the Devpost
  gallery (README: 16:9 stills inline in prose; Devpost: 3:2 gallery with captions). Deliberately not the Shadow
  Locks layout (no centred hero/badge rows, no judging table, no 3×2 screenshot grid).
- Devpost text field by field from `../../2026-11-meta-vr-start-developer-competition/plan/submission/devpost.md`'s
  form, Adapted division with a plain statement of what is new since Sep 24 (the whole mixed reality edition).
- "What's next": online two-player and social, after the competition.

## Not changed blind (needs a headset)

Pinch thresholds (15/25 mm) and the palm-normal joints; multiview on hardware; default board size 1.15 (5.75 cm
squares) and placement reach 1.0 m; depth occlusion of real hands. Device checklist: `?debug` fps card, ≥72 fps
during a capture, promote a pawn, recenter with the Meta button, quit through the system menu and come back.

## Progress log

- 2026-11-16: Lanes A (headset fixes), B (perf/comfort/audio + shader keeper: 0 compiles on every capture in the
  emulator), C (sharing), D (film harness, drafts of shots a–g) and E (README/Devpost) merged. Crest-through-card fix,
  MIT licence. Full suite green on main (unit 261; e2e offline, update, replay, xr-play, xr-controllers, xr-share,
  xr-perf, perf-check). **Deployed 4350869** to https://siegemate.pages.dev (deployment fb8dfba6). Still emulator-only.
- 2026-11-17 (PT): film-2 fast-forwarded into main (cut levelled to -14 LUFS / -1 dBTP; offline shot fails requests
  fast). A shot-i render hung for 23 h on the offline engine load and held the GPU lock; it was stopped, and shot i now
  plays one exchange online before the network goes. Narration generated with Fish Audio: 25 lines, 63.2 s of speech,
  retimed in `tests/video/cut.json` against the shots' events. Live site re-checked: build `4350869`, unchanged app
  code on main, unit 261 green, so no redeploy. Owner steps in `docs/submission/handoff.md`. Final 1080p60 cut in
  progress.
