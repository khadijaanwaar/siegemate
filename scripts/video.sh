#!/usr/bin/env bash
# Renders the demo film's shots (tests/video) on this machine: the built game in headless Chrome
# with Meta's WebXR emulator (IWER), frame by frame on a virtual clock, a photographed room behind
# the passthrough layer, labelled "Emulator capture · simulated room".
#
# Usage: scripts/video.sh [--shots a,b,c | --shots all] [--draft | --final] [--size WxH] [--out WxH]
#                         [--fps n] [--hfov deg] [--crf n] [--no-build] [--no-rough] [--headed] [--list]
#   --shots       shots by letter or name (tests/video/shots/<letter>-<name>.ts), in order (default: all)
#   --draft       960x540, 30 fps (the game still runs at 60 Hz; every other frame kept), JPEG frames
#   --final       1920x1080, 60 fps, PNG frames, x264 CRF 16
#   --size WxH    render size; with --out WxH the frames are drawn at --size and scaled down (Lanczos)
#                 in the one encode, e.g. --final --size 2560x1440 --out 1920x1080
#   --no-build    reuse film-out/.build (the last build) instead of building the game again
#   --no-rough    skip the rough cut of the shots
#   --list        print the shots and what each one waits on
#
# Output in film-out/<W>x<H>-<fps>/ (gitignored): <shot>.mp4, <shot>.json (events with times, for
# timing the narration, and render timings), <shot>-still-1..3.png, <shot>-contact.png, and
# rough.mp4 + rough.json (the shots cut together, events at their time in the cut).
#
# The GPU: one GPU test at a time on this laptop (tools/gpu-lock.mjs). Each shot is its own process
# that takes the lock while it draws and lets it go when it is done, so other lanes' e2e tests run
# between shots.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$ROOT"

SHOTS=all
QUALITY=draft
BUILD=1
ROUGH=1
EXTRA=()
while [ $# -gt 0 ]; do
  case $1 in
    --shots) SHOTS=$2; shift 2 ;;
    --draft) QUALITY=draft; shift ;;
    --final) QUALITY=final; shift ;;
    --size) EXTRA+=("SIZE=$2"); shift 2 ;;
    --out) EXTRA+=("OUT_SIZE=$2"); shift 2 ;;
    --fps) EXTRA+=("FPS=$2"); shift 2 ;;
    --hfov) EXTRA+=("HFOV=$2"); shift 2 ;;
    --crf) EXTRA+=("CRF=$2"); shift 2 ;;
    --no-build) BUILD=0; shift ;;
    --no-rough) ROUGH=0; shift ;;
    --headed) EXTRA+=("HEADED=1"); shift ;;
    --list)
      for s in $(node --no-warnings tests/video/shots/index.ts all); do
        node --no-warnings -e "import('./tests/video/shots/$s.ts').then((m) => console.log('$s' + (m.default.needs ? '  (waits on: ' + m.default.needs + ')' : '') + '\n    ' + m.default.description))"
      done
      exit 0 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
done
for kv in ${EXTRA[@]+"${EXTRA[@]}"}; do
  [[ $kv =~ ^[A-Z_]+=[A-Za-z0-9_.x-]*$ ]] || { echo "bad value in $kv" >&2; exit 2; }
done
command -v ffmpeg >/dev/null || { echo "ffmpeg is needed (brew install ffmpeg)" >&2; exit 3; }

NAMES=$(node --no-warnings tests/video/shots/index.ts "$SHOTS")
echo "[film] shots: $NAMES ($QUALITY)"

if [ "$BUILD" = 1 ] || [ ! -f film-out/.build/index.html ]; then
  echo "[film] building the game (test mode: the emulator and the test hooks are in)"
  npx vite build --mode test --outDir film-out/.build --emptyOutDir >film-out/.build.log 2>&1 \
    || { tail -20 film-out/.build.log >&2; exit 1; }
fi

PORT=$((4900 + RANDOM % 90))
npx vite preview --outDir film-out/.build --port "$PORT" --strictPort >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  curl -sf "http://localhost:$PORT/" >/dev/null && break
  sleep 0.5
done

export QUALITY BASE_URL="http://localhost:$PORT"
for kv in ${EXTRA[@]+"${EXTRA[@]}"}; do export "${kv?}"; done

FAILED=()
DONE=()
for shot in $NAMES; do
  if node --no-warnings tests/video/render.ts "$shot"; then
    node --no-warnings tests/video/deliver.ts stills "$shot"
    DONE+=("$shot")
  else
    FAILED+=("$shot")
  fi
done

if [ "$ROUGH" = 1 ] && [ ${#DONE[@]} -gt 1 ]; then
  node --no-warnings tests/video/deliver.ts rough "$(IFS=,; echo "${DONE[*]}")"
fi
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "[film] failed: ${FAILED[*]} (a <shot>-failure.png is next to the clips)" >&2
  exit 1
fi
