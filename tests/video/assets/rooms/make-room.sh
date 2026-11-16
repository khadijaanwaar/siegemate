#!/usr/bin/env bash
# Makes anniversary_lounge-film.jpg from Poly Haven's tone-mapped JPG (see README.md here).
#   tests/video/assets/rooms/make-room.sh /path/to/anniversary_lounge.jpg
# Needs python3 with OpenCV (cv2) and numpy, and ffmpeg.
# 1. clean-table.py clears the coffee table: the white sculpture on the glass, the magazines under it and the
#    papers on the lower shelf are inpainted away from their surroundings (oak, rug through the glass).
# 2. A grade that pulls the tone map's yellow back toward warm white walls (yellows, whites and neutrals lose
#    yellow), a touch of contrast.
# 3. Lanczos down to 7168x3584 and JPEG 4:4:4 at -q:v 4, to stay under 3 MB in git.
set -euo pipefail
src=${1:?usage: make-room.sh anniversary_lounge.jpg}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
out=$here/anniversary_lounge-film.jpg
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT
python3 -I "$here/clean-table.py" "$src" "$tmp/clean.png"
ffmpeg -loglevel error -y -i "$tmp/clean.png" -vf "format=rgb24,
selectivecolor=correction_method=relative:yellows=0 0 -0.45 0:whites=0 0 -0.25 0:neutrals=0 0 -0.08 0,
colorbalance=rm=-0.02:bm=0.02:bh=0.02,eq=saturation=0.88:contrast=1.05:gamma=0.97,
scale=7168:3584:flags=lanczos,format=yuvj444p" -frames:v 1 -q:v 4 "$out"
ls -la "$out"
