"""Generate the SLP format 3.0 fixtures for the tests/slp-format3-*.test.ts files.

Writes these small synthetic files next to this script:

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
- `format3_metadata.slp`: format 3.0 with unlabelled user and predicted points,
  metadata of every kind (bool, int, float, string) on instances, frames and
  bounding boxes, some records lacking a key (so `present` is written), extra
  columns this reader does not know in every pose table and in `/bboxes`, and
  members of `metadata/` that readers must ignore.
- `format3_defaults.slp`: `format3_pose.slp` without any optional column, so
  every reader falls back to the defaults of the 3.0 reading rules.
- `format3_bad_frame_id.slp`: `format3_pose.slp` with an instance whose
  `frame_id` names the wrong frame, which the 3.0 range checks refuse.
- `format3_events.slp`: `format3_pose.slp` with what this reader does not read
  at all: frame-spanning events and their types (`/events`, `/event_types`),
  and a top-level dataset of a newer writer (`/future_table`).
- `format3_embedded.pkg.slp`: `minimal_instance.pkg.slp` saved in format 3.0
  with its frame embedded, then its embedded group renamed `/video2`, as after
  removing videos from a package. `/frames/video` holds the list index (0),
  which no longer matches the group number.

The committed fixtures were written with Python sleap-io 0.10.0 from the
`release/0.10` branch (commit fe4f91c7b), which is not on PyPI yet:

    uv run --with "sleap-io @ git+https://github.com/talmolab/sleap-io@fe4f91c7b" \
        python tests/data/slp/gen_format3_pose_fixture.py

The script asks for each layout explicitly (see `save_as`) and stops if a file
on disk is not in the layout it asked for.
"""

from __future__ import annotations

import inspect
import json
import os
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


def add_column(f: h5py.File, table: str, name: str, data) -> None:
    """Add a column to a 3.0 table, as a newer writer might."""
    f[table].create_dataset(name, data=data)


def make_metadata_fixture(path: Path) -> None:
    """Write `format3_metadata.slp` (see the module docstring)."""
    labels = make_labels()
    f0, f5, _, f7 = labels.labeled_frames
    user, pred = f0.instances
    user.set_unlabeled("tail")
    pred.set_unlabeled("head")
    user.metadata.update(
        {"annotator": "someone", "reviewed": True, "pass": 2, "quality": 0.5}
    )
    pred.metadata.update({"reviewed": False, "pass": 1, "quality": 0.25})
    f5.instances[0].metadata.update({"pass": 3})
    f0.metadata.update({"note": "frame note", "flagged": True})
    f7.metadata.update({"note": "negative"})
    f0.bboxes.append(
        sio.UserBoundingBox(
            x1=1.0, y1=2.0, x2=3.0, y2=4.0, metadata={"source_id": 7, "label": "box"}
        )
    )
    f0.bboxes.append(
        sio.PredictedBoundingBox(x1=5.0, y1=6.0, x2=7.0, y2=8.0, score=0.5)
    )
    save_as(labels, path, "v3")
    with h5py.File(path, "r+") as f:
        row_column = {
            "frames": "frame_idx",
            "instances": "instance_type",
            "points": "x",
            "pred_points": "x",
            "bboxes": "x1",
        }
        for table, column in row_column.items():
            n = len(f[f"{table}/{column}"])
            add_column(f, table, "extra", np.arange(n, dtype=float))
        # Members of `metadata/` that are not a key: readers ignore them.
        f["instances/metadata"].create_dataset("loose", data=np.zeros(5))
        f["instances/metadata"].create_group("two_d").create_dataset(
            "values", data=np.zeros((5, 2))
        )
        f["frames/metadata"].create_group("no_values")


def make_defaults_fixture(path: Path) -> None:
    """Write `format3_defaults.slp`: the pose file without optional columns."""
    shutil.copyfile(HERE / "format3_pose.slp", path)
    optional = {
        "points": ("visible", "verified", "labeled"),
        "pred_points": ("visible", "verified", "labeled", "score"),
        "instances": ("track", "from_predicted", "score", "tracking_score"),
        "frames": ("is_negative",),
    }
    with h5py.File(path, "r+") as f:
        for table, columns in optional.items():
            for column in columns:
                if column in f[table]:
                    del f[f"{table}/{column}"]
    repack(path)


def make_events_fixture(path: Path) -> None:
    """Write `format3_events.slp` (see the module docstring)."""
    labels = make_labels()
    grooming = sio.EventType(name="grooming", description="self-grooming")
    labels.event_types.append(grooming)
    labels.events.append(
        sio.UserEvent(
            type=grooming,
            video=labels.videos[0],
            start_frame=0,
            end_frame=5,
            subject=labels.tracks[0],
        )
    )
    save_as(labels, path, "v3")
    with h5py.File(path, "r+") as f:
        assert "events" in f and "event_types" in f
        f.create_dataset("future_table", data=np.arange(3))


def make_bad_frame_id_fixture(path: Path) -> None:
    """Write `format3_bad_frame_id.slp`: instance 0 claims to be in frame 1."""
    shutil.copyfile(HERE / "format3_pose.slp", path)
    with h5py.File(path, "r+") as f:
        frame_id = f["instances/frame_id"][()]
        frame_id[0] = 1
        f["instances/frame_id"][...] = frame_id


def repack(path: Path) -> None:
    """Copy every object into a fresh file, so deleted datasets free their space."""
    tmp = path.with_suffix(".tmp")
    with h5py.File(path, "r") as src, h5py.File(tmp, "w") as dst:
        for key, value in src.attrs.items():
            dst.attrs[key] = value
        for name in src:
            src.copy(src[name], dst, name=name)
    tmp.replace(path)


def scrub_paths(path: Path) -> None:
    """Make the paths of this directory in a file's strings relative.

    An embedding save records where the package and its source were written
    (videos, source video, provenance). The fixtures are public, so the
    directory they were generated in must not be stored.
    """
    prefixes = [str(HERE) + os.sep, str(HERE.resolve()) + os.sep]

    def scrub(text: str) -> str:
        for prefix in prefixes:
            text = text.replace(prefix, "")
            # JSON-escaped forms of the same prefix.
            text = text.replace(prefix.replace("/", "\\/"), "")
        return text

    def visit_attrs(obj) -> None:
        for key, value in list(obj.attrs.items()):
            if isinstance(value, bytes):
                new = scrub(value.decode()).encode()
                if new != value:
                    obj.attrs[key] = np.bytes_(new)
            elif isinstance(value, str):
                new = scrub(value)
                if new != value:
                    obj.attrs[key] = new

    with h5py.File(path, "r+") as f:
        visit_attrs(f)
        names: list[str] = []
        f.visit(names.append)
        for name in names:
            obj = f[name]
            visit_attrs(obj)
            if (
                isinstance(obj, h5py.Dataset)
                and h5py.check_string_dtype(obj.dtype) is not None
                and obj.ndim == 1
            ):
                values = obj.asstr()[()].tolist()
                new = [scrub(v) for v in values]
                if new != values:
                    obj[...] = np.array(new, dtype=obj.dtype)


def assert_no_machine_paths(path: Path) -> None:
    """Fail if a fixture stores an absolute path of the machine that wrote it."""
    raw = path.read_bytes()
    needles = {
        str(HERE),
        str(HERE.resolve()),
        str(Path.home()),
        str(Path.cwd().resolve()),
        "/scr/",
        "/home/",
        "/Users/",
        "/tmp/",
    }
    found = sorted(n for n in needles if n.encode() in raw)
    assert not found, f"{path.name} stores machine paths: {found}"
    # Strings inside datasets and attributes, decoded (in case of compression).
    with h5py.File(path, "r") as f:
        texts: list[str] = []

        def collect(obj) -> None:
            for value in obj.attrs.values():
                if isinstance(value, (bytes, str)):
                    texts.append(value.decode() if isinstance(value, bytes) else value)

        collect(f)
        names: list[str] = []
        f.visit(names.append)
        for name in names:
            obj = f[name]
            collect(obj)
            if (
                isinstance(obj, h5py.Dataset)
                and h5py.check_string_dtype(obj.dtype) is not None
            ):
                texts.extend(
                    str(v) for v in np.atleast_1d(obj.asstr()[()]).ravel().tolist()
                )
    found = sorted({n for n in needles for t in texts if n in t})
    assert not found, f"{path.name} stores machine paths: {found}"


def make_embedded_fixture(path: Path) -> None:
    """Write `format3_embedded.pkg.slp` (see the module docstring)."""
    # Load and save by relative paths from this directory, then make any path
    # the save still recorded relative (see scrub_paths).
    cwd = Path.cwd()
    os.chdir(HERE)
    try:
        labels = sio.load_slp("minimal_instance.pkg.slp")
        sio.save_slp(labels, path.name, legacy_format=False, embed=True)
    finally:
        os.chdir(cwd)
    scrub_paths(path)
    with h5py.File(path, "r+") as f:
        assert float(f["metadata"].attrs["format_id"]) >= 3.0
        assert isinstance(f["points"], h5py.Group)
        f.move("video0", "video2")
        videos = [json.loads(v) for v in f["videos_json"][:]]
        videos[0]["backend"]["dataset"] = "video2/video"
        del f["videos_json"]
        f.create_dataset(
            "videos_json", data=[json.dumps(v) for v in videos], maxshape=(None,)
        )
        assert f["frames/video"][()].tolist() == [0]
    check = sio.load_slp(str(path))
    assert check.videos[0].backend.dataset == "video2/video"
    assert check.videos[0].backend.get_frame(0).shape[:2] == (384, 384)
    print(f"{path.name}: format_id 3, embedded under /video2 at index 0")


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

    make_metadata_fixture(HERE / "format3_metadata.slp")
    make_defaults_fixture(HERE / "format3_defaults.slp")
    make_bad_frame_id_fixture(HERE / "format3_bad_frame_id.slp")
    make_events_fixture(HERE / "format3_events.slp")
    make_embedded_fixture(HERE / "format3_embedded.pkg.slp")

    for name in (
        "format3_pose.slp",
        "format3_pose.v2.slp",
        "format3_unlabeled.slp",
        "format3_metadata.slp",
        "format3_defaults.slp",
        "format3_embedded.pkg.slp",
    ):
        check = sio.load_slp(str(HERE / name))
        print(
            f"  {name}: {len(check)} frames, "
            f"{sum(len(lf.instances) for lf in check)} instances, "
            f"negative {[lf.frame_idx for lf in check if lf.is_negative]}"
        )
    # Every file this script writes is public: none may name this machine.
    for name in WRITTEN:
        assert_no_machine_paths(HERE / name)
    print(f"no machine paths in the {len(WRITTEN)} fixtures")
    print("sleap-io", sio.__version__)


#: Every fixture this script writes.
WRITTEN = (
    "format3_pose.slp",
    "format3_pose.v2.slp",
    "format3_unlabeled.slp",
    "format3_rois_stub.slp",
    "format3_metadata.slp",
    "format3_defaults.slp",
    "format3_bad_frame_id.slp",
    "format3_events.slp",
    "format3_embedded.pkg.slp",
)


if __name__ == "__main__":
    main()
