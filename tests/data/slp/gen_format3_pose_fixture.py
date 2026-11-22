"""Generate the fixtures for tests/slp-format3-read.test.ts.

Writes four small synthetic files next to this script:

- `format3_pose.slp`: SLP format 3.0 (one dataset per column). Two videos, two
  tracks, user and predicted instances, a hidden point, a verified point, a
  user instance linked to the prediction it came from, tracking scores, and a
  negative frame.
- `format3_pose.v2.slp`: the same labels in the 2.x layout. Every reader must
  give the same result for both files.
- `format3_unlabeled.slp`: format 3.0 with what the 2.x layout cannot store: a
  point marked as not labelled, and metadata on a frame and on an instance.
- `format3_rois_stub.slp`: `format3_pose.slp` with an empty `/rois` group added,
  standing in for a format 3.0 file with a table that is not read yet.

The committed fixtures were written with Python sleap-io 0.10.0 from the
`release/0.10` branch (commit fe4f91c7b), which is not on PyPI yet:

    uv run --with "sleap-io @ git+https://github.com/talmolab/sleap-io@fe4f91c7b" \
        python tests/data/slp/gen_format3_pose_fixture.py

The script asks for each layout explicitly (see `save_as`) and stops if a file
on disk is not in the layout it asked for.
"""

from __future__ import annotations

import inspect
import shutil
from pathlib import Path

import h5py
import numpy as np
import sleap_io as sio

HERE = Path(__file__).parent


def save_as(labels: sio.Labels, path: Path, layout: str) -> None:
    """Save `labels` in the "v2" or "v3" layout and verify the result."""
    params = inspect.signature(sio.save_slp).parameters
    if "slp_version" in params:
        sio.save_slp(labels, str(path), slp_version=layout)
    else:
        sio.save_slp(labels, str(path), legacy_format=(layout == "v2"))
    with h5py.File(path, "r") as f:
        format_id = float(f["metadata"].attrs["format_id"])
        points_is_group = isinstance(f["points"], h5py.Group)
    if layout == "v3":
        assert format_id >= 3.0 and points_is_group, (format_id, points_is_group)
    else:
        assert format_id < 3.0 and not points_is_group, (format_id, points_is_group)
    print(f"{path.name}: format_id {format_id:g}")


def make_labels() -> sio.Labels:
    skeleton = sio.Skeleton(
        nodes=["head", "body", "tail"], edges=[("head", "body"), ("body", "tail")]
    )
    videos = [
        sio.Video(filename="first.mp4", open_backend=False),
        sio.Video(filename="second.mp4", open_backend=False),
    ]
    tracks = [sio.Track(name="a"), sio.Track(name="b")]

    def user(points, track=None):
        return sio.Instance.from_numpy(
            np.array(points, dtype=float), skeleton=skeleton, track=track
        )

    def predicted(points, score, track=None, tracking_score=None):
        inst = sio.PredictedInstance.from_numpy(
            np.array(points, dtype=float),
            skeleton=skeleton,
            point_scores=np.array([0.9, 0.8, 0.7]),
            score=score,
            track=track,
        )
        if tracking_score is not None:
            inst.tracking_score = tracking_score
        return inst

    # Video 0, frame 0: one user and one predicted instance on two tracks.
    f0 = sio.LabeledFrame(
        video=videos[0],
        frame_idx=0,
        instances=[
            user([[10, 20], [30, 40], [50, 60]], track=tracks[0]),
            predicted([[11, 21], [31, 41], [51, 61]], 0.75, tracks[1], 0.5),
        ],
    )

    # Video 0, frame 5: a prediction and the user instance corrected from it,
    # with a hidden tail and a verified head.
    source = predicted([[12, 22], [32, 42], [52, 62]], 0.25, tracks[0], 0.125)
    corrected = user([[13, 23], [33, 43], [np.nan, np.nan]], track=tracks[0])
    corrected.from_predicted = source
    name = "verified" if "verified" in corrected.points.dtype.names else "complete"
    corrected.points[name][0] = True
    f5 = sio.LabeledFrame(video=videos[0], frame_idx=5, instances=[source, corrected])

    # Video 1, frame 2: a prediction with no track.
    f2 = sio.LabeledFrame(
        video=videos[1],
        frame_idx=2,
        instances=[predicted([[14, 24], [34, 44], [54, 64]], 0.5)],
    )

    # Video 1, frame 7: a negative frame (reviewed, holds no animal).
    f7 = sio.LabeledFrame(video=videos[1], frame_idx=7, instances=[])
    f7.is_negative = True

    return sio.Labels(
        labeled_frames=[f0, f5, f2, f7],
        videos=videos,
        skeletons=[skeleton],
        tracks=tracks,
    )


def main() -> None:
    save_as(make_labels(), HERE / "format3_pose.slp", "v3")
    save_as(make_labels(), HERE / "format3_pose.v2.slp", "v2")

    labels = make_labels()
    first = labels.labeled_frames[0]
    first.instances[0].set_unlabeled("tail")  # tail was not annotated
    first.metadata["note"] = "frame note"
    first.instances[0].metadata["annotator"] = "someone"
    save_as(labels, HERE / "format3_unlabeled.slp", "v3")

    # A format 3.0 file with a table this reader does not read in that format
    # yet: the pose fixture plus an empty `/rois` group.
    stub = HERE / "format3_rois_stub.slp"
    shutil.copyfile(HERE / "format3_pose.slp", stub)
    with h5py.File(stub, "r+") as f:
        f.create_group("rois")

    for name in ("format3_pose.slp", "format3_pose.v2.slp", "format3_unlabeled.slp"):
        check = sio.load_slp(str(HERE / name))
        print(
            f"  {name}: {len(check)} frames, "
            f"{sum(len(lf.instances) for lf in check)} instances, "
            f"negative {[lf.frame_idx for lf in check if lf.is_negative]}"
        )
    print("sleap-io", sio.__version__)


if __name__ == "__main__":
    main()
