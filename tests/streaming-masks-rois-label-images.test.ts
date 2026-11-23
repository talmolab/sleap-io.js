/**
 * The streaming reader (what `loadSlp` uses in a browser or Tauri WebView) reads
 * segmentation masks, ROIs (frame-bound and static) and label images exactly as
 * the eager reader does, including score maps, `fromPredicted`, spatial
 * transforms, instance links and per-detection identity / category links.
 *
 * Before, it skipped all three, so opening such a file in sleap-app dropped them
 * and a later save erased them from the file.
 *
 * `py_written_masks_rois_label_images.slp` was written by Python sleap-io 0.9.3:
 * frame 0 has two tracked instances; a predicted mask (score 0.75, 8x8 score
 * map, track t1) and its accepted user copy (`to_user()`, linked to instance 0,
 * identity "mouse_A" @ 0.9); a half-resolution mask (scale 0.5, offset (1, 2),
 * category "mouse"); a user ROI linked to instance 1 and a predicted ROI
 * (score 0.6); and a label image with two objects (tracks t0/t1, categories
 * "cell"/"débris", object 1 linked to instance 0). Frame 3 has only a mask.
 * A static "arena" ROI is bound to the video.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import type { Labels } from "../src/model/labels.js";
import type { LabeledFrame } from "../src/model/labeled-frame.js";
import type { SegmentationMask } from "../src/model/mask.js";
import type { ROI } from "../src/model/roi.js";
import type { LabelImage } from "../src/model/label-image.js";
import { readStreamingBytes } from "./fake-streaming-file";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const PY_FIXTURE = path.join(
  fileURLToPath(new URL("./data", import.meta.url)),
  "slp",
  "py_written_masks_rois_label_images.slp",
);

function fixtureBytes(): ArrayBuffer {
  return new Uint8Array(readFileSync(PY_FIXTURE)).buffer as ArrayBuffer;
}

/** Everything about a project's masks / ROIs / label images, comparable. */
function annotationSig(labels: Labels) {
  if (labels.isLazy) labels.materialize();
  const instIdx = (lf: LabeledFrame, inst: unknown) =>
    inst ? lf.instances.indexOf(inst as never) : null;
  const frames = [...labels.labeledFrames]
    .filter((lf) => lf.masks.length || lf.rois.length || lf.labelImages.length)
    .sort((a, b) => a.frameIdx - b.frameIdx)
    .map((lf) => ({
      frameIdx: lf.frameIdx,
      masks: lf.masks.map((m: SegmentationMask) => ({
        type: m.constructor.name,
        category: m.category,
        name: m.name,
        source: m.source,
        track: m.track?.name ?? null,
        instance: instIdx(lf, m.instance),
        identity: m.identity?.name ?? null,
        identityScore: m.identityScore ?? null,
        size: [m.height, m.width],
        area: m.area,
        scale: m.scale,
        offset: m.offset,
        score: "score" in m ? m.score : null,
        scoreMapSum:
          "scoreMap" in m && m.scoreMap
            ? Math.round(
                (m.scoreMap as Float32Array).reduce((a, b) => a + b, 0) * 1000,
              )
            : null,
        fromPredicted:
          "fromPredicted" in m && m.fromPredicted
            ? lf.masks.indexOf(m.fromPredicted as SegmentationMask)
            : null,
      })),
      rois: lf.rois.map((r: ROI) => ({
        type: r.constructor.name,
        category: r.category,
        name: r.name,
        instance: instIdx(lf, r.instance),
        geometry: r.geometry,
        score: "score" in r ? r.score : null,
      })),
      labelImages: lf.labelImages.map((li: LabelImage) => ({
        type: li.constructor.name,
        source: li.source,
        size: [li.height, li.width],
        dataSum: li.data.reduce((a, b) => a + b, 0),
        objects: [...li.objects.entries()].map(([id, o]) => ({
          id,
          track: o.track?.name ?? null,
          category: o.category,
          instance: instIdx(lf, o.instance),
        })),
      })),
    }));
  const staticRois = labels.staticRois.map((r) => ({
    category: r.category,
    hasVideo: r.video != null,
    geometry: r.geometry,
  }));
  return { frames, staticRois };
}

describe("streaming reader: masks, ROIs and label images", () => {
  it("reads the Python fixture with everything the eager reader sees", async () => {
    const eager = annotationSig(
      await readSlp(fixtureBytes(), { openVideos: false }),
    );
    // Guard: the fixture really carries what this test is about.
    const f0 = eager.frames[0];
    expect(eager.frames.map((f) => f.frameIdx)).toEqual([0, 3]);
    expect(f0.masks.map((m) => m.type)).toEqual([
      "PredictedSegmentationMask",
      "UserSegmentationMask",
      "UserSegmentationMask",
    ]);
    expect(f0.masks[0].scoreMapSum).not.toBeNull();
    expect(f0.masks[1].fromPredicted).toBe(0);
    expect(f0.masks[1].instance).toBe(0);
    expect(f0.masks[1].identity).toBe("mouse_A");
    expect(f0.masks[2].scale).toEqual([0.5, 0.5]);
    expect(f0.rois.map((r) => r.instance)).toEqual([1, null]);
    expect(f0.labelImages[0].objects.map((o) => o.instance)).toEqual([0, null]);
    expect(f0.labelImages[0].objects.map((o) => o.category)).toEqual([
      "cell",
      "débris",
    ]);
    expect(eager.staticRois).toHaveLength(1);

    for (const lazy of [false, true]) {
      const streamed = await readStreamingBytes(fixtureBytes(), lazy);
      expect(annotationSig(streamed)).toEqual(eager);
    }
  });

  it("reads a JS-written file the same way (re-save of the fixture)", async () => {
    const loaded = await readSlp(fixtureBytes(), { openVideos: false });
    const buf = new Uint8Array(await saveSlpToBytes(loaded))
      .buffer as ArrayBuffer;
    const eager = annotationSig(await readSlp(buf, { openVideos: false }));
    expect(eager).toEqual(annotationSig(loaded));
    for (const lazy of [false, true]) {
      expect(annotationSig(await readStreamingBytes(buf, lazy))).toEqual(eager);
    }
  });

  it("a streamed project re-saves without losing them", async () => {
    const eager = annotationSig(
      await readSlp(fixtureBytes(), { openVideos: false }),
    );
    const streamed = await readStreamingBytes(fixtureBytes(), false);
    const resaved = new Uint8Array(await saveSlpToBytes(streamed))
      .buffer as ArrayBuffer;
    expect(
      annotationSig(await readSlp(resaved, { openVideos: false })),
    ).toEqual(eager);
  });
});
