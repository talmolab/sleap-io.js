#!/usr/bin/env python
"""Regenerate the spilled-``source_video`` SLP fixture for the JS port (issue #214).

This script produces ``spilled_source_video.pkg.slp`` — an embedded-frames
package whose single video's ``source_video`` lineage metadata is too large for
an HDF5 attribute and so is *spilled to a dataset*.

Background
----------
A video's ``source_video`` metadata is normally written to the
``/video0/source_video`` group as a ``json`` **string attribute**. HDF5 caps a
single attribute at ~64 KB, so when the metadata is large — most commonly an
``ImageVideo`` source whose ``filename`` is a list of thousands of frame paths —
Python sleap-io (see talmolab/sleap-io#516) instead writes the JSON to a
``json`` **dataset** in the same group via ``np.bytes_(blob)``. That produces a
**scalar** (shape ``()``, 0-dimensional) fixed-length string (``|S<n>``) whose
single element is the entire JSON blob.

Before the issue-#214 fix, sleap-io.js only ever exercised the attribute form
and the JS writer's length-1 ``[blob]`` dataset form; the scalar ``|S<n>`` form
Python actually writes had no test coverage, and the sync reader read the
dataset value unguarded (a throw there aborted the whole file open).

Base file
---------
``minimal_instance.pkg.slp`` — a single embedded-frame HDF5 video (1 frame,
384x384x1 grayscale, under ``/video0/video`` with a ``/video0/source_video``
``json`` attribute) plus one labeled frame. Fully portable (no external video).

What this does
--------------
1. Copies the base package.
2. In ``/video0/source_video``: deletes the ``json`` *attribute* and writes a
   scalar ``|S<n>`` ``json`` *dataset* holding an oversized (>64 KB) ImageVideo
   source metadata blob (a many-frame filename list + backend dict). This is the
   exact on-disk shape that ``labels.save(..., embed="user")`` emits when the
   source metadata exceeds the attribute ceiling.
3. Verifies the dataset is scalar, ``|S<n>``, and that no ``json`` attribute
   remains — so the reader must decode the dataset, not the attribute.

The on-disk contract this fixture pins down:
- ``/video0/source_video/json`` is a SCALAR dataset (shape ``()``), dtype
  ``|S<n>`` with ``n > 65536``.
- ``/video0/source_video`` has NO ``json`` attribute.
- The decoded JSON is an ImageVideo source: ``{"filename": [<N paths>],
  "backend": {"type": "ImageVideo", ...}}``.

Run with (no sleap-io needed — only h5py/numpy):
    uv run --with h5py --with numpy python gen_spilled_source_video_fixture.py
"""

import json
import shutil
from pathlib import Path

import h5py
import numpy as np

HERE = Path(__file__).resolve().parent
BASE = HERE / "minimal_instance.pkg.slp"
OUT = HERE / "spilled_source_video.pkg.slp"

# Number of frames in the synthetic ImageVideo source. Chosen so the JSON blob
# comfortably exceeds HDF5's ~64 KB attribute ceiling (the real spill trigger)
# while keeping the fixture small.
N_FRAMES = 2200


def main() -> None:
    shutil.copy(BASE, OUT)

    source_meta = {
        "filename": [f"raw_images_top/frame_{i:05d}.jpg" for i in range(N_FRAMES)],
        "backend": {
            "type": "ImageVideo",
            "shape": [N_FRAMES, 384, 384, 1],
            "grayscale": True,
        },
    }
    blob = json.dumps(source_meta, separators=(",", ":"))
    n_bytes = len(blob.encode())
    assert n_bytes > 65536, f"blob must exceed the 64 KB attr ceiling, got {n_bytes}"

    with h5py.File(OUT, "a") as f:
        grp = f["video0/source_video"]
        # Drop the small attribute form the base file used...
        if "json" in grp.attrs:
            del grp.attrs["json"]
        if "json" in grp:
            del grp["json"]
        # ...and write the oversized metadata as Python's spill form: a scalar
        # fixed-length string dataset (np.bytes_ -> shape (), dtype |S<n>).
        grp.create_dataset("json", data=np.bytes_(blob))

    # Verify the on-disk contract.
    with h5py.File(OUT, "r") as f:
        ds = f["video0/source_video/json"]
        assert ds.shape == (), f"expected scalar, got shape {ds.shape}"
        assert ds.dtype.kind == "S", f"expected fixed-length string, got {ds.dtype}"
        assert "json" not in f["video0/source_video"].attrs, "attr must be absent"
        decoded = json.loads(ds[()])
        assert decoded["backend"]["type"] == "ImageVideo"
        assert len(decoded["filename"]) == N_FRAMES

    print(f"Wrote {OUT.name}: scalar {ds.dtype} json dataset ({n_bytes} bytes)")


if __name__ == "__main__":
    main()
