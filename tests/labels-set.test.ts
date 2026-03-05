/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { LabelsSet, Labels, Video, Skeleton, LabeledFrame, Instance } from "../src/index.js";
import { loadSlpSet, saveSlpSet, loadSlp, saveSlp } from "../src/io/main.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

describe("LabelsSet", () => {
  it("creates empty LabelsSet", () => {
    const set = new LabelsSet();
    expect(set.size).toBe(0);
  });

  it("creates from entries", () => {
    const labels1 = new Labels();
    const labels2 = new Labels();
    const set = new LabelsSet({ train: labels1, val: labels2 });
    expect(set.size).toBe(2);
    expect(set.get("train")).toBe(labels1);
    expect(set.get("val")).toBe(labels2);
  });

  it("fromLabelsList creates set with auto keys", () => {
    const labels1 = new Labels();
    const labels2 = new Labels();
    const set = LabelsSet.fromLabelsList([labels1, labels2]);
    expect(set.size).toBe(2);
    expect(set.get("labels_0")).toBe(labels1);
    expect(set.get("labels_1")).toBe(labels2);
  });

  it("fromLabelsList creates set with custom keys", () => {
    const labels1 = new Labels();
    const labels2 = new Labels();
    const set = LabelsSet.fromLabelsList([labels1, labels2], ["train", "val"]);
    expect(set.size).toBe(2);
    expect(set.get("train")).toBe(labels1);
  });

  it("supports iteration", () => {
    const labels1 = new Labels();
    const labels2 = new Labels();
    const set = new LabelsSet({ a: labels1, b: labels2 });
    const keys: string[] = [];
    for (const [key] of set) {
      keys.push(key);
    }
    expect(keys).toEqual(["a", "b"]);
  });

  it("toArray and keyArray work", () => {
    const labels1 = new Labels();
    const labels2 = new Labels();
    const set = new LabelsSet({ a: labels1, b: labels2 });
    expect(set.toArray().length).toBe(2);
    expect(set.keyArray()).toEqual(["a", "b"]);
  });
});

describe("loadSlpSet", () => {
  it("loads multiple SLP files from array", async () => {
    const files = [
      path.join(fixtureRoot, "slp", "minimal_instance.slp"),
      path.join(fixtureRoot, "slp", "typical.slp"),
    ];
    const set = await loadSlpSet(files, { openVideos: false });
    expect(set.size).toBe(2);
    for (const [, labels] of set) {
      expect(labels.labeledFrames.length).toBeGreaterThan(0);
    }
  });

  it("loads multiple SLP files from record", async () => {
    const files = {
      minimal: path.join(fixtureRoot, "slp", "minimal_instance.slp"),
      typical: path.join(fixtureRoot, "slp", "typical.slp"),
    };
    const set = await loadSlpSet(files, { openVideos: false });
    expect(set.size).toBe(2);
    expect(set.get("minimal")).toBeDefined();
    expect(set.get("typical")).toBeDefined();
  });
});

describe("saveSlpSet", () => {
  it("saves multiple SLP files", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A", "B"] });
    const inst = new Instance({ points: { A: [10, 20], B: [30, 40] }, skeleton });
    const frame = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({ labeledFrames: [frame], videos: [video], skeletons: [skeleton] });

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sleap-test-"));
    const file1 = path.join(tmpDir, "train.slp");
    const file2 = path.join(tmpDir, "val.slp");

    const set = new LabelsSet();
    set.set(file1, labels);
    set.set(file2, labels);

    await saveSlpSet(set);

    expect(fs.existsSync(file1)).toBe(true);
    expect(fs.existsSync(file2)).toBe(true);

    const loaded = await loadSlpSet([file1, file2], { openVideos: false });
    expect(loaded.size).toBe(2);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
