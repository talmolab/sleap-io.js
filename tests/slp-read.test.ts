/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlp } from "../src/io/main.js";
import { Instance, PredictedInstance } from "../src/model/instance.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

async function loadFixture(filename: string) {
  return loadSlp(path.join(fixtureRoot, "slp", filename), { openVideos: false });
}

describe("SLP read fixtures", () => {
  it("loads typical and minimal fixtures", async () => {
    const typical = await loadFixture("typical.slp");
    expect(typical.labeledFrames.length).toBeGreaterThan(0);
    expect(typical.skeletons.length).toBeGreaterThan(0);
    expect(typical.videos.length).toBeGreaterThan(0);

    const minimal = await loadFixture("minimal_instance.slp");
    expect(minimal.labeledFrames.length).toBeGreaterThan(0);
    expect(minimal.skeletons.length).toBeGreaterThan(0);
  });

  it("reads provenance metadata", async () => {
    const labels = await loadFixture("predictions_1.2.7_provenance_and_tracking.slp");
    expect(labels.provenance.sleap_version).toBe("1.2.7");
  });

  it("handles legacy coordinate system and from_predicted links", async () => {
    const legacy = await loadFixture("test_grid_labels.legacy.slp");
    const legacyInstance = legacy.labeledFrames[0].instances[0] as Instance;
    expect(legacyInstance.numpy()).toEqual([
      [-1, -1],
      [-0.5, -0.5],
      [-1, 0],
    ]);

    const labels = await loadFixture("labels.v002.rel_paths.slp");
    const frame220 = labels.find({ video: labels.video, frameIdx: 220 })[0];
    expect(frame220.instances[0]).toBeInstanceOf(PredictedInstance);
    expect(frame220.instances[1]).toBeInstanceOf(PredictedInstance);
    expect(frame220.instances[2]).toBeInstanceOf(Instance);
    expect(frame220.instances[2].fromPredicted).toBe(frame220.instances[1]);
    expect(frame220.unusedPredictions).toEqual([frame220.instances[0]]);

    const frame770 = labels.find({ video: labels.video, frameIdx: 770 })[0];
    expect(frame770.instances[0]).toBeInstanceOf(PredictedInstance);
    expect(frame770.instances[1]).toBeInstanceOf(PredictedInstance);
    expect(frame770.instances[2]).toBeInstanceOf(Instance);
    expect(frame770.instances[3]).toBeInstanceOf(Instance);
    expect(frame770.instances[2].fromPredicted).toBe(frame770.instances[1]);
    expect(frame770.instances[3].fromPredicted).toBe(frame770.instances[0]);
    expect(frame770.unusedPredictions.length).toBe(0);
  });
});
