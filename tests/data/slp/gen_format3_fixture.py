"""Generate the fixtures for tests/slp-format-refusal.test.ts.

Writes five small synthetic files next to this script:

- `format3_minimal.slp`: SLP format 3.0 (one dataset per column), written by
  Python sleap-io. sleap-io.js does not read this layout yet and must refuse it.
- `format3_minimal.v2.slp`: the same labels in the 2.x layout. Must load as
  before.
- `format4_stub.slp`: the 2.x file with `format_id` set to 4.0, standing in
  for a format no reader knows yet.
- `required_features_unknown.slp`: the 2.x file with a `required_features`
  attribute on `/metadata` that names a feature no reader knows.
- `required_features_unknown_bytes.slp`: the same, with the attribute stored
  as fixed-length byte strings.

The committed fixtures were written with Python sleap-io 0.10.0 from the
`release/0.10` branch (commit fe4f91c7b), which is not on PyPI yet:

    uv run --with "sleap-io @ git+https://github.com/talmolab/sleap-io@fe4f91c7b" \
        python tests/data/slp/gen_format3_fixture.py

The script asks for each layout explicitly: with `slp_version="v2"` / `"v3"`
when `save_slp` has that option, and with `legacy_format` otherwise. It then
checks what landed on disk and stops if a file is not in the layout it asked
for, so a change in sleap-io's default layout or option names cannot put a
wrong fixture here without anyone noticing. If it stops, update `save_as`.
"""

from __future__ import annotations

import inspect
import shutil
from pathlib import Path

import h5py
import numpy as np
import sleap_io as sio

HERE = Path(__file__).parent
N_FRAMES = 3


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
    print(f"{path.name}: format_id {format_id:g}, /points is a "
          f"{'group' if points_is_group else 'dataset'}")


def make_labels() -> sio.Labels:
    skeleton = sio.Skeleton(nodes=["head", "tail"], edges=[("head", "tail")])
    video = sio.Video(filename="missing.mp4", open_backend=False)
    track = sio.Track(name="animal")
    frames = []
    for i in range(N_FRAMES):
        user = sio.Instance.from_numpy(
            np.array([[10.0 + i, 20.0], [30.0 + i, 40.0]]),
            skeleton=skeleton,
            track=track,
        )
        predicted = sio.PredictedInstance.from_numpy(
            np.array([[11.0 + i, 21.0], [31.0 + i, 41.0]]),
            skeleton=skeleton,
            point_scores=np.array([0.9, 0.8]),
            score=0.85,
            track=track,
        )
        frames.append(
            sio.LabeledFrame(video=video, frame_idx=i, instances=[user, predicted])
        )
    return sio.Labels(
        labeled_frames=frames, videos=[video], skeletons=[skeleton], tracks=[track]
    )


def main() -> None:
    labels = make_labels()
    v3 = HERE / "format3_minimal.slp"
    v2 = HERE / "format3_minimal.v2.slp"
    save_as(labels, v3, "v3")
    save_as(labels, v2, "v2")

    v4 = HERE / "format4_stub.slp"
    shutil.copyfile(v2, v4)
    with h5py.File(v4, "r+") as f:
        f["metadata"].attrs["format_id"] = 4.0

    vlen = HERE / "required_features_unknown.slp"
    shutil.copyfile(v2, vlen)
    with h5py.File(vlen, "r+") as f:
        f["metadata"].attrs["required_features"] = np.array(
            ["made_up_feature", "another_one"], dtype=h5py.string_dtype()
        )

    fixed = HERE / "required_features_unknown_bytes.slp"
    shutil.copyfile(v2, fixed)
    with h5py.File(fixed, "r+") as f:
        f["metadata"].attrs["required_features"] = np.array(
            [b"made_up_feature", b"another_one"], dtype="S"
        )

    print("sleap-io", sio.__version__)


if __name__ == "__main__":
    main()
