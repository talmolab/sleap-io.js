#!/usr/bin/env python
"""Regenerate the embedded-frame channel-order fixtures for the JS port.

Writes four tiny ``.pkg.slp`` packages, each holding one embedded 32x32 color
frame and one labeled instance:

=================================  ======  =======  =================
File                               Format  Encoder  ``channel_order``
=================================  ======  =======  =================
``channel_order_bgr_png.pkg.slp``  png     opencv   BGR
``channel_order_rgb_png.pkg.slp``  png     imageio  RGB
``channel_order_bgr_jpg.pkg.slp``  jpg     opencv   BGR
``channel_order_rgb_jpg.pkg.slp``  jpg     imageio  RGB
=================================  ======  =======  =================

The frame has four solid 16x16 quadrants (see ``QUADRANTS``). The OpenCV
encoder writes the RGB frame as if it were BGR, so the stored PNG/JPEG bytes
of the BGR packages decode with red and blue swapped unless the reader honours
``channel_order``. Python sleap-io records that order on the embedded dataset
(``video0/video`` attribute ``channel_order``); the script checks that it did
and that Python reads every package back with the original RGB colors.

Written with sleap-io 0.10.0 (release/0.10 at fe4f91c7b), h5py 3.16.0 and
opencv-python 5.1.0.

Run
---
    python tests/data/slp/gen_channel_order_fixture.py

The packages are saved with ``legacy_format=True`` (the SLP 2.x layout), which
readers below SLP format 3.0 can open.

Re-runnable: it overwrites the four fixtures.
"""

import json
import os

import h5py
import imageio.v3 as iio
import numpy as np

import sleap_io as sio

HERE = os.path.dirname(os.path.abspath(__file__))

SIZE = 32
# (row slice, column slice) -> RGB color, one per 16x16 quadrant.
QUADRANTS = {
    "top_left": ((0, 16), (0, 16), (220, 30, 40)),  # red
    "top_right": ((0, 16), (16, 32), (30, 200, 60)),  # green
    "bottom_left": ((16, 32), (0, 16), (40, 50, 210)),  # blue
    "bottom_right": ((16, 32), (16, 32), (240, 160, 20)),  # orange
}
# JPEG is lossy; quadrant centers must land within this of the true color.
JPEG_TOLERANCE = 12

CASES = [
    ("channel_order_bgr_png.pkg.slp", "png", "opencv", "BGR"),
    ("channel_order_rgb_png.pkg.slp", "png", "imageio", "RGB"),
    ("channel_order_bgr_jpg.pkg.slp", "jpg", "opencv", "BGR"),
    ("channel_order_rgb_jpg.pkg.slp", "jpg", "imageio", "RGB"),
]


def make_frame() -> np.ndarray:
    """Build the 32x32x3 RGB test frame."""
    frame = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    for (r0, r1), (c0, c1), rgb in QUADRANTS.values():
        frame[r0:r1, c0:c1] = rgb
    return frame


def make_labels(image_path: str) -> sio.Labels:
    """One-frame labels over a single-image video."""
    skeleton = sio.Skeleton(["head", "tail"])
    video = sio.Video.from_filename([image_path])
    inst = sio.Instance.from_numpy(
        np.array([[8.0, 8.0], [24.0, 24.0]]), skeleton=skeleton
    )
    lf = sio.LabeledFrame(video=video, frame_idx=0, instances=[inst])
    return sio.Labels(labeled_frames=[lf], videos=[video], skeletons=[skeleton])


def check_colors(img: np.ndarray, tolerance: int, where: str) -> None:
    """Assert each quadrant center has its RGB color."""
    for name, ((r0, r1), (c0, c1), rgb) in QUADRANTS.items():
        px = img[(r0 + r1) // 2, (c0 + c1) // 2, :3].astype(int)
        diff = np.abs(px - np.array(rgb)).max()
        assert diff <= tolerance, f"{where}: {name} is {px.tolist()}, want {rgb}"


def main() -> None:
    frame = make_frame()
    # Work in this folder with relative paths so the packages record no
    # machine-specific paths. The BMP source is temporary: sleap-io copies PNG/
    # JPEG sources verbatim (as RGB), so a non-PNG/JPEG source makes it encode
    # with the chosen plugin.
    os.chdir(HERE)
    image_path = "channel_order_source.bmp"
    iio.imwrite(image_path, frame)
    try:
        for filename, fmt, plugin, order in CASES:
            if os.path.exists(filename):
                os.remove(filename)
            labels = make_labels(image_path)
            sio.save_slp(
                labels,
                filename,
                embed=True,
                plugin=plugin,
                image_format=fmt,
                image_quality=95 if fmt == "jpg" else None,
                legacy_format=True,
                verbose=False,
            )

            with h5py.File(filename, "r") as f:
                ds = f["video0/video"]
                stored_order = ds.attrs["channel_order"]
                if isinstance(stored_order, bytes):
                    stored_order = stored_order.decode()
                assert stored_order == order, (filename, stored_order)
                assert ds.attrs["format"] == fmt, (filename, ds.attrs["format"])
                videos_json = [
                    json.loads(v) for v in f["videos_json"][:].astype(str)
                ]
                json_order = videos_json[0].get("backend", {}).get("channel_order")
                assert json_order in (None, order), (filename, json_order)
                blob = ds[0].tobytes()
                format_id = float(f["metadata"].attrs["format_id"])
                assert 1.4 <= format_id < 3.0, (filename, format_id)

            # The stored bytes alone (no channel order) decode swapped for BGR.
            raw = iio.imread(blob, extension="." + fmt)
            tol = JPEG_TOLERANCE if fmt == "jpg" else 0
            check_colors(raw[..., ::-1] if order == "BGR" else raw, tol, filename)

            # Python sleap-io reads every package back as RGB.
            img = sio.load_slp(filename).videos[0][0]
            check_colors(img, tol, filename)
            size = os.path.getsize(filename)
            print(f"wrote {filename}: {fmt}, {order}, {size} bytes")
    finally:
        os.remove(image_path)


if __name__ == "__main__":
    main()
