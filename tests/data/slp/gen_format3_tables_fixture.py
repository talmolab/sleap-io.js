"""Generate the SLP format 3.0 fixtures of the tables other than the pose tables.

Format 3.0 stores every table as a group with one dataset per column. Besides
the pose tables (see `gen_format3_pose_fixture.py`) these are `/rois`,
`/masks` (with `score_maps/`), `/label_images` (with `objects/` and
`score_maps/`), `/identity/links`, `/categories/links` and the
`/session_data` tables (`frame_groups`, `instance_groups`,
`instance_group_members`). This script writes these small synthetic files next
to itself:

- `format3_tables.slp`: format 3.0 with all of those tables. Three videos seen
  by the three cameras of a recording session, two tracks, two identities and
  two categories; user and predicted ROIs (in frames and static, one with no
  video), user and predicted masks (a score map, a user mask corrected from a
  prediction, scale and offset), user and predicted label images of one size
  (so the pixel data is a `(T, H, W)` array) with objects and a score map,
  identity and category links on instances, centroids, masks, boxes and ROIs,
  and frame groups with user and predicted 3D points, identities and metadata.
- `format3_tables.v2.slp`: the same labels in the 2.x layout. Every reader must
  give the same result for both files.
- `format3_label_images_blob.slp` and `format3_label_images_blob.v2.slp`:
  label images of two sizes, so the pixel data is a flat buffer of compressed
  frames, in both layouts.
- `format3_tables_unknown.slp`: `format3_tables.slp` with a column this reader
  does not know (`extra`) added to each of those tables.
- `format3_tables_defaults.slp`: `format3_tables.slp` without the optional
  columns of `/rois`, `/masks`, `/label_images` and their sub-tables, so every
  reader falls back to the defaults of the 3.0 reading rules.

The committed fixtures were written with Python sleap-io 0.10.0 from the
`release/0.10` branch (commit fe4f91c7b), which is not on PyPI yet:

    uv run --with "sleap-io @ git+https://github.com/talmolab/sleap-io@fe4f91c7b" \
        python tests/data/slp/gen_format3_tables_fixture.py

The script asks for each layout explicitly and stops if a file on disk is not
in the layout it asked for, or if any fixture stores a path of this machine.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import h5py
import numpy as np
import sleap_io as sio

from gen_format3_pose_fixture import assert_no_machine_paths, repack

HERE = Path(__file__).parent

#: Where each table is stored in format 3.0 (a group of columns) and in 2.x (a
#: dataset), for the tables this script covers.
TABLES = {
    "rois": "rois",
    "masks": "masks",
    "masks/score_maps": "mask_score_map_index",
    "label_images": "label_images",
    "label_images/objects": "label_image_objects",
    "label_images/score_maps": "label_image_score_map_index",
    "identity/links": "identity/links",
    "categories/links": "categories/links",
    "session_data/frame_groups": "session_data/frame_groups",
    "session_data/instance_groups": "session_data/instance_groups",
    "session_data/instance_group_members": "session_data/instance_group_members",
}


def save_as(labels: sio.Labels, name: str, layout: str) -> None:
    """Save `labels` next to this script in the "v2" or "v3" layout and check it.

    The save runs from this directory with a relative file name, so nothing it
    records names the machine.
    """
    cwd = Path.cwd()
    os.chdir(HERE)
    try:
        sio.save_slp(labels, name, legacy_format=(layout == "v2"))
    finally:
        os.chdir(cwd)
    path = HERE / name
    with h5py.File(path, "r") as f:
        format_id = float(f["metadata"].attrs["format_id"])
        layouts = {}
        for table, legacy in TABLES.items():
            if table in f:
                layouts[table] = "group" if isinstance(f[table], h5py.Group) else "dataset"
            elif legacy in f:
                layouts[table] = "legacy dataset"
    if layout == "v3":
        assert format_id >= 3.0, format_id
        assert all(v == "group" for v in layouts.values()), layouts
    else:
        assert format_id < 3.0, format_id
        assert all(v != "group" for v in layouts.values()), layouts
    print(f"{name}: format_id {format_id:g}, {sorted(layouts)}")


def make_labels(*, blob: bool = False) -> sio.Labels:
    """The labels of `format3_tables.slp` (or, with `blob`, of the blob files)."""
    skeleton = sio.Skeleton(
        nodes=["head", "body", "tail"], edges=[("head", "body"), ("body", "tail")]
    )
    videos = [
        sio.Video(filename=f"cam{i}.mp4", open_backend=False) for i in range(3)
    ]
    tracks = [sio.Track(name="a"), sio.Track(name="b")]
    mouse_a = sio.Identity(name="mouse_A", metadata={"color": "#e6194b"})
    mouse_b = sio.Identity(name="mouse_B")
    female = sio.Category(name="female")
    male = sio.Category(name="male", metadata={"note": "class"})

    def pts(offset: float) -> np.ndarray:
        return np.array([[10, 20], [30, 40], [50, 60]], dtype=float) + offset

    def user(offset, track=None, **kwargs):
        return sio.Instance.from_numpy(
            pts(offset), skeleton=skeleton, track=track, **kwargs
        )

    def predicted(offset, score, track=None, **kwargs):
        return sio.PredictedInstance.from_numpy(
            pts(offset),
            skeleton=skeleton,
            point_scores=np.array([0.9, 0.8, 0.7]),
            score=score,
            track=track,
            **kwargs,
        )

    u00 = user(0, tracks[0])
    u00.identity, u00.identity_score = mouse_a, 0.875
    u00.category, u00.category_score = female, 0.75
    p00 = predicted(1, 0.5, tracks[1])
    p00.identity = mouse_b
    p00.category = male
    u10 = user(2, tracks[0])
    p10 = predicted(3, 0.25, tracks[1])
    u20 = user(4, tracks[0])
    p01 = predicted(5, 0.625, tracks[0])
    p11 = predicted(6, 0.375, tracks[0])
    p21 = predicted(7, 0.125, tracks[0])

    lf00 = sio.LabeledFrame(video=videos[0], frame_idx=0, instances=[u00, p00])
    lf10 = sio.LabeledFrame(video=videos[1], frame_idx=0, instances=[u10, p10])
    lf20 = sio.LabeledFrame(video=videos[2], frame_idx=0, instances=[u20])
    lf01 = sio.LabeledFrame(video=videos[0], frame_idx=1, instances=[p01])
    lf11 = sio.LabeledFrame(video=videos[1], frame_idx=1, instances=[p11])
    lf21 = sio.LabeledFrame(video=videos[2], frame_idx=1, instances=[p21])
    frames = [lf00, lf10, lf20, lf01, lf11, lf21]

    if blob:
        # Label images of two sizes: the pixel data is a flat buffer.
        small = np.zeros((4, 6), dtype=np.int32)
        small[1:3, 1:4] = 1
        large = np.zeros((5, 7), dtype=np.int32)
        large[2:4, 2:6] = 2
        lf00.label_images.append(
            sio.UserLabelImage(
                data=small,
                objects={1: sio.LabelImage.Info(track=tracks[0], name="one")},
                source="manual",
            )
        )
        lf10.label_images.append(
            sio.PredictedLabelImage(
                data=large,
                objects={2: sio.LabelImage.Info(instance=p10, score=0.5)},
                score=0.75,
                score_map=np.linspace(0, 1, 35, dtype=np.float32).reshape(5, 7),
            )
        )
        return sio.Labels(
            labeled_frames=frames, videos=videos, skeletons=[skeleton], tracks=tracks
        )

    # ROIs: one in a frame (user, linked to an instance and a track, with an
    # identity and a category), one predicted, and two static ones.
    roi_user = sio.UserROI.from_polygon(
        [(1, 1), (9, 1), (9, 7), (1, 7)],
        name="nest",
        category="zone",
        source="manual",
        video=videos[0],
        track=tracks[0],
        tracking_score=0.25,
        instance=u00,
    )
    roi_user.identity, roi_user.identity_score = mouse_a, 0.5
    lf00.rois.append(roi_user)
    roi_pred = sio.PredictedROI.from_polygon(
        [(2, 2), (8, 2), (5, 6)], score=0.625, video=videos[1], source="model"
    )
    roi_pred.category = male
    lf10.rois.append(roi_pred)
    static = [
        sio.UserROI.from_polygon(
            [(0, 0), (20, 0), (20, 20), (0, 20)], name="arena", video=videos[0]
        ),
        sio.UserROI.from_polygon([(3, 3), (4, 3), (4, 4)], name="no video"),
    ]

    # Masks: a prediction with a score map, the user mask corrected from it,
    # and a mask on another frame.
    raster = np.zeros((6, 8), dtype=bool)
    raster[1:4, 2:6] = True
    mask_pred = sio.PredictedSegmentationMask.from_numpy(
        raster,
        score=0.75,
        score_map=np.linspace(0, 1, 48, dtype=np.float32).reshape(6, 8),
        track=tracks[1],
        instance=p00,
        name="pm",
        category="body",
        source="model",
        scale=(2.0, 2.0),
        offset=(1.0, 0.5),
    )
    mask_user = sio.UserSegmentationMask.from_numpy(
        raster, instance=u00, track=tracks[0], tracking_score=0.5
    )
    mask_user.from_predicted = mask_pred
    mask_user.identity, mask_user.identity_score = mouse_a, 0.25
    mask_user.category = female
    lf00.masks.extend([mask_pred, mask_user])
    other = np.zeros((6, 8), dtype=bool)
    other[0, 0] = True
    lf11.masks.append(sio.UserSegmentationMask.from_numpy(other, name="dot"))

    # Label images of one size: the pixel data is a (T, H, W) array.
    image = np.zeros((6, 8), dtype=np.int32)
    image[0:2, 0:3] = 1
    image[3:5, 4:7] = 2
    lf00.label_images.append(
        sio.UserLabelImage(
            data=image,
            objects={
                1: sio.LabelImage.Info(
                    track=tracks[0],
                    tracking_score=0.375,
                    category="female",
                    name="one",
                    instance=u00,
                    score=0.875,
                ),
                2: sio.LabelImage.Info(track=tracks[1], name="two", instance=p00),
            },
            source="manual",
            scale=(0.5, 0.5),
            offset=(2.0, 3.0),
        )
    )
    image2 = np.zeros((6, 8), dtype=np.int32)
    image2[2:5, 1:4] = 3
    lf10.label_images.append(
        sio.PredictedLabelImage(
            data=image2,
            objects={3: sio.LabelImage.Info(instance=p10, category="male")},
            score=0.5,
            score_map=np.linspace(1, 0, 48, dtype=np.float32).reshape(6, 8),
            source="model",
        )
    )

    # A centroid and a box, so links of every owner kind are written.
    centroid = sio.UserCentroid(x=5.0, y=6.0, track=tracks[1], instance=p00)
    centroid.identity, centroid.category = mouse_b, male
    lf00.centroids.append(centroid)
    box = sio.UserBoundingBox(x1=1.0, y1=2.0, x2=8.0, y2=9.0, instance=u00)
    box.identity, box.identity_score = mouse_a, 0.125
    box.category, box.category_score = female, 0.375
    lf00.bboxes.append(box)

    # A recording session of three cameras, one per video.
    cameras = [
        sio.Camera(
            name=f"cam{i}",
            size=(48, 64),
            matrix=np.array([[100.0, 0, 32], [0, 100.0, 24], [0, 0, 1]]),
            dist=np.array([0.01 * i, 0, 0, 0, 0]),
            rvec=np.array([0.0, 0.1 * i, 0.0]),
            tvec=np.array([10.0 * i, 0.0, 0.0]),
        )
        for i in range(3)
    ]
    session = sio.RecordingSession(
        camera_group=sio.CameraGroup(cameras=cameras), metadata={"rig": "three"}
    )
    for camera, video in zip(cameras, videos):
        session.add_video(video, camera)
    by_camera0 = dict(zip(cameras, [lf00, lf10, lf20]))
    by_camera1 = dict(zip(cameras, [lf01, lf11, lf21]))
    points3d = np.array([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0], [np.nan] * 3])
    group0 = sio.InstanceGroup(
        instance_by_camera=dict(zip(cameras, [u00, u10, u20])),
        score=0.9375,
        instance_3d=sio.Instance3D(points=points3d, skeleton=skeleton, score=0.8125),
        identity=mouse_a,
        metadata={"tag": "first"},
    )
    group1 = sio.InstanceGroup(instance_by_camera={cameras[0]: p00, cameras[1]: p10})
    group2 = sio.InstanceGroup(
        instance_by_camera=dict(zip(cameras, [p01, p11, p21])),
        instance_3d=sio.PredictedInstance3D(
            points=points3d + 10,
            skeleton=skeleton,
            score=0.6875,
            point_scores=np.array([0.5, 0.25, np.nan]),
        ),
        identity=mouse_b,
    )
    session._frame_group_by_frame_idx[0] = sio.FrameGroup(
        frame_idx=0,
        instance_groups=[group0, group1],
        labeled_frame_by_camera=by_camera0,
        metadata={"note": "fg0"},
    )
    session._frame_group_by_frame_idx[1] = sio.FrameGroup(
        frame_idx=1, instance_groups=[group2], labeled_frame_by_camera=by_camera1
    )

    return sio.Labels(
        labeled_frames=frames,
        videos=videos,
        skeletons=[skeleton],
        tracks=tracks,
        identities=[mouse_a, mouse_b],
        categories=[female, male],
        sessions=[session],
        rois=static,
    )


def row_count(f: h5py.File, table: str) -> int:
    """Rows of a table stored as a group of 1-D columns."""
    for name, member in f[table].items():
        if name != BUFFERS.get(table) and isinstance(member, h5py.Dataset):
            return len(member)
    raise ValueError(f"/{table} has no column")


#: The byte buffer of each table that has one (not a column).
BUFFERS = {
    "rois": "wkb",
    "masks": "rle",
    "masks/score_maps": "data",
    "label_images": "data",
    "label_images/score_maps": "data",
}


def make_unknown_fixture(path: Path) -> None:
    """Write `format3_tables_unknown.slp`: an `extra` column in every table."""
    shutil.copyfile(HERE / "format3_tables.slp", path)
    with h5py.File(path, "r+") as f:
        for table in TABLES:
            n = row_count(f, table)
            f[table].create_dataset("extra", data=np.arange(n, dtype=float))


#: The optional columns of each table (Python sleap-io's reading rules).
OPTIONAL = {
    "rois": (
        "annotation_type",
        "instance",
        "is_predicted",
        "score",
        "tracking_score",
        "name",
        "category",
        "source",
    ),
    "masks": (
        "annotation_type",
        "instance",
        "from_predicted",
        "is_predicted",
        "score",
        "tracking_score",
        "scale_x",
        "scale_y",
        "offset_x",
        "offset_y",
        "name",
        "category",
        "source",
    ),
    "masks/score_maps": ("scale_x", "scale_y", "offset_x", "offset_y"),
    "label_images": (
        "is_predicted",
        "score",
        "scale_x",
        "scale_y",
        "offset_x",
        "offset_y",
        "source",
    ),
    "label_images/objects": ("score", "tracking_score", "name", "category"),
    "label_images/score_maps": ("scale_x", "scale_y", "offset_x", "offset_y"),
}


def make_defaults_fixture(path: Path) -> None:
    """Write `format3_tables_defaults.slp`: no optional column in those tables."""
    shutil.copyfile(HERE / "format3_tables.slp", path)
    with h5py.File(path, "r+") as f:
        for table, columns in OPTIONAL.items():
            for column in columns:
                del f[f"{table}/{column}"]
    repack(path)


def main() -> None:
    save_as(make_labels(), "format3_tables.slp", "v3")
    save_as(make_labels(), "format3_tables.v2.slp", "v2")
    save_as(make_labels(blob=True), "format3_label_images_blob.slp", "v3")
    save_as(make_labels(blob=True), "format3_label_images_blob.v2.slp", "v2")
    with h5py.File(HERE / "format3_label_images_blob.slp", "r") as f:
        assert f["label_images/data"].ndim == 1
    with h5py.File(HERE / "format3_tables.slp", "r") as f:
        assert f["label_images/data"].ndim == 3
    make_unknown_fixture(HERE / "format3_tables_unknown.slp")
    make_defaults_fixture(HERE / "format3_tables_defaults.slp")

    for name in WRITTEN:
        check = sio.load_slp(str(HERE / name))
        print(
            f"  {name}: {len(check)} frames, "
            f"{sum(len(lf.instances) for lf in check)} instances, "
            f"{len(check.rois)} ROIs, {len(check.masks)} masks, "
            f"{len(check.label_images)} label images, "
            f"{sum(len(s.frame_groups) for s in check.sessions)} frame groups"
        )
    # Every file this script writes is public: none may name this machine.
    for name in WRITTEN:
        assert_no_machine_paths(HERE / name)
    print(f"no machine paths in the {len(WRITTEN)} fixtures")
    print("sleap-io", sio.__version__)


#: Every fixture this script writes.
WRITTEN = (
    "format3_tables.slp",
    "format3_tables.v2.slp",
    "format3_label_images_blob.slp",
    "format3_label_images_blob.v2.slp",
    "format3_tables_unknown.slp",
    "format3_tables_defaults.slp",
)


if __name__ == "__main__":
    main()
