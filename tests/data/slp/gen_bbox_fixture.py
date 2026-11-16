#!/usr/bin/env python
"""Regenerate the Python-written bounding-box SLP fixture for the JS port.

This script produces ``py_written_bboxes.slp``: a small SLP whose ``/bboxes``
is the columnar GROUP that Python sleap-io writes (SLP 2.0+; one child dataset
per field: x1, y1, x2, y2, angle, video, frame_idx, track, instance,
is_predicted, score, tracking_score, plus vlen-str category / name / source).
It pins down the layout the JS eager and streaming readers must read.

Base file: SLEAP's ``tests/data/slp_hdf5/centered_pair.slp`` (two user
instances per frame, no tracks), cut down to its first 3 labeled frames.

Boxes added (row order is the order written):
- Frames 0, 15, 31: one ``UserBoundingBox`` per instance from
  ``inst.to_bbox(padding=4)``, linked to that instance. The first box of frame
  0 also gets track ``mouse_a``; the boxes of frame 31 get category ``mouse``.
- Frame 15: one standalone ``PredictedBoundingBox`` (score 0.85, rotated
  angle 0.5, track ``mouse_b``, tracking_score 0.6, name/source set).
- Frame 100: a box-only frame (no instances) with one ``PredictedBoundingBox``.

Run (from a sleap-io checkout):
    uv run python /path/to/sleap-io.js/tests/data/slp/gen_bbox_fixture.py \
        /path/to/sleap/tests/data/slp_hdf5/centered_pair.slp

Re-runnable: it overwrites the output fixture.
"""

import os
import sys

import sleap_io as sio

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "py_written_bboxes.slp")


def main(base_path: str) -> None:
    labels = sio.load_slp(base_path)
    labels.labeled_frames = labels.labeled_frames[:3]
    labels.suggestions = []
    video = labels.videos[0]

    track_a = sio.Track("mouse_a")
    track_b = sio.Track("mouse_b")
    labels.tracks = [track_a, track_b]

    for lf in labels.labeled_frames:
        for inst in lf.instances:
            bbox = inst.to_bbox(padding=4)
            bbox.instance = inst
            lf.bboxes.append(bbox)

    lf0, lf15, lf31 = labels.labeled_frames
    assert (lf0.frame_idx, lf15.frame_idx, lf31.frame_idx) == (0, 15, 31)
    lf0.bboxes[0].track = track_a
    for bbox in lf31.bboxes:
        bbox.category = "mouse"

    lf15.bboxes.append(
        sio.PredictedBoundingBox(
            x1=100.0,
            y1=120.0,
            x2=180.0,
            y2=200.0,
            angle=0.5,
            score=0.85,
            track=track_b,
            tracking_score=0.6,
            name="pred",
            source="detector",
        )
    )

    labels.labeled_frames.append(
        sio.LabeledFrame(
            video=video,
            frame_idx=100,
            bboxes=[
                sio.PredictedBoundingBox(x1=10.0, y1=20.0, x2=30.0, y2=50.0, score=0.4)
            ],
        )
    )

    sio.save_slp(labels, OUT, embed=False)

    # Sanity check the round trip in Python.
    loaded = sio.load_slp(OUT)
    boxes = [b for lf in loaded.labeled_frames for b in lf.bboxes]
    assert len(boxes) == 8, len(boxes)
    for lf in loaded.labeled_frames:
        for b in lf.bboxes:
            print(
                lf.frame_idx,
                type(b).__name__,
                round(b.x1, 3),
                round(b.y1, 3),
                round(b.x2, 3),
                round(b.y2, 3),
                b.angle,
                getattr(b, "score", None),
                b.track.name if b.track else None,
                b.tracking_score,
                b.instance is not None,
                b.category.name if b.category else "",
                b.name,
                b.source,
            )
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main(sys.argv[1])
