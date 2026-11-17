# Siegemate: what is left for Khadija

Deadline: **Wed Nov 18 2026, 12:00 PT** (20:00 UTC, **Thu Nov 19, 01:30 IST**). Judges play what is live then.
Build freeze: 08:00 PT (21:30 IST Nov 18). Nothing in the game has changed since the last deploy, so no deploy is
planned before the freeze.

## Where things stand (checked Nov 17, 11:50 PT)

- Live: https://siegemate.pages.dev serves build `4350869` (Cloudflare Pages deployment fb8dfba6). It returns 200,
  the page is `no-cache`, and the service worker, manifest and og image all load. No file under `src/`, `public/`,
  `index.html` or the build config has changed on main since then.
- Unit tests on main: 261 passed. The last full e2e run (offline, update, replay, xr-play, xr-controllers, xr-share,
  xr-perf, perf-check) was green on Nov 16 on the same app code.
- Still emulator-only: nothing has been run on a Quest.
- Film: emulator footage with Fish Audio narration (voice "Avery"). The final 1080p60 cut is rendered:
  `/Users/inventionsbyhamid/RailsProjects/hackathons/chess/siegemate-film/siegemate-1080p60.mp4`
  (1:41, 1920x1080 at 60 fps, H.264 with AAC 48 kHz stereo, 155 MB, -14 LUFS integrated). It is outside the repo; the
  worktree's `film-out/` copy is gitignored.

## Only you can do these

1. **Upload the film** to YouTube (or Vimeo) as **Public**. The rules ask for under 3 minutes; it runs about 1 minute 40.
   Suggested title and description are below. Watch it once with sound first: format and loudness were measured
   and a frame per line was checked, but no one has listened to the whole film.
2. **Paste the video URL** into Devpost and into `devpost.md` ("Try it").
3. **Source code field:** make the repository public and paste its URL, or leave the field empty. The repository has
   no remote yet: every commit is local only, so publishing it means creating one and pushing `main` first.
4. **Fill the Devpost form** from `docs/submission/devpost.md`. The plain-text boxes are in
   `docs/submission/plain/`; the gallery is `docs/submission/gallery/01..08` with captions in `CAPTIONS.md`.
   Pick Track **Gaming** and Division **Adapted / Significantly Updated**.
5. **Check on the official rules page** the points marked "Unconfirmed / owner to check" at the end of
   `devpost.md`. These matter most:
   - The rules warn against AI-generated video. The picture is real emulator capture, not generated, but the
     narrator is a synthetic (TTS) voice. The description below says so.
   - The Meta VR Start membership and the Devpost registration.
6. **Submit before 12:00 PT.** Devpost usually allows edits until the deadline, but submit early rather than rely on it.

If you get a Quest before the deadline, run the device checklist in
`docs/superpowers/plans/2026-11-16-quest-readiness.md` ("Not changed blind").

## Video title and description (suggested)

Title:

```
Siegemate: living chess armies on your real table (Meta Quest mixed reality, WebXR)
```

Description:

```
Siegemate is mixed reality chess in the Meta Quest browser. Pinch a sculpted soldier, carry it to a glowing square, and watch it march and fight on your own table. Change the battleground and your room follows. Plays offline after the first visit; share any battle as a link that replays it.

Play: https://siegemate.pages.dev (open in the Meta Quest browser)

About this video: emulator capture. The game runs in Chrome with Meta's WebXR emulator (IWER, Quest 3 profile), drawn frame by frame. The room is a photograph ("Anniversary Lounge" by Greg Zaal, Poly Haven, CC0), shown where passthrough would be, and the hands are drawn from the emulator's hand joints. Narration is a synthetic voice (Fish Audio). No part of the picture is AI-generated.

Made by Khadija Anwaar for the Meta VR Start Developer Competition 2026.
```

## If something breaks on the live site

The current deployment is the known-good build. To roll back after a bad deploy, redeploy `4350869` with the steps in
`docs/deploy.md`, or promote deployment fb8dfba6 in the Cloudflare Pages dashboard (project `siegemate`).
