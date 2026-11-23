/**
 * Per-annotation string lists (`mask_categories` / `mask_names` /
 * `mask_sources`, `roi_*`, `label_image_sources`, `label_image_obj_*`) are
 * written as native variable-length string datasets, which is what Python
 * sleap-io writes and reads (`f["mask_categories"][:]`).
 *
 * They used to be JSON packed into a `<B` byte dataset (plus a `json` attr), so
 * Python read a uint8 array and failed with "category must be a Category, str,
 * or None, got uint8" on any JS-written file with masks, ROIs or label images.
 *
 * `js_written_json_string_datasets.slp` was written by the old layout (sleap-io.js
 * 0.5.17) and must still load.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Video } from "../src/model/video.js";
import { Skeleton } from "../src/model/skeleton.js";
import { UserSegmentationMask } from "../src/model/mask.js";
import { UserROI } from "../src/model/roi.js";
import { UserLabelImage } from "../src/model/label-image.js";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const OLD_LAYOUT = path.join(
  fileURLToPath(new URL("./data", import.meta.url)),
  "slp",
  "js_written_json_string_datasets.slp",
);

const STRING_DATASETS = [
  "mask_categories",
  "mask_names",
  "mask_sources",
  "roi_categories",
  "roi_names",
  "roi_sources",
  "label_image_sources",
  "label_image_obj_categories",
  "label_image_obj_names",
];

function annotatedLabels(): Labels {
  const video = new Video({ filename: "v.mp4" });
  const raster = new Uint8Array(64);
  raster[19] = 1;
  const masks = [
    UserSegmentationMask.fromArray(raster, 8, 8, {
      category: "mouse",
      name: "m1",
      source: "brush",
    }),
    // Empty strings and non-ASCII text must survive as-is.
    UserSegmentationMask.fromArray(raster, 8, 8, { category: "débris" }),
  ];
  const rois = [
    UserROI.fromPolygon(
      [
        [0, 0],
        [4, 0],
        [4, 4],
      ],
      { category: "zone", name: "z1", source: "polygon" },
    ),
  ];
  const labelImage = UserLabelImage.fromArray(
    new Int32Array(64).map((_, i) => (i < 10 ? 1 : i < 20 ? 2 : 0)),
    8,
    8,
    { categories: ["cell", "débris"], source: "cellpose" },
  );
  const lf = new LabeledFrame({
    video,
    frameIdx: 0,
    masks,
    rois,
    labelImages: [labelImage],
  });
  return new Labels({
    labeledFrames: [lf],
    videos: [video],
    skeletons: [new Skeleton({ nodes: ["A"], edges: [] })],
  });
}

function annotationSig(labels: Labels) {
  const lf = labels.labeledFrames[0];
  return {
    masks: lf.masks.map((m) => [m.category, m.name, m.source]),
    rois: lf.rois.map((r) => [r.category, r.name, r.source]),
    labelImages: lf.labelImages.map((li) => ({
      source: li.source,
      objects: [...li.objects.entries()].map(([id, o]) => [
        id,
        o.category,
        o.name,
      ]),
    })),
  };
}

const EXPECTED = {
  masks: [
    ["mouse", "m1", "brush"],
    ["débris", "", ""],
  ],
  rois: [["zone", "z1", "polygon"]],
  labelImages: [
    {
      source: "cellpose",
      objects: [
        [1, "cell", ""],
        [2, "débris", ""],
      ],
    },
  ],
};

async function bytesOf(labels: Labels): Promise<ArrayBuffer> {
  return new Uint8Array(await saveSlpToBytes(labels)).buffer as ArrayBuffer;
}

describe("per-annotation string datasets", () => {
  it("are written as variable-length string datasets (Python layout)", async () => {
    const { file, close } = await openH5File(await bytesOf(annotatedLabels()));
    try {
      for (const name of STRING_DATASETS) {
        const ds = file.get(name) as any;
        expect(ds).not.toBeNull();
        const value = Array.from(ds.value as ArrayLike<unknown>);
        expect(value.every((v) => typeof v === "string")).toBe(true);
      }
      expect(Array.from((file.get("mask_categories") as any).value)).toEqual([
        "mouse",
        "débris",
      ]);
      // The `json` attr stays for older sleap-io.js readers.
      expect((file.get("mask_names") as any).attrs.json).toBeDefined();
    } finally {
      close();
    }
  });

  it("round-trip through the eager and lazy readers", async () => {
    const buf = await bytesOf(annotatedLabels());
    expect(annotationSig(await readSlp(buf, { openVideos: false }))).toEqual(
      EXPECTED,
    );
    const lazy = await readSlpLazy(buf, { openVideos: false });
    lazy.materialize();
    expect(annotationSig(lazy)).toEqual(EXPECTED);
  });

  it("still read files written with the old JSON-bytes layout", async () => {
    const buf = new Uint8Array(readFileSync(OLD_LAYOUT)).buffer as ArrayBuffer;
    const { file, close } = await openH5File(buf);
    try {
      // Guard: the fixture really is the old `<B` layout.
      const value = (file.get("mask_categories") as any).value;
      expect(typeof Array.from(value as ArrayLike<unknown>)[0]).toBe("number");
    } finally {
      close();
    }
    const expectedOld = {
      masks: [["mouse", "m1", "brush"]],
      rois: [["zone", "z1", ""]],
      labelImages: EXPECTED.labelImages,
    };
    expect(annotationSig(await readSlp(buf, { openVideos: false }))).toEqual(
      expectedOld,
    );
    const lazy = await readSlpLazy(buf, { openVideos: false });
    lazy.materialize();
    expect(annotationSig(lazy)).toEqual(expectedOld);
  });
});
