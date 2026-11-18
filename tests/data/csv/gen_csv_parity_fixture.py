#!/usr/bin/env python
"""Regenerate the SLEAP Analysis CSV parity fixtures in this folder.

Why this exists
---------------
``labelsToCsv`` (``src/io/csv.ts``) must write the same CSV as Python
``sleap_io.save_csv(labels, path, format="sleap")`` for the same ``.slp``. Two
Python fixes are mirrored (talmolab/sleap-app#464):

- talmolab/sleap-io#564: points marked not visible are written as empty x/y,
  even though they keep their last coordinates.
- talmolab/sleap-io#591: one row per animal per frame. A prediction that a user
  instance replaced (linked by ``from_predicted``, or on the same track) is not
  written; in a single-instance project any user instance replaces the frame's
  predictions; predictions nobody replaced are kept.

This script builds small projects that hit every branch, saves each as ``.slp``
and writes Python's CSV next to it. ``tests/io/csv-python-parity.test.ts`` reads
the ``.slp`` with sleap-io.js, exports CSV, and compares cell by cell.

What this produces
------------------
- ``multi_animal.slp``           tracked, two animals per frame.
- ``multi_animal.sleap.csv``     ``save_csv(format="sleap")`` (one row per animal).
- ``multi_animal.all.csv``       every user and predicted instance
                                 (``to_dataframe(prefer_user_instances=False)``
                                 through the same SLEAP column transform), the
                                 JS ``preferUserInstances: false`` output.
- ``single_instance.slp``        untracked, one animal per frame.
- ``single_instance.sleap.csv``  ``save_csv(format="sleap")``.

How to run
----------
Needs a sleap-io with both fixes (0.9.5+ from main, i.e. after #591)::

    cd /path/to/sleap-io && uv run python \\
        /path/to/sleap-io.js/tests/data/csv/gen_csv_parity_fixture.py
"""

from pathlib import Path

import numpy as np
import sleap_io as sio
from sleap_io.codecs import to_dataframe
from sleap_io.io.csv import _transform_to_sleap_format

HERE = Path(__file__).resolve().parent


def pred(xy, scores, score, track=None):
    """A predicted instance on the module skeleton."""
    return sio.PredictedInstance.from_numpy(
        np.array(xy, dtype="float64"),
        skeleton=SKEL,
        point_scores=np.array(scores, dtype="float64"),
        score=score,
        track=track,
    )


def user(xy, track=None, from_predicted=None, hidden=()):
    """A user instance; nodes named in `hidden` keep coords but are not visible."""
    inst = sio.Instance.from_numpy(
        np.array(xy, dtype="float64"),
        skeleton=SKEL,
        track=track,
        from_predicted=from_predicted,
    )
    for name in hidden:
        inst.points["visible"][SKEL.index(name)] = False
    return inst


SKEL = sio.Skeleton(nodes=["thorax", "head"], edges=[("thorax", "head")])


def multi_animal() -> sio.Labels:
    video = sio.Video(filename="multi.mp4", open_backend=False)
    a, b = sio.Track("a"), sio.Track("b")
    frames = []

    # Frame 0: user made from prediction p0 (Accept prediction), head hidden,
    # no track: the from_predicted link alone drops p0; p1 (other animal) kept.
    p0 = pred([[10, 20], [30, 40]], [0.9, 0.8], 0.95, track=a)
    p1 = pred([[50, 60], [70, 80]], [0.7, 0.6], 0.85, track=b)
    u0 = user([[11, 21], [31, 41]], from_predicted=p0, hidden=["head"])
    frames.append(sio.LabeledFrame(video=video, frame_idx=0, instances=[p0, p1, u0]))

    # Frame 1: user on track a with no from_predicted link: same track -> p2
    # dropped; p3 kept.
    p2 = pred([[12, 22], [32, 42]], [0.5, 0.4], 0.75, track=a)
    p3 = pred([[52, 62], [72, 82]], [0.3, 0.2], 0.65, track=b)
    u1 = user([[13, 23], [33, 43]], track=a)
    frames.append(sio.LabeledFrame(video=video, frame_idx=1, instances=[p2, p3, u1]))

    # Frame 2: predictions only, one with a hidden (not visible) head point.
    p4 = pred([[14, 24], [34, 44]], [0.9, 0.1], 0.9, track=a)
    p4.points["visible"][SKEL.index("head")] = False
    p5 = pred([[54, 64], [74, 84]], [0.9, 0.9], 0.8, track=b)
    frames.append(sio.LabeledFrame(video=video, frame_idx=2, instances=[p4, p5]))

    # Frame 3: an untracked, unlinked user instance does not replace the
    # tracked prediction, so both are written.
    p6 = pred([[16, 26], [36, 46]], [0.8, 0.8], 0.7, track=b)
    u2 = user([[17, 27], [37, 47]])
    frames.append(sio.LabeledFrame(video=video, frame_idx=3, instances=[p6, u2]))

    return sio.Labels(
        labeled_frames=frames, videos=[video], skeletons=[SKEL], tracks=[a, b]
    )


def single_instance() -> sio.Labels:
    video = sio.Video(filename="single.mp4", open_backend=False)
    frames = []

    # Frame 0: an unlinked, untracked user instance still replaces the frame's
    # prediction, because the project has one animal.
    p0 = pred([[10, 20], [30, 40]], [0.9, 0.8], 0.95)
    u0 = user([[11, 21], [31, 41]], hidden=["thorax"])
    frames.append(sio.LabeledFrame(video=video, frame_idx=0, instances=[p0, u0]))

    # Frame 1: prediction only -> kept.
    p1 = pred([[12, 22], [32, 42]], [0.7, 0.6], 0.85)
    frames.append(sio.LabeledFrame(video=video, frame_idx=1, instances=[p1]))

    # Frame 2: user only.
    u1 = user([[13, 23], [33, 43]])
    frames.append(sio.LabeledFrame(video=video, frame_idx=2, instances=[u1]))

    return sio.Labels(labeled_frames=frames, videos=[video], skeletons=[SKEL])


def main() -> None:
    # CSVs are written from the saved-and-reloaded .slp, so both libraries
    # export from exactly the same stored values.
    for name, build in [
        ("multi_animal", multi_animal),
        ("single_instance", single_instance),
    ]:
        slp = str(HERE / f"{name}.slp")
        sio.save_slp(build(), slp, embed=False)
        sio.save_csv(sio.load_slp(slp), str(HERE / f"{name}.sleap.csv"))

    labels = sio.load_slp(str(HERE / "multi_animal.slp"))
    df = to_dataframe(
        labels, format="instances", include_metadata=True, include_score=True
    )
    _transform_to_sleap_format(df).to_csv(
        HERE / "multi_animal.all.csv", index=False, na_rep=""
    )
    print("sleap-io", sio.__version__, "->", HERE)


if __name__ == "__main__":
    main()
