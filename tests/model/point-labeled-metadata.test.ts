/**
 * The `labeled` flag on points and per-record metadata on instances, labeled
 * frames and bounding boxes (the model side of SLP format 3.0).
 */
import { describe, it, expect } from "../bun-test";
import {
  Instance,
  PredictedInstance,
  clonePoint,
} from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Labels } from "../../src/model/labels.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { UserBoundingBox } from "../../src/model/bbox.js";

describe("the labeled flag in the model", () => {
  const skeleton = new Skeleton({ nodes: ["a", "b", "c"] });

  it("costs nothing until a point is marked unlabelled", () => {
    const inst = Instance.empty({ skeleton });
    expect(inst._labeled).toBeNull();
    expect(inst.points.every((p) => p.labeled)).toBe(true);
    inst.points[1].labeled = true;
    expect(inst._labeled).toBeNull();
    inst.points[1].labeled = false;
    expect(Array.from(inst._labeled!)).toEqual([1, 0, 1]);
    expect(inst.nUnlabeled).toBe(1);
    // Making a point visible leaves the stored flag, but a visible point
    // counts as labelled, as Python sleap-io writes it (`labeled | visible`).
    inst.points[1].visible = true;
    expect(inst._labeled![1]).toBe(0);
    expect(inst.points[1].labeled).toBe(true);
    expect(inst.nUnlabeled).toBe(0);
    inst.points[1].visible = false;
    expect(inst.points[1].labeled).toBe(false);
  });

  it("is carried by clonePoint and the points setter", () => {
    const inst = Instance.empty({ skeleton });
    inst.points[2].labeled = false;
    const cloned = inst.points.map((p) => clonePoint(p));
    expect(cloned.map((p) => p.labeled)).toEqual([undefined, undefined, false]);
    const other = new Instance({ points: cloned, skeleton });
    expect(other.points.map((p) => p.labeled)).toEqual([true, true, false]);
    const views = other.points;
    other.points = views; // re-ingest through the views
    expect(other.points[2].labeled).toBe(false);
    const pred = new PredictedInstance({
      points: cloned.map((p) => ({ ...p, score: 0.5 })),
      skeleton,
      metadata: { m: 1 },
    });
    expect(pred.points[2].labeled).toBe(false);
    expect(pred.metadata).toEqual({ m: 1 });
  });
});

describe("record metadata", () => {
  const skeleton = new Skeleton({ nodes: ["a", "b"] });
  const video = new Video({ filename: "clip.mp4" });
  const make = () => {
    const inst = Instance.empty({ skeleton });
    inst.metadata.who = "me";
    inst.points[1].labeled = false;
    const box = new UserBoundingBox({
      x1: 0,
      y1: 0,
      x2: 2,
      y2: 2,
      metadata: { k: 1 },
    });
    const frame = new LabeledFrame({
      video,
      frameIdx: 3,
      instances: [inst],
      bboxes: [box],
      metadata: { flag: true },
    });
    return new Labels({ labeledFrames: [frame], videos: [video] });
  };

  it("defaults to an empty dictionary", () => {
    expect(Instance.empty({ skeleton }).metadata).toEqual({});
    expect(new LabeledFrame({ video, frameIdx: 0 }).metadata).toEqual({});
    expect(
      new UserBoundingBox({ x1: 0, y1: 0, x2: 1, y2: 1 }).metadata,
    ).toEqual({});
  });

  it("is copied, not shared, by copy and extract", () => {
    const labels = make();
    for (const copy of [labels.copy(), labels.extract([0])]) {
      const frame = copy.labeledFrames[0];
      expect(frame.metadata).toEqual({ flag: true });
      expect(frame.instances[0].metadata).toEqual({ who: "me" });
      expect(frame.instances[0].points[1].labeled).toBe(false);
      expect(frame.bboxes[0].metadata).toEqual({ k: 1 });
      frame.metadata.flag = false;
      frame.instances[0].metadata.who = "you";
      frame.bboxes[0].metadata.k = 2;
    }
    const frame = labels.labeledFrames[0];
    expect(frame.metadata).toEqual({ flag: true });
    expect(frame.instances[0].metadata).toEqual({ who: "me" });
    expect(frame.bboxes[0].metadata).toEqual({ k: 1 });
  });

  it("is merged key by key, this frame winning", async () => {
    const target = make();
    const source = make();
    source.labeledFrames[0].metadata = { flag: false, extra: "x" };
    await target.merge(source);
    expect(target.labeledFrames[0].metadata).toEqual({
      flag: true,
      extra: "x",
    });
  });

  it("gives boxes merged into another frame their own dictionary", () => {
    const source = make().labeledFrames[0];
    const target = new LabeledFrame({ video, frameIdx: 3 });
    target.merge(source, { frame: "keep_both" });
    const merged = target.bboxes[0];
    expect(merged).not.toBe(source.bboxes[0]);
    expect(merged.metadata).toEqual({ k: 1 });
    merged.metadata.k = 2;
    expect(source.bboxes[0].metadata).toEqual({ k: 1 });
  });

  it("is kept by BoundingBox.pad", () => {
    const box = new UserBoundingBox({
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      metadata: { k: 1 },
    });
    expect(box.pad(1).metadata).toEqual({ k: 1 });
  });
});
