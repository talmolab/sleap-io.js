#!/usr/bin/env python
"""Regenerate the format-2.3 virtual-crop SLP fixture for the JS port.

This script produces ``cropped_format_2_3.pkg.slp`` — a small, self-contained
embedded-frames package whose single video carries a *virtual crop* (SLP format
2.3, the ``/video_crops`` dataset). It is the byte-for-byte reference that the
JavaScript (h5wasm) writer must reproduce.

Base file
---------
``minimal_instance.pkg.slp`` is the most JS-friendly base available under
``tests/data/slp``: a single embedded-frame HDF5 video (1 frame, 384x384x1
grayscale, stored under ``/video0/video`` with a ``/video0/source_video``
attr) plus one labeled frame with two instances. No external video file is
needed to load it, so the cropped fixture is fully portable.

What this does
--------------
1. Loads the base package in Python sleap-io v0.8.0 (crop feature present).
2. Applies ``Video.crop((x1, y1, x2, y2), fill=...)`` to the one video with a
   concrete, fully in-bounds sub-region rect and a non-zero fill value.
3. Saves to ``cropped_format_2_3.pkg.slp`` with ``embed=True`` so the
   *uncropped* source frame is re-embedded and the crop rides ``/video_crops``.
4. Asserts ``format_id == 2.3`` and that reloading preserves the crop
   (cropped shape, crop rect, and fill).

The on-disk contract this fixture pins down (verified separately with h5py):
- ``/video_crops`` is a SCALAR HDF5 dataset (shape ``()``), dtype ``|SN``
  (NumPy fixed-width bytes, ``np.bytes_``), holding the compact JSON string
  ``[{"video":0,"crop":[x1,y1,x2,y2],"fill":f}]`` with separators
  ``(",", ":")`` (no spaces). Python's ``read_hdf5_dataset`` reads it back,
  ``.decode()``s, and ``json.loads``es it.
- The cropped video's ``/videos_json`` entry describes the UNCROPPED 384x384
  source (``shape`` = full frame, ``dataset`` = ``video0/video``) and carries
  NO ``crop`` / ``crop_fill`` / ``source_shape`` keys.
- ``/metadata @format_id == 2.3``.

Run
---
    /home/talmo/code/sleap-io/.venv/bin/python \
        /home/talmo/code/sleap-io.js/tests/data/slp/gen_cropped_fixture.py

Re-runnable: it overwrites the output fixture deterministically.
"""

import os

import sleap_io as sio

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "minimal_instance.pkg.slp")
OUT = os.path.join(HERE, "cropped_format_2_3.pkg.slp")

# Concrete, fully in-bounds crop rect over the 384x384 source frame.
# (x1, y1, x2, y2), x2/y2 exclusive -> cropped view is 256 wide x 192 tall.
CROP = (64, 96, 320, 288)
# Non-zero fill so the fill field is unambiguously exercised on read.
FILL = 128


def main() -> None:
    labels = sio.load_slp(BASE)
    assert len(labels.videos) == 1, "base fixture should have exactly one video"

    src = labels.videos[0]
    src_shape = src.shape  # (frames, H, W, C) == (1, 384, 384, 1)
    print(f"Source shape: {src_shape}")

    # Apply the virtual crop. share_decode is irrelevant for a single tile.
    cropped = src.crop(CROP, fill=FILL)
    print(f"Cropped shape: {cropped.shape}")  # (1, 192, 256, 1)
    print(f"Crop rect:     {cropped.crop_rect}")
    print(f"Crop fill:     {cropped.crop_fill}")

    # Swap the cropped video into the labels (frames still reference it by index).
    labels.videos[0] = cropped
    for lf in labels.labeled_frames:
        lf.video = cropped

    # Re-embed so the UNCROPPED source frame is stored; the crop rides
    # /video_crops and is re-applied exactly once on read.
    if os.path.exists(OUT):
        os.remove(OUT)
    labels.save(OUT, embed=True)
    print(f"Wrote: {OUT}")

    # --- Verify round-trip ---
    reloaded = sio.load_slp(OUT)
    rv = reloaded.videos[0]
    assert rv.crop_rect == CROP, f"crop rect not preserved: {rv.crop_rect!r}"
    assert rv.crop_fill == FILL, f"crop fill not preserved: {rv.crop_fill!r}"
    assert tuple(rv.shape) == (
        src_shape[0],
        CROP[3] - CROP[1],
        CROP[2] - CROP[0],
        src_shape[3],
    ), f"cropped shape not preserved: {rv.shape!r}"

    fmt = sio.io.slp.read_hdf5_attrs(OUT, "metadata", "format_id")
    print(f"format_id: {fmt}")
    assert float(fmt) == 2.3, f"expected format_id 2.3, got {fmt}"

    print("OK: round-trip preserves crop and format_id == 2.3")


if __name__ == "__main__":
    main()
