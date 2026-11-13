# Mixed Reality Chess (Quest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the King's Gambit browser game into a hands-first mixed reality chess game for Meta Quest 3/3S. The living armies fight on your real table, and the chosen battleground restyles your room. Submit it to the Meta VR Start Developer Competition 2026 (Adapted, Gaming) by **Nov 18 2026, 12:00 PT (20:00 UTC)**.

**Architecture:** This repo is a fork of `../web`. The 2D game keeps working and gets the performance fixes. A new `src/xr/` layer opens an `immersive-ar` WebXR session on the *same* `SceneEngine` and switches it into **table mode**. In table mode the board, pieces and effects are re-parented under a scaled root (1 tile ≈ 5 cm). The 100 m scenery, post-processing, shadow maps and camera moves are off. Hands drive the existing select/move/premove logic. The chess core (`src/core`) and the search worker (`src/ai`) are reused untouched.

**Tech Stack:** TypeScript 5.9 (strict), React 19 (2D page only), `three` aliased to `super-three@0.185.0` (Meta's fork: `multiviewStereo`, foveation), chess.js, Web Audio, Vite 8, Vitest 4, Playwright 1.60 with the IWER Quest 3 emulator (`iwer@2.8.0`), `@gltf-transform/cli@4.5.1`, Rust (axum) for the server, Bubblewrap TWA for the Quest APK.

**Spec:** The design summary below. It is the spec. It was agreed in conversation on 2026-11-13, when the owner opted to skip a separate design doc.

## Design summary (the spec)

- **Player journey:** Open the link in Quest Browser. A dark launch page shows one big **Enter mixed reality** button. Passthrough comes up, then a reticle finds your table. Pinch to place the board (or it appears at seat height if no table is found). The start panel offers colour, strength (Squire/Knight/Warlord), battleground and armies. Play by pinching a figure, carrying it and letting go on a square. Or point and pinch at a distance (controllers work the same way). The AI replies, and figures march, strike and burn away on your table. Game-over panel: Rematch or change the setup.
- **The room takes on the battleground** (purposeful passthrough): per-theme room dimming, falling weather in the room (snow, rain, sand, pollen, embers), a warm light pool on the real table under the board, and a miniature ring of the theme's scenery around the board. Stretch: a portal on a real wall looking out on the battleground.
- **Performance is a feature:** a steady 72 Hz on Quest 3S. Today the game issues 455 draw calls, 535k triangles and 381 materials per frame on Low. On the owner's Intel Iris Plus laptop it runs at 24 fps auto / 52 fps Low, with 33 ms hitches. Both get fixed at the root.
- **Edge cases are designed, not discovered:** lost tracking, system menu, no table, controllers, illegal drops, promotion, resume after exit.
- **Social comes last:** online two-player through a Rust WebSocket relay on ioflood with room codes, and the opponent's head and hands shown as a ghost. Only after single-player is done and shipped.
- **Name:** pending the owner's pick (see README). It lives in one constant, `APP_NAME` in `src/brand.ts`.
- **How a move is made (decided while building, 2026-11-13):** you *command*, you don't carry. Pinching one of your figures selects it and lights its squares. A glowing command line runs from the figure to your hand, and a ring marks the square under it. Letting go there sends the figure **marching** there with the full choreography. Pinching anywhere else aims the hand's ray instead (pinch-release taps the square it points at), and that is also the controller path. Both go through the same click rules as the mouse (`handleSquareTap`), premoves included.

## Global Constraints

- Every commit is authored by `Khadija Anwaar <anwaar.khadija16@gmail.com>` (repo-local config, already set). Messages are English Conventional Commits (CONTRIBUTING.md) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Strict TypeScript, no `any`. `src/core` never imports three.js. New scene systems get their own file.
- Hands-first: every action works with bare hands (pinch, grab, poke), and controllers are never required.
- Quest XR budget per frame, measured in the emulator perf spec: **≤ 150 draw calls, ≤ 250k triangles, ≤ 8 ms main-thread frame time** on this laptop as the proxy. Target 72 Hz (`updateTargetFrameRate(72)`), `renderer.xr.setFoveation(1)`, framebuffer scale 1.0.
- No post-processing and no shadow maps in XR (they disable fixed foveation). Use contact/blob shadows only.
- Hand UI (Meta): hit targets ≥ 22 mm, ≥ 12 mm between targets, touch panels at 42–46 cm, ray panels at 0.8–3 m and never 0.5–0.8 m, text ≥ 0.9 cm at 0.6 m, no italics, dark glass backgrounds, a hover state + pressed state + short sound on every press. The palm-pinch system gesture must trigger nothing.
- All assets are self-hosted under `public/assets/`, with no runtime dependency on `r2-pub.rork.com`.
- **Offline play vs the AI is a headline feature (owner, 2026-11-13).** After the first launch, the game, every asset of both chosen armies, the AI worker and the audio must work in airplane mode, in Quest Browser and in the installed Quest app. Only online two-player may need a network. The search already runs on-device in `src/ai/engine.worker.ts`.
- Seated play: nothing requires standing or walking. Room dimming never exceeds 0.6 alpha.
- Judges play the hosted link and/or the APK on the "Competition" release channel. Whatever is live at the deadline is what gets judged. Freeze at Nov 18 08:00 PT.

## Review Focus

1. **Tracking lost mid-carry** (hand leaves view or joints vanish for > 150 ms): the figure glides back to its square, no move is played, highlights clear. Test in Task 9.
2. **System menu or headset off during the AI's turn or mid-animation:** the clocks stop, the choreography pauses, and on return it resumes exactly. Nothing is lost. Test in Task 11.
3. **No table found** (no hit-test, dark room, permission declined): within 4 s the board stands at seat height on a visible virtual plinth that can be moved. Test in Task 8.
4. **Controllers instead of hands, or switching mid-game:** ray + trigger does everything a pinch does. Test in Task 9 (IWER controller profile).
5. **Release on an illegal square, an own piece or off the board:** illegal → glide back + soft reject sound. Own piece → that piece becomes selected. Off-board → cancel. Test in Task 9.

---

## Schedule (local dates; deadline Tue Nov 18 12:00 PT)

| Day | Tasks | Exit check |
|---|---|---|
| Thu Nov 13 | 1–5 (performance foundation) | Laptop ≥ 58 fps on its auto preset with p95 ≤ 20 ms. Figures ≤ 4 draws each |
| Fri Nov 14 | 6–9 (XR core) | In the emulator: enter → place → grab e2→e4 → the AI replies |
| Sat Nov 15 | 10, 11, 14 | A full game vs the AI in the emulator, with pause/resume |
| Sun Nov 16 | 12, 15, 16 | Hosted link live on ioflood. Room themes in. Device test if a headset is available |
| Mon Nov 17 | 17, 18 (+19 if all green) | APK on the Competition channel, video cut, Devpost drafted |
| Tue Nov 18 | Freeze 08:00 PT, submit by 11:00 PT | Submission confirmed |

## File Structure (new or heavily changed)

```
src/brand.ts                     APP_NAME and tagline (one place to rename)
src/scene/quality.ts             pure GPU classification + multi-step watchdog policy
src/scene/merge.ts               merge static meshes that share a parent + material
src/scene/idleScheduler.ts       staggered idle-animation updates
src/scene/sceneEngine.ts         + table mode, + public drag/tap API, camera no-ops in table mode
src/scene/board.ts               batched tiles/labels, instanced highlights
src/assets/generated.ts          URLs → local /assets paths via assetUrl()
src/assets/assetUrl.ts           base-path aware local asset URLs
src/xr/session.ts                immersive-ar session: features, 72 Hz, foveation, visibility/end events
src/xr/tableRig.ts               scaled table root (TABLE_SCALE), plinth, re-place/rotate
src/xr/placement.ts              hit-test reticle, anchors, fallback pose
src/xr/hands.ts                  PinchTracker, palm direction / system-gesture veto
src/xr/orders.ts                 HandOrders: one hand's pinch → engine order/tap API
src/xr/markers.ts                command line, target ring, pointer rays, placement ring
src/xr/ui/panel.ts               CanvasPanel: poke + ray press, hover/pressed, sounds
src/xr/ui/menus.ts               start, side, HUD, game-over panels
src/xr/lifecycle.ts              pause/resume/end state machine, game persistence
src/xr/roomTheme.ts              per-battleground dimmer, weather, table light, diorama
src/xr/perfHud.ts                dev-only draw/tri/frame-time overlay + window.__perf hook
src/xr/mixedReality.ts           MixedReality: session → placement → table mode → hands/controllers each frame
src/core/persist.ts              SavedGame storage (resume after a lost session)
src/ui/Launch.tsx                2D launch page (dark, ≥ 60 px targets, resume card)
tools/optimize-assets.mjs        download + optimize every remote asset into public/assets
tools/check-assets.mjs           budget check: per-file triangles, total size, no remote URLs
tests/e2e/*.spec.ts              Playwright + IWER: xr-enter, grab-move, lifecycle, perf
server/                          Rust axum: static files, /up, (later) /ws relay
twa/                             Bubblewrap config for the Quest APK
```

---

## Progress log

- 2026-11-13: Task 1 done (laptop auto preset 24 → 55 fps menu, 40 → 56 fps duel). Task 5 done (A/B frame-time check pending a free GPU). Tasks 2, 3, 4 running in parallel lanes. Tasks 6–9 core landed without the super-three swap (waiting for the lanes, since they share node_modules): session, rig, placement, pinch, orders, markers, `MixedReality`, engine table mode, IWER e2e (`tests/e2e/xr-play.mjs`). Task 11's save/resume core landed.
- 2026-11-13 (evening): all lanes merged. Assets self-hosted and compressed (72 -> 22 MiB; figures 3.5-7k tris), figures 2.75 draws each, board 5. The table frame is 47-48 calls per eye (budget 150). super-three multiview on (`?multiview=0` to disable). Anti-aliasing always on; idle breathing on every preset. Table lighting, smaller crests, default board 1.15x, two-hand move/turn/resize (remembered). Placement only accepts reachable table-height surfaces. Headset UI: onboarding coach, control slab, menu (strength, side, battleground, new game, re-place, how to, exit), result card. Room theming (veil, weather, table glow), Battleground mid-match. Stats (W/L/D, streaks). Save/resume. Offline via service worker (proven by `tests/e2e/offline.mjs`). 2D restyle (Inter, high contrast, minimal text). `?debug` fps card. Live at https://siegemate.pages.dev (docs/deploy.md).
- 2026-11-13 (late): `renderer.xr.enabled` was never set, so headset frames came from the 2D camera metres away (the phone's "tiny board"); fixed, with an e2e check. Additive effects no longer write alpha (passthrough stays lit). Returning players auto-update at the menu (`src/app/updateGate.ts`). Touch controllers now play fully: trigger orders by ray drag or click-click, both grips move/resize, hover ring, haptics, coach wording per input (`tests/e2e/xr-controllers.mjs`). Correction: the table frame is ~107 calls per eye in the emulator; the earlier 47-48 was measured from the wrong camera. Deployed 0409b4a.
- Still open: real-device test (friend's Quest 3S), TWA APK + Competition channel (needs the owner's Meta dashboard and Start membership), demo video (real footage), Devpost text, resume card in the 2D page, Settings/HUD contrast pass, two-player (Phase E).
- Tooling: `tools/perf-check.mjs` (budgets, fails on a dead frame), `tools/perf-probe.mjs` (fps), `tools/gpu-lock.mjs` (one GPU test at a time: parallel headless Chromes made the Iris Plus lose its WebGL context).

## Phase A — Performance foundation (also fixes the laptop)

### Task 1: Right preset on first load, keep stepping down

**Files:** Modify `src/scene/quality.ts`, `src/scene/sceneEngine.ts:1455-1479`. Test: `src/scene/quality.test.ts`

**Interfaces — Produces:**
`classifyGpu(input: { renderer: string; cores: number; memory: number; touch: boolean }): QualityPreset`;
`nextPresetForFps(current: QualityPreset, averageFps: number): QualityPreset | null`. `detectQualityPreset()` keeps its signature and calls `classifyGpu`.

- [ ] Step 1: Write the failing tests:
  - `classifyGpu({renderer:"angle (intel, angle metal renderer: intel(r) iris(tm) plus graphics, unspecified version)", cores:8, memory:8, touch:false})` → `"low"`
  - `"...intel(r) uhd graphics 630..."` → `"low"`
  - `"angle (apple, apple m2, ...)"` with 8 cores / 8 GB → `"ultra"`
  - `"...adreno (tm) 740..."` (Quest) with touch:false → `"low"`
  - `nextPresetForFps("high", 39)` → `"medium"`; `nextPresetForFps("low", 30)` → `null`; `nextPresetForFps("medium", 50)` → `null`
- [ ] Step 2: `npx vitest run src/scene/quality.test.ts` → FAIL (not exported)
- [ ] Step 3: Implement. Integrated Intel (`iris|uhd|hd graphics`) and any Adreno → low. The engine's watchdog drops one step per settle window (6 s after the last change) while the average is below 45 fps. The one-shot `autoAdjusted` flag goes.
- [ ] Step 4: Tests pass. `node <scratch>/measure.mjs` on the preview build shows auto ≥ 50 fps on this laptop.
- [ ] Step 5: Commit `perf(scene): classify integrated GPUs as low and keep stepping down`

### Task 2: Self-hosted, optimized assets

**Files:** Create `tools/optimize-assets.mjs`, `tools/check-assets.mjs`, `src/assets/assetUrl.ts`. Modify `src/assets/generated.ts` (bases → `assetUrl("models")` etc.) and every `GLTFLoader` construction (`src/scene/gltfQueue.ts` and wherever `new GLTFLoader` appears) to call `setMeshoptDecoder(MeshoptDecoder)`. Test: `src/assets/assetUrl.test.ts`, `tools/check-assets.mjs` run in `npm run build`.

**Interfaces — Produces:** `assetUrl(kind: "models" | "audio" | "cards", file: string): string` (respects `import.meta.env.BASE_URL`). Local layout is `public/assets/{models,audio,cards}/<original-file-name>`, with cards converted to `.webp`.

- [ ] Step 1: Failing test: `assetUrl("models","x.glb")` → `"/assets/models/x.glb"` with BASE_URL `/`, and `"./assets/models/x.glb"` with `./`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: `optimize-assets.mjs` extracts every URL from `generated.ts` (same regex as the perf probe) and downloads it to `.asset-cache/`. If a clip-only GLB (`-idle/-walk/-run/-attack/-death/-reload/-aim/-rise` files) carries meshes, they get stripped (keep nodes + animations). Rigged sculpts get `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 1024 --simplify-ratio <r>`, with r chosen so pawns ≤ 3k and other figures ≤ 5k triangles. Animations get resampled. PNG cards → 1024-wide webp. The script writes to `public/assets/`.
- [ ] Step 4: `check-assets.mjs` fails the build if any `https://r2-pub.rork.com` string remains in `src/`, any rigged GLB exceeds 5,000 triangles, or `public/assets` exceeds 25 MB.
- [ ] Step 5: Tests pass. `npm run build` is green. The game loads with the network tab showing only same-origin assets. Record before/after MB in the commit body.
- [ ] Step 6: Commit `perf(assets): self-host and compress models, clips, cards`

### Task 3: Four draws per figure

**Files:** Create `src/scene/merge.ts`. Modify `src/scene/weapons.ts`, `src/scene/pieces.ts`, `src/scene/rankBadges.ts`. Test: `src/scene/merge.test.ts`, e2e `tests/e2e/perf.spec.ts`.

**Interfaces — Produces:** `mergeStaticParts(root: THREE.Object3D): number` merges static (non-skinned) meshes that share a parent and a material into one mesh per (parent, material). It returns the number of meshes removed. Materials are shared per (template, faction), never cloned per piece, except the body material, which keeps per-piece uniforms.

- [ ] Step 1: Failing unit test: a group with 5 boxes under one parent sharing one material and 1 box with another material → after merge, 2 meshes, the same world-space bounding box, return value 4.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement it with `BufferGeometryUtils.mergeGeometries` (bake each child's matrix relative to the parent). Call it on each arms loadout once, at template build. Rank crests become one draw per faction (instanced or a shared atlas sprite).
- [ ] Step 4: Add `window.__scene.breakdown()` (dev/test builds only, behind `import.meta.env.DEV || import.meta.env.MODE === "test"`), returning `{ calls, triangles, perGroup }`. Perf spec: in attract mode on Low, every `piece_*` group averages ≤ 4 drawables and total calls ≤ 220.
- [ ] Step 5: Pass. Commit `perf(pieces): merge arms and share materials, four draws per figure`

### Task 4: Board in a handful of draws

**Files:** Modify `src/scene/board.ts`. Test: e2e `tests/e2e/perf.spec.ts` (board group ≤ 10 drawables).

- [ ] Step 1: Add the failing perf assertion `perGroup.board <= 10`.
- [ ] Step 2: Run → FAIL (72 today).
- [ ] Step 3: Tiles become one merged mesh with per-vertex colour (light/dark per theme via `applyArena`). Engraved labels go into one merged mesh. The highlight pool becomes one `InstancedMesh` per highlight shape with per-instance colour/opacity. The existing `setHighlight`/`setShroud` signatures stay unchanged.
- [ ] Step 4: Pass, plus the existing `armoury.test.ts`/`premove.test.ts` still pass. Visual check: screenshot before/after at the same camera.
- [ ] Step 5: Commit `perf(board): batch tiles, labels and highlights`

### Task 5: Idle animation off the critical path

**Files:** Create `src/scene/idleScheduler.ts`. Modify `PieceView.update` callers in `sceneEngine.ts:frame()`. Test: `src/scene/idleScheduler.test.ts`.

**Interfaces — Produces (as built):** `class IdleScheduler { constructor(buckets: number); setBuckets(n: number): void; beginFrame(): void; step(figure: object, delta: number, busy: boolean): number | null; }`. A piece that is moving, striking, dying or selected always updates. Idle-only pieces update every `buckets`-th frame, with the delta accumulated.

- [ ] Step 1: Failing tests: with 2 buckets, ids 0 and 1 alternate across frames 0..3. The accumulated delta handed back equals the sum of the skipped frames.
- [ ] Step 2: Run → FAIL. Step 3: implement. `buckets` = 1 on ultra/high, 2 on medium/low and in XR.
- [ ] Step 4: Pass. The perf probe shows p95 ≤ 20 ms on this laptop (auto preset, attract duel).
- [ ] Step 5: Commit `perf(pieces): stagger idle mixers across frames`

## Phase B — XR core

### Task 6: super-three and the XR session

**Files:** Modify `package.json` (`"three": "npm:super-three@0.185.0"`, plus `overrides`), `src/scene/sceneEngine.ts` (renderer created with `multiviewStereo: true`, `renderer.xr.enabled = true`). Create `src/xr/session.ts`. Test: `src/xr/session.test.ts` (fake `navigator.xr`), e2e `tests/e2e/xr-enter.spec.ts` (IWER Quest 3).

**Interfaces — Produces:**
`isTableXrSupported(): Promise<boolean>`;
`startTableSession(renderer: THREE.WebGLRenderer): Promise<TableSession>`, where `interface TableSession { session: XRSession; hasHitTest: boolean; hasHands: boolean; onVisibility(cb: (state: XRVisibilityState) => void): () => void; onEnd(cb: (byUser: boolean) => void): () => void; end(): Promise<void>; }`.
It requests `immersive-ar` with required `["local-floor"]` and optional `["hand-tracking","hit-test","anchors","plane-detection"]`. It calls `updateTargetFrameRate(72)` when 72 is in `supportedFrameRates`, plus `renderer.xr.setFoveation(1)` and `setFramebufferScaleFactor(1)`.

- [ ] Step 1: Failing unit tests: features requested exactly as above. 72 Hz is chosen from `[60,72,90,120]`, and none is set if `supportedFrameRates` is missing. `onVisibility` fires `"visible-blurred"`.
- [ ] Step 2: Run → FAIL. Step 3: implement. Re-run all existing tests with super-three (the swap must be invisible to the 2D game).
- [ ] Step 4: e2e: IWER injected in dev with `?emulate=quest3`. Click "Enter mixed reality" → `session.mode === "immersive-ar"`. Pass.
- [ ] Step 5: Commit `feat(xr): immersive-ar session on super-three with multiview and foveation`

### Task 7: SceneEngine table mode

**Files:** Modify `src/scene/sceneEngine.ts`. Create `src/xr/tableRig.ts`. Test: `src/xr/tableRig.test.ts`, e2e `tests/e2e/perf.spec.ts` (XR case).

**Interfaces — Produces:**
`TABLE_SCALE = 0.049` (tile 1.02 m → 5.0 cm);
`class TableRig { root: THREE.Group; setPose(position: THREE.Vector3, yaw: number): void; setScale(multiplier: number): void /* clamped 0.6–1.6 */; showPlinth(visible: boolean): void; }`;
`SceneEngine.enterTable(rig: TableRig): void`, `SceneEngine.exitTable(): void`, `SceneEngine.isTable: boolean`, `SceneEngine.tick(delta: number): void` (frame body without rendering).
In table mode: board/pieces/effects/alarm/promotion groups are re-parented under `rig.root`. Hall/battlefield/jungle/dressing/landmarks are detached and not updated. `scene.background = null`, `scene.fog = null`, shadows off, postfx bypassed. The render loop moves to `renderer.setAnimationLoop`. `moveCameraTo/flyTo/orbitBy/lensPunch/swingCamera/playIntro` return immediately. Point-sprite sizes are multiplied by `TABLE_SCALE`. Lights: one hemisphere + one directional, owned by the rig.

- [ ] Step 1: Failing tests: `squareToWorld("a1")` under the rig maps to within 1 mm of the expected table-local point. `setScale(3)` clamps to 1.6.
- [ ] Step 2: Run → FAIL. Step 3: implement. `exitTable` restores the 2D state exactly (camera, groups, postfx).
- [ ] Step 4: e2e (IWER): after entering, `__scene.breakdown()` → calls ≤ 150, no `castle_hall`/`battlefield`/`jungle` drawables, no console errors over 20 s of an AI-vs-AI duel in table mode.
- [ ] Step 5: Commit `feat(xr): table mode for the scene engine`

### Task 8: Placing the board on the real table

**Files:** Create `src/xr/placement.ts`. Test: `src/xr/placement.test.ts`, e2e `tests/e2e/xr-enter.spec.ts`.

**Interfaces — Produces:**
`fallbackBoardPose(head: { position: THREE.Vector3; yaw: number }): { position: THREE.Vector3; yaw: number }` → 0.45 m ahead horizontally, 0.40 m below the eyes, facing the user (white's side nearest);
`class Placement { constructor(session: TableSession, rig: TableRig); update(frame: XRFrame, refSpace: XRReferenceSpace): void; confirm(): void; replace(): void; readonly state: "searching" | "aiming" | "placed" | "fallback"; }`.
A hit reticle shows only on upward-facing surfaces (normal·up > 0.9). A pinch confirms and an anchor is created when available. With no hit within 4 s → `fallback` with the plinth shown.

- [ ] Step 1: Failing tests: `fallbackBoardPose` for a head at (0,1.2,0) facing −Z → (0, 0.8, −0.45). No hits for 4 s → state `fallback`. A vertical hit is ignored.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: e2e: IWER room with a table → the reticle appears and a pinch places it. IWER without hit-test → fallback within 4 s.
- [ ] Step 5: Commit `feat(xr): place the board on a real table, fall back to seat height`

### Task 9: Hands move the pieces

**Files:** Create `src/xr/hands.ts`, `src/xr/grab.ts`. Modify `src/scene/sceneEngine.ts` (public drag/tap API on top of the existing `select`/`commitMove`/premove logic). Test: `src/xr/hands.test.ts`, `src/xr/grab.test.ts`, e2e `tests/e2e/grab-move.spec.ts`.

**Interfaces — Produces:**
`class PinchTracker { update(thumbTip: THREE.Vector3 | null, indexTip: THREE.Vector3 | null, now: number): "start" | "hold" | "end" | "lost" | null; readonly point: THREE.Vector3; }`: starts below 1.5 cm, ends above 2.5 cm, `lost` after 150 ms with no joints while pinching.
SceneEngine API (as built): `beginOrder(square): boolean`, `releaseOrder(square | null): void`, `cancelOrder(): void`, `tapSquare(square | null): void`, `pickWithRay(ray): { square, piece }`, `squareAtWorld(point): SquareId | null`, `figureNear(point, radiusMeters): SquareId | null`, `squareCenterWorld(square, out)`, `isLegalTarget(square)`, `orderedSquare`.
`class GrabController { constructor(engine: SceneEngine, rig: TableRig); update(frame: XRFrame, refSpace: XRReferenceSpace): void; }`: a direct grab needs the pinch point within 3 cm of a figure on the mover's side. A ray `select` maps to `tapSquare`. The carried figure is lifted 2 cm and follows the pinch, with the square under it lit.

- [ ] Step 1: Failing tests:
  - PinchTracker hysteresis (1.4 cm → start, 2.0 cm → hold, 2.6 cm → end); joints null for 160 ms while holding → `lost`.
  - GrabController with a fake engine: `lost` mid-carry → `cancelDrag` called, `dropDrag` not called.
  - Drop on an illegal square → the engine's reject path runs and the figure returns.
  - Drop on an own piece → that square becomes selected.
  - Drop off-board (`squareAtWorld` null) → `cancelDrag`.
  - Pinch during the AI's turn on an own piece → premove queued (premoves on).
  - The palm-facing system pinch (`XRHand` palm normal toward the head) → ignored.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: e2e (IWER hands): pinch-grab e2 → release on e4 → the move is in the ledger and the AI replies within 5 s. The same with the IWER controller profile (ray + trigger).
- [ ] Step 5: Commit `feat(xr): pick up, carry and set down figures with bare hands`

## Phase C — The game in your room

### Task 10: Hand-friendly panels

**Files:** Create `src/xr/ui/panel.ts`, `src/xr/ui/menus.ts`. Test: `src/xr/ui/panel.test.ts`, e2e `tests/e2e/menus.spec.ts`.

**Interfaces — Produces:**
`class CanvasPanel { constructor(opts: { widthM: number; heightM: number; pxPerM: number; draw: (ctx: CanvasRenderingContext2D, state: PanelState) => void }); addButton(id: string, rectPx: [number, number, number, number], onPress: () => void): void; pokeUpdate(indexTipWorld: THREE.Vector3 | null): void; rayPress(ray: THREE.Ray): boolean; mesh: THREE.Mesh; }`.
A press fires when the index tip crosses 7 mm behind the surface. Each button gets hover + pressed visuals and `audio.blip("press")`. Panels: **Start** (colour, strength, battleground, armies, Play), **Side** (Undo, Resign, Battleground, Sound, Re-place board, Exit), **HUD** strip behind the far rank (turn, check, thinking, captured tally, clocks), **Game over** (result line, Rematch, Change setup). Panels sit beside the board at 42–46 cm reach and face the user (no roll). The medieval palette and fonts come from `src/ui/medieval.css` tokens.

- [ ] Step 1: Failing tests: a poke at 5 mm depth → no press; at 8 mm → one press; staying in → no repeat until the tip backs out 4 mm. A ray hit on a button rect → press. Buttons < 22 mm or closer than 12 mm → constructor throws in dev.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: e2e: poke Play → a game starts. Poke Undo → the last ply pair is undone.
- [ ] Step 5: Commit `feat(xr): poke-and-pinch panels for setup, play and game over`

### Task 11: Pause, resume and never losing a game

**Files:** Create `src/xr/lifecycle.ts`. Modify `src/core/gameController.ts` (add `exportPgn(): string` and `restore(pgn: string, options: StartOptions): void` if absent). Test: `src/xr/lifecycle.test.ts`, `src/core/persist.test.ts`, e2e `tests/e2e/lifecycle.spec.ts`.

**Interfaces — Produces:** `class XrLifecycle { constructor(deps: { controller: GameController; engine: SceneEngine; session: TableSession; audio: AudioManager }); }`. `visible-blurred`/`hidden` → `controller.setPaused(true)`, tweens frozen, audio ducked to 0. `visible` → resume. A session end not caused by Exit → the 2D page shows "Resume in mixed reality". The game is saved to `localStorage["mr-chess:game"]` after every ply.

- [ ] Step 1: Failing tests: a blur during the AI's animation → the clock stops advancing and the animation timeline doesn't advance. Visible → both continue. Round-trip `exportPgn` → `restore` gives the same FEN and side to move.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: e2e: IWER visibility `visible-blurred` for 5 s → the clock difference is < 100 ms. Reload → the resume card restores the position.
- [ ] Step 5: Commit `feat(xr): clean pause and resume, games survive exits`

### Task 12: The room becomes the battleground

**Files:** Create `src/xr/roomTheme.ts`. Test: `src/xr/roomTheme.test.ts`, e2e perf case per theme.

**Interfaces — Produces:**
`interface RoomTheme { dim: number; haze: { color: number; strength: number }; weather: "none" | "pollen" | "sand" | "snow" | "rain" | "embers"; tableLight: { color: number; intensity: number }; diorama: ("canopy" | "palm" | "conifer" | "deadwood" | "boulder" | "dune" | "drift" | "pyramid" | "obelisk" | "stone")[] }`;
`ROOM_THEMES: Record<ArenaTheme, RoomTheme>`;
`class RoomStyler { constructor(scene: THREE.Scene, rig: TableRig); setTheme(theme: ArenaTheme, fadeSeconds?: number): void; update(delta: number, head: THREE.Vector3): void; }`.
- The dimmer is a back-faced sphere (r = 3 m) around the head: black with alpha `dim`, `depthWrite:false`, `renderOrder:-10`.
- Weather is one `InstancedMesh` of ≤ 600 streaks in a 2.5 m cylinder around the user, using the `dressing.ts` angle/speed/length table. It never spawns within 0.3 m of the head.
- The table light is an additive radial decal at 1.4× board size.
- The diorama is ≤ 10 instanced draws on a ring 4–14 cm outside the board edge.
- Theme changes crossfade over 1.5 s.

- [ ] Step 1: Failing tests: every theme has `dim ≤ 0.6`. Spawn positions are never within 0.3 m of the head. `dusk.dim > dawn.dim`.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: perf e2e: every theme in table mode → calls ≤ 150, frame CPU ≤ 8 ms.
- [ ] Step 5: Commit `feat(xr): each battleground restyles the real room`

### Task 13 (stretch, only if Task 12 lands by Sun noon): Wall portal

Plane detection → the largest vertical plane in front gets a 1.2 × 0.8 m portal. Through it you see the battleground's sky and its landmark (stencil-masked). It's hidden when there are no planes. Needs a headset to tune. Commit `feat(xr): a portal on your wall looks out on the battleground`.

### Task 14: Cinematics without moving your head

**Files:** Modify `src/scene/sceneEngine.ts`, `src/scene/effects.ts`. Test: `src/scene/tableCinematics.test.ts`.

In table mode, the camera punch, shake, DOF and fly-ins become: hitstop (existing), a rig wobble ≤ 2 mm with 0.25 s decay, the existing flashes/pillars/dissolves at table scale, and spatial audio from the figure's position (`PannerNode`).

- [ ] Step 1: Failing test: in table mode, a capture sequence never writes `camera.position`/`quaternion` (spy). Rig wobble amplitude ≤ 0.002 m.
- [ ] Step 2: Run → FAIL. Step 3: implement. Step 4: pass. A queen capture in the emulator looks right in a screenshot.
- [ ] Step 5: Commit `feat(xr): in-world capture cinematics with no camera motion`

## Phase D — Ship

### Task 15: Launch page, name, offline

**Files:** Create `src/brand.ts`, `src/ui/Launch.tsx`. Modify `src/App.tsx`, `index.html`, `vite.config.ts` (`vite-plugin-pwa` precache of `public/assets/**`). Test: e2e `tests/e2e/launch.spec.ts`.

Dark background (no brighter than `#DADADA` anywhere, never `#FFFFFF`), primary buttons ≥ 60 px. **Enter mixed reality** shows only when `isTableXrSupported()`, **Play on this screen** opens the existing 2D game, and a resume card shows when a saved game exists. The first visit precaches all assets, so a second launch works offline.

- [ ] Steps: failing e2e (desktop: no MR button, 2D button works; IWER: MR button present) → implement → pass → commit `feat(ui): launch page and offline install`
- [ ] Offline e2e `tests/e2e/offline.mjs`: load once online and wait for the service worker to report the precache complete. Then `context.setOffline(true)`, reload, start a game vs Squire, play e2-e4 and get a reply, then enter MR in IWER and do the same. Zero failed requests except the optional online-play endpoints. Precache budget ≤ 30 MB, so a first launch over hotel Wi-Fi stays reasonable. Armies the player never picks may stream in later and are cached when first used.

### Task 16: Rust server and hosting on ioflood

**Files:** Create `server/Cargo.toml`, `server/src/main.rs`, `server/Dockerfile`, `deploy/` scripts (pattern: `../../2026-11-meta-vr-interview-rounds/research/08-hosting-claude-rust.md` §1). Test: `server/tests/static.rs`.

axum 0.8 + tower-http: serve `dist/`. `Cache-Control: public, max-age=31536000, immutable` for `/assets/` and hashed files, `no-cache` for `index.html` and `sw.js`. Precompressed brotli. `/up` → 200. Coolify compose service with Traefik + Let's Encrypt (HTTPS is required for WebXR). **The domain needs the owner's confirmation before the first deploy.**

- [ ] Steps: failing cargo tests (headers per path, `/up`) → implement → pass → deploy → `curl -I https://<domain>/` 200 with a valid certificate → commit `feat(server): rust static host with health check`

### Task 17: Quest APK

Bubblewrap TWA (`horizonOSAppMode: immersive`), following `../../2026-11-meta-vr-start-developer-competition/shadow-locks/scripts/twa-*.sh` and its `twa/competition` config. Add `assetlinks.json` to `public/.well-known/`. Upload to the "Competition" release channel (needs the owner's dashboard login). Commit `build(twa): quest app package`.

### Task 18: Submission

Record the real-device demo video (< 3 min, no AI-generated footage). The first 10 s show figures fighting on a real table in a dimmed, snowing room. Write the Devpost text (Adapted / Gaming): the hosted link at the top, testing steps, platform features used (WebXR hands, passthrough, hit-test, anchors, multiview, foveation). Store art from `public/banner.jpg` and new captures. README rewritten for the MR edition.

## Phase E — Social (only after Phase D is shipped)

### Task 19: Online two-player with room codes

**Files:** `server/src/relay.rs`, `src/net/remoteSeat.ts`, `src/xr/ui/lobby.ts`, `src/xr/ghost.ts`. Tests: `server/tests/relay.rs`, `src/net/remoteSeat.test.ts`.

The relay holds rooms keyed by a 4-letter code (2 seats, 10 min idle expiry). Messages: `{t:"move", ply, from, to, promo?}`, `{t:"sync", pgn}`, `{t:"pose", head, lh, rh}` at 10 Hz. `RemoteSeat` applies moves in ply order, asks for `sync` on a gap and re-sends on reconnect. The opponent's head and hands are drawn as faint ghosts across the board.

- [ ] Steps: failing tests (out-of-order ply → sync requested; third joiner rejected) → implement → pass → commit `feat(net): online two-player through room codes`
