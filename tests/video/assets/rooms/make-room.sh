#!/usr/bin/env bash
# Makes anniversary_lounge-film.jpg from Poly Haven's tone-mapped JPG (see README.md here).
#   tests/video/assets/rooms/make-room.sh /path/to/anniversary_lounge.jpg
# 1. Two feathered blurs over the readable magazines in and under the coffee table (x:y:w:h in the
#    8192x4096 source, each padded by 36 px and merged through a mask blurred at its edge):
#    6280:2815:470:315 and 6030:3235:780:185.
# 2. A grade that pulls the tone map's yellow back toward warm white walls (yellows, whites and
#    neutrals lose yellow), a touch of contrast.
# 3. Lanczos down to 7168x3584 and JPEG 4:4:4 at -q:v 4, to stay under 3 MB in git.
set -euo pipefail
src=${1:?usage: make-room.sh anniversary_lounge.jpg}
out=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/anniversary_lounge-film.jpg
ffmpeg -loglevel error -y -i "$src" -filter_complex "
[0]format=rgb24,split=3[base][s1][s2];
[s1]crop=542:387:6244:2779,boxblur=22:3[b1];
color=c=white:s=470x315,format=gray,pad=542:387:36:36:black,boxblur=18:2[m1];[b1][m1]alphamerge[f1];
[s2]crop=852:257:5994:3199,boxblur=22:3[b2];
color=c=white:s=780x185,format=gray,pad=852:257:36:36:black,boxblur=18:2[m2];[b2][m2]alphamerge[f2];
[base][f1]overlay=6244:2779[o1];[o1][f2]overlay=5994:3199,
selectivecolor=correction_method=relative:yellows=0 0 -0.45 0:whites=0 0 -0.25 0:neutrals=0 0 -0.08 0,
colorbalance=rm=-0.02:bm=0.02:bh=0.02,eq=saturation=0.88:contrast=1.05:gamma=0.97,
scale=7168:3584:flags=lanczos,format=yuvj444p" -frames:v 1 -q:v 4 "$out"
ls -la "$out"
