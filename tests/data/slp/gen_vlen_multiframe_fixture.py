#!/usr/bin/env python
"""Regenerate ``vlen_multiframe.pkg.slp`` — a multi-frame variable-length (vlen)
embedded-image fixture for the JS port's embedded-frame regression tests.

Why this exists
---------------
Legacy PyQt SLEAP ``pkg.slp`` files store embedded images as an **H5T_VLEN**
dataset (``/videoN/video``): a 1-D array of N elements, each one encoded image's
bytes. h5wasm's high-level ``Dataset.slice([[i, i+1]])`` on such a dataset
(when N > 1) **aborts the WASM runtime** — its post-read ``reclaim_vlen_memory``
H5Treclaims the *full* N-element dataspace over a *one-element* buffer, freeing
garbage pointers past the buffer end (see ``scratch/vlen/upstream-fix.md``).

The JS fix reads one ``hvl_t`` manually and frees only that inner blob. To
regression-test it we need a real N>1 vlen-of-int8 file — but **h5wasm can only
*write* vlen strings**, not vlen-of-int8, so it cannot synthesize this layout at
runtime. h5py can. ``minimal_instance.pkg.slp`` is vlen but N=1, where a
1-element slice happens to select the whole dataset and does *not* abort — so it
cannot cover the N>1 case. This fixture does.

What this produces
------------------
``vlen_multiframe.pkg.slp`` (~8.7 KB), mirroring the parts the embedded-frame
backend reads:
- ``/video0/video``         vlen ``int8``, N=5, each element an encoded-image
                            byte blob of a DIFFERENT length (what makes it vlen,
                            not 2-D-padded/concat); each starts with the PNG
                            magic and ends with an ``IEND`` tail.
- ``/video0/frame_numbers`` ``int32`` ``[0..N)``.
- ``/video0/video`` attrs   ``format=png``, ``width``/``height``/``channels``.

Verified faithful: a raw ``dataset.slice([[2,3]])`` on it aborts the WASM
runtime ("Aborted(native code called abort())"), while the JS manual hvl_t read
returns every frame byte-identically with a flat wasm heap.

Run
---
    uv run --with h5py --with numpy python tests/data/slp/gen_vlen_multiframe_fixture.py
"""

import os

import h5py
import numpy as np

PNG_MAGIC = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
PNG_IEND_TAIL = bytes([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82])  # "IEND" + CRC

N = 5
OUT = os.path.join(os.path.dirname(__file__), "vlen_multiframe.pkg.slp")


def make_blob(i: int) -> bytes:
    # Unique, identifiable, VARYING-length payload between magic and IEND tail.
    body = bytes([(i + 1) & 0xFF]) * (3 + i * 7)  # blob lengths: 19, 26, 33, 40, 47
    return PNG_MAGIC + body + PNG_IEND_TAIL


def main() -> None:
    blobs = [make_blob(i) for i in range(N)]
    vlen_dt = h5py.vlen_dtype(np.dtype("int8"))  # H5T_VLEN of signed bytes (matches legacy)

    with h5py.File(OUT, "w") as f:
        g = f.create_group("video0")
        ds = g.create_dataset("video", shape=(N,), dtype=vlen_dt)
        for i, b in enumerate(blobs):
            ds[i] = np.frombuffer(b, dtype=np.int8)
        ds.attrs["format"] = "png"
        ds.attrs["width"] = 8
        ds.attrs["height"] = 8
        ds.attrs["channels"] = 1
        g.create_dataset("frame_numbers", data=np.arange(N, dtype=np.int32))

    print(f"wrote {OUT} ({os.path.getsize(OUT)} bytes); N={N}, lengths={[len(b) for b in blobs]}")


if __name__ == "__main__":
    main()
