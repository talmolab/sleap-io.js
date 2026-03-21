/* @vitest-environment node */
/**
 * Generate SLP test files and verify Python sleap-io can read them.
 * This test creates temporary .slp files written by JS, then invokes
 * Python sleap-io to read them back, verifying cross-language compatibility.
 */
import { describe, it, expect } from "vitest";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { Labels } from "../src/model/labels.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Instance } from "../src/model/instance.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { ROI } from "../src/model/roi.js";
import { SegmentationMask } from "../src/model/mask.js";
import { UserBoundingBox } from "../src/model/bbox.js";
import { Track } from "../src/model/instance.js";
import { ready, File as H5File } from "h5wasm/node";
import { writeFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

function hasUv(): boolean {
  try {
    execSync("uv --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tmpSlp(): string {
  return join(tmpdir(), `sleap-io-js-test-${Date.now()}-${Math.random().toString(16).slice(2)}.slp`);
}

describe("Python compatibility (#76)", () => {
  it("all string attributes are fixed-length strings (not vlen)", async () => {
    const skeleton = new Skeleton({ name: "fly", nodes: ["head", "thorax"] });
    const video = new Video({ filename: "test.mp4" });
    const track = new Track("track0");
    const inst = new Instance({
      skeleton,
      points: [
        { xy: [100, 200], visible: true, complete: true },
        { xy: [150, 250], visible: true, complete: true },
      ],
    });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const roi = ROI.fromBbox(10, 20, 100, 200, {
      name: "roi1", category: "arena", source: "manual", video, track,
    });

    const maskData = new Uint8Array(10 * 10);
    maskData[0] = 1; maskData[1] = 1;
    const mask = SegmentationMask.fromArray(maskData, 10, 10, {
      name: "mask1", category: "cell", source: "model", video, frameIdx: 0,
    });

    const bbox = new UserBoundingBox({
      xCenter: 50, yCenter: 60, width: 100, height: 80,
      video, frameIdx: 0, track, category: "animal", name: "bb1", source: "manual",
    });

    const labels = new Labels({
      skeletons: [skeleton],
      videos: [video],
      labeledFrames: [frame],
      tracks: [track],
      rois: [roi],
      masks: [mask],
      bboxes: [bbox],
    });

    const bytes = await saveSlpToBytes(labels);

    // Verify ALL string attributes are fixed-length H5T_STRING (not vlen).
    // h5py reads fixed-length strings as `bytes` (has .decode()), but
    // vlen strings as `str` (no .decode()) — this is what caused #76.
    const module = await ready;
    const memPath = `/tmp/attr_check_${Date.now()}.slp`;
    module.FS.writeFile(memPath, bytes);
    const file = new H5File(memPath, "r");

    function expectFixedString(ds: any, attrName: string) {
      const attr = ds.attrs[attrName];
      expect(attr.metadata.type, `${ds.path}@${attrName} should be H5T_STRING`).toBe(3);
      expect(attr.metadata.vlen, `${ds.path}@${attrName} should not be vlen`).toBe(false);
    }

    try {
      expectFixedString(file.get("metadata"), "json");
      expectFixedString(file.get("frames"), "field_names");
      expectFixedString(file.get("instances"), "field_names");
      expectFixedString(file.get("points"), "field_names");

      expectFixedString(file.get("rois"), "categories");
      expectFixedString(file.get("rois"), "names");
      expectFixedString(file.get("rois"), "sources");
      expectFixedString(file.get("rois"), "field_names");

      expectFixedString(file.get("masks"), "categories");
      expectFixedString(file.get("masks"), "names");
      expectFixedString(file.get("masks"), "sources");

      expectFixedString(file.get("bboxes"), "categories");
      expectFixedString(file.get("bboxes"), "names");
      expectFixedString(file.get("bboxes"), "sources");
    } finally {
      file.close();
      module.FS.unlink(memPath);
    }
  });

  it("metadata JSON attribute decodes to valid metadata", async () => {
    const skeleton = new Skeleton({ name: "test", nodes: ["A", "B", "C"] });
    skeleton.addEdge("A", "B");
    const video = new Video({ filename: "video.mp4" });
    const track = new Track("animal1");
    const inst = new Instance({
      skeleton,
      points: [
        { xy: [10, 20], visible: true, complete: true },
        { xy: [30, 40], visible: true, complete: true },
        { xy: [50, 60], visible: false, complete: false },
      ],
      track,
    });
    const frame = new LabeledFrame({ video, frameIdx: 5, instances: [inst] });
    const labels = new Labels({
      skeletons: [skeleton],
      videos: [video],
      labeledFrames: [frame],
      tracks: [track],
    });

    const bytes = await saveSlpToBytes(labels);
    const module = await ready;
    const memPath = `/tmp/metadata_check_${Date.now()}.slp`;
    module.FS.writeFile(memPath, bytes);
    const file = new H5File(memPath, "r");
    try {
      const md = file.get("metadata") as any;
      const jsonAttr = md.attrs["json"];
      // Fixed-length string: h5py reads as bytes, h5wasm reads as string
      expect(jsonAttr.metadata.type).toBe(3); // H5T_STRING
      expect(jsonAttr.metadata.vlen).toBe(false);

      const metadata = JSON.parse(jsonAttr.value);
      expect(metadata.version).toBeDefined();
      expect(metadata.skeletons).toHaveLength(1);
      expect(metadata.skeletons[0].name).toBe("test");
      expect(metadata.nodes).toHaveLength(3);
    } finally {
      file.close();
      module.FS.unlink(memPath);
    }
  });

  it("field_names attribute decodes to correct column names", async () => {
    const skeleton = new Skeleton({ name: "s", nodes: ["A"] });
    const video = new Video({ filename: "v.mp4" });
    const inst = new Instance({
      skeleton,
      points: [{ xy: [1, 2], visible: true, complete: true }],
    });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      skeletons: [skeleton],
      videos: [video],
      labeledFrames: [frame],
    });

    const bytes = await saveSlpToBytes(labels);
    const module = await ready;
    const memPath = `/tmp/fieldnames_check_${Date.now()}.slp`;
    module.FS.writeFile(memPath, bytes);
    const file = new H5File(memPath, "r");
    try {
      const frames = file.get("frames") as any;
      const frameFields = JSON.parse(frames.attrs["field_names"].value);
      expect(frameFields).toEqual(["frame_id", "video", "frame_idx", "instance_id_start", "instance_id_end"]);

      const instances = file.get("instances") as any;
      const instFields = JSON.parse(instances.attrs["field_names"].value);
      expect(instFields).toContain("instance_id");
      expect(instFields).toContain("skeleton");
      expect(instFields).toContain("track");

      const points = file.get("points") as any;
      const pointFields = JSON.parse(points.attrs["field_names"].value);
      expect(pointFields).toEqual(["x", "y", "visible", "complete"]);
    } finally {
      file.close();
      module.FS.unlink(memPath);
    }
  });

  it.skipIf(!hasUv())("Python h5py reads fixed-length string attrs as bytes with .decode()", async () => {
    // This directly tests the fix for #76: the metadata JSON attribute
    // must be readable by Python's `json.loads(md.decode())` pattern.
    const skeleton = new Skeleton({ name: "fly", nodes: ["head", "thorax", "abdomen"] });
    const video = new Video({ filename: "test.mp4" });
    const inst = new Instance({
      skeleton,
      points: [
        { xy: [100, 200], visible: true, complete: true },
        { xy: [150, 250], visible: true, complete: true },
        { xy: [200, 300], visible: true, complete: true },
      ],
    });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      skeletons: [skeleton],
      videos: [video],
      labeledFrames: [frame],
    });

    const bytes = await saveSlpToBytes(labels);
    const slpPath = tmpSlp();

    try {
      writeFileSync(slpPath, bytes);

      // Use h5py directly to verify the attribute type and .decode() behavior.
      // This is the exact pattern that Python sleap-io uses in read_metadata().
      const pyScript = `
import h5py, json
with h5py.File("${slpPath}", "r") as f:
    md = f["metadata"].attrs["json"]
    assert isinstance(md, (bytes, type(md))), f"Expected bytes-like, got {type(md)}"
    assert hasattr(md, "decode"), f"Attribute must have .decode() method, got {type(md)}"
    parsed = json.loads(md.decode())
    assert "version" in parsed, f"Missing 'version' key in metadata"
    assert "skeletons" in parsed, f"Missing 'skeletons' key in metadata"
    assert len(parsed["skeletons"]) == 1, f"Expected 1 skeleton, got {len(parsed['skeletons'])}"
    assert len(parsed["nodes"]) == 3, f"Expected 3 nodes, got {len(parsed['nodes'])}"
    print("OK: Python h5py reads metadata as bytes with working .decode()")
`;
      const result = execSync(`uv run --with sleap-io python -c '${pyScript}'`, {
        encoding: "utf-8",
        timeout: 30000,
      });
      expect(result).toContain("OK: Python h5py reads metadata as bytes with working .decode()");
    } finally {
      try { unlinkSync(slpPath); } catch {}
    }
  });
});
