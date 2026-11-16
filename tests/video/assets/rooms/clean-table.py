"""Clears the coffee table in Poly Haven's anniversary_lounge.jpg (8192x4096): the white sculpture and the
magazines under the glass and on the lower shelf are filled in from the table's own surroundings (rug seen through
the glass, the oak shelf) by inpainting.

    python3 -I clean-table.py anniversary_lounge.jpg out.png

Regions are x, y, w, h in the source image.
"""
import sys

import cv2
import numpy as np

# Each region is cleared by inpainting (OpenCV Telea) from its own edges, at a quarter of the size and then
# brought back up, so the fill is a soft run of the surrounding wood and rug rather than a smear of streaks, with the
# source's own grain added back from a clean patch of the same material.
REGIONS = [
    # The white sculpture lying on the glass (rug and floor seen through the glass around it).
    (6388, 2675, 275, 175),
    # The magazine stack under the glass, on the oak shelf.
    (6212, 2815, 550, 325),
    # The papers on the lower shelf at the front.
    (6028, 3235, 815, 190),
]


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None or img.shape[:2] != (4096, 8192):
        raise SystemExit(f"{src}: expected the 8192x4096 tone-mapped JPG")
    x0, y0, x1, y1 = 5900, 2550, 7000, 3500
    roi = img[y0:y1, x0:x1].copy()
    mask = np.zeros(roi.shape[:2], np.uint8)
    for x, y, w, h in REGIONS:
        cv2.rectangle(mask, (x - x0, y - y0), (x - x0 + w, y - y0 + h), 255, -1)
    small = cv2.resize(roi, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    small_mask = cv2.resize(mask, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_NEAREST)
    small_mask = cv2.dilate(small_mask, np.ones((5, 5), np.uint8))
    filled = cv2.inpaint(small, small_mask, 9, cv2.INPAINT_TELEA)
    filled = cv2.resize(filled, (roi.shape[1], roi.shape[0]), interpolation=cv2.INTER_CUBIC)
    filled = cv2.GaussianBlur(filled, (0, 0), 3)
    # Fine grain like the photograph's own, so the fill is not smoother than its surroundings.
    rng = np.random.default_rng(7)
    grain = rng.normal(0, 3.0, filled.shape).astype(np.float32)
    filled = np.clip(filled.astype(np.float32) + grain, 0, 255).astype(np.uint8)
    soft = cv2.GaussianBlur(cv2.dilate(mask, np.ones((31, 31), np.uint8)), (0, 0), 10).astype(np.float32)[..., None] / 255
    roi = (roi.astype(np.float32) * (1 - soft) + filled.astype(np.float32) * soft).astype(np.uint8)
    img[y0:y1, x0:x1] = roi
    cv2.imwrite(out, img)


main()
