/**
 * `SerializableEmbedEntry`/`SerializableEmbedPlan` + `buildSerializableEmbedPlan`
 * (Task 1.1 of the streaming pkg.slp writer, see spike/write-bseam-device).
 *
 * The streaming writer splits a pkg.slp save across the main thread (labels /
 * metadata) and a Web Worker (the embedded-image half, appended straight to
 * disk). The worker cannot receive the live `Labels`/`Video`/backend objects —
 * they don't survive `structuredClone` across the worker boundary — so
 * `buildSerializableEmbedPlan` must project `planEmbedding`'s result into a
 * plain-data plan the worker can act on with ONLY that plan plus read access to
 * the source file. Scope is the RE-SAVE/raw-copy path ONLY; a selected
 * new-embed ("encode") entry must throw.
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  loadSlp,
  Labels,
  LabeledFrame,
  Video,
  Skeleton,
  Instance,
  buildSerializableEmbedPlan,
  type SerializableEmbedPlan,
} from "../../src/index.js";
import type { VideoBackend } from "../../src/index.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const pkg = (name: string) => path.join(fixtureRoot, "slp", name);

describe("buildSerializableEmbedPlan (re-save raw-copy path)", () => {
  it("builds one entry per embedded video from a real already-embedded fixture", async () => {
    const fixturePath = pkg("minimal_instance.pkg.slp");
    const labels = await loadSlp(fixturePath, { openVideos: true });
    const video = labels.videos[0];
    expect(video.hasEmbeddedImages).toBe(true);
    const backend = video.backend!;
    const expectedFrameNumbers = video.embeddedFrameIndices!;

    const plan = await buildSerializableEmbedPlan(labels, true, fixturePath);

    expect(plan.sourcePath).toBe(fixturePath);
    expect(plan.entries.length).toBe(1);

    const entry = plan.entries[0];
    expect(entry.videoIndex).toBe(0);
    // Source-group/dataset locator derived from the backend, not hardcoded.
    expect(entry.sourceDataset).toBe(backend.dataset);
    expect(entry.sourceDataset).toBe("video0/video");
    expect(entry.sourceGroup).toBe("video0");
    expect(entry.format).toBe(backend.embeddedFormat);
    expect(entry.channelOrder).toBe(backend.embeddedChannelOrder);
    expect(entry.frameNumbers.length).toBeGreaterThan(0);
    expect(entry.frameNumbers).toEqual(expectedFrameNumbers);
    // sourceVideoJson shape: this fixture's video has a recorded sourceVideo
    // (the original .mp4 lineage), so it must be a plain object with a
    // filename, not null.
    expect(entry.sourceVideoJson).not.toBeNull();
    expect(typeof entry.sourceVideoJson).toBe("object");
    expect(entry.sourceVideoJson!.filename).toBe(video.sourceVideo!.filename);

    video.close();
  });

  it("survives structuredClone byte-for-byte (worker-transportable)", async () => {
    const fixturePath = pkg("minimal_instance.pkg.slp");
    const labels = await loadSlp(fixturePath, { openVideos: true });
    const plan = await buildSerializableEmbedPlan(labels, true, fixturePath);

    const cloned = structuredClone(plan) as SerializableEmbedPlan;

    expect(cloned).toEqual(plan);
    // No class instances / functions leaked through: a plain deep-equal object
    // (not just JSON.stringify equality, which would also pass for
    // non-clonable input that structuredClone secretly dropped fields from).
    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(cloned.entries[0])).toBe(Object.prototype);

    labels.videos[0].close();
  });

  it("derives the source group/dataset from the backend, NOT from videoIndex", async () => {
    // Hand-built raw-copyable backend whose dataset path deliberately does NOT
    // match its destination videoIndex (e.g. this video was video7 in the
    // source file but is being re-saved as video0 in the new file) — proves
    // the source locator is read off the backend, never assumed to equal the
    // destination index.
    const frameNumbers = [3, 7, 12];
    const backend = {
      frameNumbers,
      dataset: "video7/video",
      embeddedFormat: "jpg",
      embeddedChannelOrder: "BGR",
      async getFrame() {
        return null;
      },
      async getFrameBuffer(fn: number) {
        return frameNumbers.includes(fn) ? new Uint8Array([1, 2, 3]) : null;
      },
      close() {},
    };
    const video = new Video({
      filename: "sim_source.pkg.slp",
      backend: backend as unknown as VideoBackend,
      embedded: true,
    });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const labels = new Labels({
      labeledFrames: frameNumbers.map(
        (fn) =>
          new LabeledFrame({
            video,
            frameIdx: fn,
            instances: [new Instance({ points: { A: [1, 1] }, skeleton })],
          }),
      ),
      videos: [video],
      skeletons: [skeleton],
    });

    const plan = await buildSerializableEmbedPlan(
      labels,
      true,
      "sim_source.pkg.slp",
    );

    expect(plan.entries.length).toBe(1);
    const entry = plan.entries[0];
    expect(entry.videoIndex).toBe(0); // destination index
    expect(entry.sourceDataset).toBe("video7/video"); // SOURCE location, != 0
    expect(entry.sourceGroup).toBe("video7");
    expect(entry.frameNumbers).toEqual(frameNumbers);
    // No separate sourceVideo and the video IS embedded -> sourceVideoDict
    // records nothing (mirrors the existing writer's semantics).
    expect(entry.sourceVideoJson).toBeNull();
  });

  it('throws when planEmbedding selects a new-embed ("encode") entry', async () => {
    // A continuous (non-embedded) video with an open backend that implements
    // getFrame(): planEmbedding's isRealMode branch collects it via the legacy
    // getFrame+encode path (kind:"encode"), which the streaming writer's
    // worker half does not support - re-save/raw-copy only.
    const backend = {
      shape: [2, 2, 2, 1] as [number, number, number, number],
      async getFrame() {
        return new Uint8Array([1, 2, 3, 4]);
      },
      close() {},
    };
    const video = new Video({
      filename: "continuous.mp4",
      backend: backend as unknown as VideoBackend,
    });
    expect(video.hasEmbeddedImages).toBe(false);
    const skeleton = new Skeleton({ nodes: ["A"] });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [new Instance({ points: { A: [1, 1] }, skeleton })],
        }),
      ],
      videos: [video],
      skeletons: [skeleton],
    });

    await expect(
      buildSerializableEmbedPlan(labels, true, "continuous.mp4"),
    ).rejects.toThrow(/raw-copy/);
  });

  it("throws when a raw-copyable backend exposes no dataset locator", async () => {
    const frameNumbers = [0];
    const backend = {
      frameNumbers,
      // No `dataset` property at all - the worker would have nothing to
      // locate the source embedded group by.
      embeddedFormat: "png",
      embeddedChannelOrder: "RGB",
      async getFrame() {
        return null;
      },
      async getFrameBuffer() {
        return new Uint8Array([1]);
      },
      close() {},
    };
    const video = new Video({
      filename: "no_dataset.pkg.slp",
      backend: backend as unknown as VideoBackend,
      embedded: true,
    });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const labels = new Labels({
      labeledFrames: [
        new LabeledFrame({
          video,
          frameIdx: 0,
          instances: [new Instance({ points: { A: [1, 1] }, skeleton })],
        }),
      ],
      videos: [video],
      skeletons: [skeleton],
    });

    await expect(
      buildSerializableEmbedPlan(labels, true, "no_dataset.pkg.slp"),
    ).rejects.toThrow(/dataset/);
  });
});
