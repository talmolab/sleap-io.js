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
      x1: 0, y1: 20, x2: 100, y2: 100,
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

      expectFixedString(file.get("rois"), "field_names");

      // v1.9+: string metadata stored as root-level datasets with "json" attribute
      expectFixedString(file.get("roi_categories"), "json");
      expectFixedString(file.get("roi_names"), "json");
      expectFixedString(file.get("roi_sources"), "json");
      expectFixedString(file.get("mask_categories"), "json");
      expectFixedString(file.get("mask_names"), "json");
      expectFixedString(file.get("mask_sources"), "json");

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
      expect(metadata.skeletons[0].graph.name).toBe("test");
      expect(metadata.skeletons[0].nodes).toHaveLength(3);
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

  it("Python can decode metadata and skeletons from JS-written SLP", async () => {
    const skeleton = new Skeleton({ name: "fly", nodes: ["head", "thorax", "abdomen"] });
    skeleton.addEdge("head", "thorax");
    skeleton.addEdge("thorax", "abdomen");
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

      // Test metadata reading (#76) and skeleton decoding (format fix).
      // Full sio.load_slp() not yet supported because JS writes flat <f8
      // matrices (no compound dtype), so Python gets float indices for the
      // instances dataset. h5wasm doesn't support compound dtype creation.
      const pyScript = `
import h5py, json
from sleap_io.io.slp import read_metadata, read_skeletons

# Test 1: metadata reads without .decode() error (issue #76)
md = read_metadata("${slpPath}")
assert "version" in md, f"Missing version in metadata"
assert len(md["skeletons"]) == 1, f"Expected 1 skeleton, got {len(md['skeletons'])}"
assert len(md["nodes"]) == 3, f"Expected 3 nodes, got {len(md['nodes'])}"

# Test 2: skeletons decode correctly (format fix)
skeletons = read_skeletons("${slpPath}")
assert len(skeletons) == 1, f"Expected 1 skeleton, got {len(skeletons)}"
skel = skeletons[0]
assert skel.name == "fly", f"Expected name 'fly', got '{skel.name}'"
assert len(skel.nodes) == 3, f"Expected 3 nodes, got {len(skel.nodes)}"
node_names = [n.name for n in skel.nodes]
assert node_names == ["head", "thorax", "abdomen"], f"Wrong nodes: {node_names}"
assert len(skel.edges) == 2, f"Expected 2 edges, got {len(skel.edges)}"

print("OK: Python reads metadata and skeletons from JS-written SLP")
`;
      const result = execSync(`uv run --with sleap-io python -c '${pyScript}'`, {
        encoding: "utf-8",
        timeout: 30000,
      });
      expect(result).toContain("OK: Python reads metadata and skeletons from JS-written SLP");
    } finally {
      try { unlinkSync(slpPath); } catch {}
    }
  });
});
