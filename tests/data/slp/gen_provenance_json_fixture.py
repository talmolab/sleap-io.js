#!/usr/bin/env python
"""Regenerate the Python-written ``/provenance_json`` SLP fixtures for the JS port.

Python sleap-io (talmolab/sleap-io#517) stores ``Labels.provenance`` in a
top-level ``/provenance_json`` dataset (a scalar ``|S<n>`` JSON blob) and only
mirrors it into the ``metadata/json`` attribute while that attribute stays under
HDF5's 64 KB limit. When provenance is large, the mirror is dropped, so a reader
that only looks at the attribute loses the provenance.

This writes two fixtures from ``minimal_instance.slp``:

- ``provenance_json_small.slp``: a small provenance, present in BOTH the
  ``/provenance_json`` dataset and the ``metadata/json`` attribute.
- ``provenance_json_large.slp``: a large provenance (an 800-entry
  ``merge_history``, >64 KB) that is ONLY in the ``/provenance_json`` dataset;
  the ``metadata/json`` attribute has no ``provenance`` key.

Run with a sleap-io checkout that includes #517 (``read_provenance`` exists):
    cd /path/to/sleap-io && uv run python /path/to/gen_provenance_json_fixture.py
"""

import json
import warnings
from pathlib import Path

import h5py

import sleap_io as sio

HERE = Path(__file__).resolve().parent
BASE = HERE / "minimal_instance.slp"


def large_provenance() -> dict:
    return {
        "sleap_version": "py-fixture",
        "merge_history": [
            {
                "timestamp": f"2026-01-01T00:00:{i % 60:02d}",
                "source_filename": f"/data/session_{i:05d}/labels.v001.slp",
                "frames_merged": i,
            }
            for i in range(800)
        ],
    }


def write(name: str, provenance: dict) -> None:
    labels = sio.load_slp(str(BASE))
    labels.provenance = provenance
    out = HERE / name
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        labels.save(str(out))
    with h5py.File(out, "r") as f:
        assert "provenance_json" in f, "no /provenance_json dataset written"
        md = json.loads(f["metadata"].attrs["json"])
        print(name, "| attr has provenance:", "provenance" in md)


write("provenance_json_small.slp", {"sleap_version": "py-fixture", "note": "small"})
write("provenance_json_large.slp", large_provenance())
