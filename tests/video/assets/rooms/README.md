# Photographed room for film shots

An equirectangular photograph drawn behind the game in film renders only (`lib/page.ts` `installRoom`), standing in
for the player's room as passthrough would show it. Every frame that uses it carries the corner label
"Emulator capture · simulated room". Never part of a build: nothing under `tests/` reaches `dist/`.

## anniversary_lounge-film.jpg

- Source: "Anniversary Lounge" by Greg Zaal, Poly Haven, https://polyhaven.com/a/anniversary_lounge
- File used: the 8192x4096 tone-mapped JPG,
  https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Tonemapped%20JPG/anniversary_lounge.jpg
  (4,877,022 bytes, md5 3df39e24797865650d33278341d77847, fetched 2026-11-16)
- Licence: CC0 1.0 Universal (public domain dedication), https://polyhaven.com/license and
  https://creativecommons.org/publicdomain/zero/1.0/ . No attribution is required; it is given anyway.
- Changes (`make-room.sh` here, ffmpeg): the readable magazines in and under the coffee table blurred (feathered), the
  tone map's yellow pulled back toward warm white, a little contrast, Lanczos to 7168x3584, JPEG 4:4:4 at `-q:v 4`
  (2.9 MB).

## Where the table is

The coffee table (glass top, oak frame) sits about 106 degrees right of the photograph's centre column and 22 to 57
degrees below its horizon, near to far. A panorama has no scale and no parallax, so the film matches it by direction:
the seated eye is at 1.10 m, the table top that hit tests find is at 0.50 m, from 0.38 m to 1.2 m ahead
(`lib/stage.ts` `LOUNGE`), and the shots turn the head and zoom the lens but barely move the eye. At `yawDeg` 105.5 the
table is straight ahead (`yawDeg` turns the photograph: its column 0.5 + yaw / 360 is straight ahead, as ffmpeg's
v360).
