# Demo film renders

Emulator footage for the competition film: the built game (test mode) in headless Chrome with Meta's WebXR emulator
(IWER, Quest 3), rendered frame by frame on a virtual clock on this machine's GPU. Every frame carries the corner label
"Emulator capture · simulated room": the room is a photograph (`assets/rooms/`), not passthrough.

```sh
scripts/video.sh --shots b --draft            # 960x540, 30 fps (the game still runs at 60 Hz)
scripts/video.sh --shots a,b,c,e --final      # 1920x1080, 60 fps, x264 CRF 16
scripts/video.sh --shots b --final --size 2560x1440 --out 1920x1080   # drawn at 1440p, Lanczos to 1080p
scripts/video.sh --list                       # shots, and what each one still waits on
scripts/video.sh --shots c --no-build         # reuse the last build (film-out/.build)
```

Output in `film-out/<W>x<H>-<fps>/` (gitignored): `<shot>.mp4`, `<shot>.json`, `<shot>-still-1..3.png`,
`<shot>-contact.png`, and with two or more shots `rough.mp4` + `rough.json` (hard cuts in the order asked for).

## The event log (`<shot>.json`)

`events` lists, with the shot time `t` (seconds from the clip's first frame) and the simulated frame: every move
(`san`, `by`, `from`, `to`, `capture`, `promotion`, `check`, `mate`, `fen`), changes of the mixed reality state,
placement (`searching`, `aiming`, `placed`), coach step, panels on show, battleground (`theme`), thinking and busy,
each hand's pinch (`right`: `idle` / `ordering`), and the beats the shot marks itself (`pinch`, `release`, `poke`,
`battleground`, `checkmate`, ...). `rough.json` has the same events at their time in the rough cut, for timing the
narration. `timings` has the render cost; `engine` the computer's replies.

## How it works

- **Clock** (`lib/clock.ts`): the page boots on real time; then `performance.now`, `Date`, `requestAnimationFrame`,
  `setTimeout` and `setInterval` stop and move only when a frame is stepped (1/60 s). IWER drives the XR frame loop
  from them, so a step is one game frame however long the GPU takes. Before each step the recorder waits for async
  work in flight (fetches, decodes, the engine's reply), so the same thing happens on the same frame every run.
  `Math.random` is seeded.
- **Room** (`lib/page.ts` `installRoom`): IWER's synthetic environment hook, filled with a module of the film's own:
  it draws the equirectangular photograph from the headset's pose and lens behind the game, and answers hit tests on a
  level table top matched to the photographed coffee table (`lib/stage.ts` `LOUNGE`), so the game's own reticle finds
  the table and the board settles on it. A panorama has no parallax: shots turn the head and zoom the lens, and keep
  the eye at the seat.
- **Alpha**: the game's renderer asks for an opaque canvas; the film gives every WebGL context an alpha channel (as an
  XR layer has on a headset), so the room shows through where the game clears.
- **Hands**: IWER's emulated hands, posed from eased tracks (`lib/hands.ts`); the game sees real pinches. They are
  drawn by the film from the session's joint poses as a see-through smoky hand with a thin warm rim, fading out past
  the wrist, in the spirit of the Quest system hand.
- **Computer replies**: scripted per shot (`replies`, UCI) through a stand-in for the search worker; the real
  (random on Squire) engine answers once the script runs out, with a warning in the sidecar.
- **Undrawn setup**: a shot's `setup` steps the game with draw calls skipped (enter, place the board, play an opening
  through the game's own move path); `play` records.
- **Frames** go from the page as PNG (final) or JPEG (draft) straight into one ffmpeg encode (BT.709, 4:2:0), no frame
  files on disk.
- **GPU lock**: `render.ts` is one process per shot; it takes `tools/gpu-lock.mjs`'s lock, touches it every 30 s (it
  counts as abandoned after five minutes untouched) and lets it go when the shot ends, so other GPU tests run between
  shots. A lost WebGL context fails the shot.

## Writing a shot

One file per shot in `shots/`, named `<letter>-<name>.ts`; `b-first-move.ts` is the model. `setup` gets the game
where the shot starts (`game.enter()`, `game.place(view)`, `game.play("e2e4")`), `firstView` frames the first frame,
`play` records: `camera.move(view, ms)`, `right.glide(point, ms)`, `right.pinch()`, `right.arc(to, ms)`,
`right.open()`, `left.poke(buttonId)`, `wait(ms)`, `until(s)`, `waitFor(pagePredicate, arg, { maxMs, label })`,
`mark(beat)`. Points are world metres; `game.square("e4")` and `game.button("menu")` give them. A shot that waits on
another lane's work says so in `needs`.

## Credits

The approach, the camera track (`lib/camera.ts`), the room shader and parts of the in-page helpers are adapted from
Shadow Locks' film pipeline (`tests/video`), Copyright (c) 2026 Hamid Siddiqui (github.com/inventionsbyhamid),
reused within the same author family. The room photograph is CC0 (`assets/rooms/README.md`).

The emulator cannot show multiview, foveation, the real frame rate, real hand jitter or passthrough.
