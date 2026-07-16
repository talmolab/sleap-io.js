/**
 * Class/category subsystem (SLP 2.7, PR-C) — string-mapped.
 *
 * Detections keep `category` as a plain string; on write the distinct strings form
 * the `/categories/name` catalog and each categorized detection gets a
 * `/categories/links` row (owner_type, owner_id, category_idx, category_score), with
 * category appearance vectors in `/embeddings/category_vectors`. On read the catalog
 * + links map back to the string. Format bumps to 2.7 when a category is present.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Embedding } from "../src/model/embedding.js";

const SK = new Skeleton({ nodes: ["A", "B"], edges: [] });

function categorizedLabels(): Labels {
  const video = new Video({ filename: "v.mp4" });
  const specs = [
    { cat: "left", score: 0.9, emb: [0.1, 0.2] },
    { cat: "right", score: 0.8, emb: [0.3, 0.4] },
    { cat: "left", score: 0.7, emb: [0.5, 0.6] },
  ];
  const frames = specs.map((s, f) => {
    const inst = Instance.fromArray(
      [
        [f, 1],
        [f, 2],
      ],
      SK,
    );
    inst.category = s.cat;
    inst.categoryScore = s.score;
    inst.categoryEmbedding = new Embedding(s.emb);
    return new LabeledFrame({ video, frameIdx: f, instances: [inst] });
  });
  return new Labels({
    labeledFrames: frames,
    videos: [video],
    skeletons: [SK],
  });
}

describe("Category subsystem (SLP 2.7)", () => {
  it("round-trips category string + score + embedding (eager)", async () => {
    const bytes = new Uint8Array(await saveSlpToBytes(categorizedLabels()));
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const all = loaded.labeledFrames.flatMap((f) => f.instances);
    expect(all.map((i) => i.category)).toEqual(["left", "right", "left"]);
    expect(all[0].categoryScore).toBe(0.9);
    expect(all[0].categoryEmbedding?.vector).toEqual([0.1, 0.2]);
    expect(all[1].category).toBe("right");
    expect(all[2].categoryScore).toBe(0.7);
  });

  it("round-trips through a lazy read", async () => {
    const bytes = new Uint8Array(await saveSlpToBytes(categorizedLabels()));
    const lazy = await readSlpLazy(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    const n = lazy._lazyFrameList?.length ?? 0;
    const all: Instance[] = [];
    for (let i = 0; i < n; i += 1) {
      const fr = lazy.frameAt(i);
      if (fr) for (const inst of fr.instances) all.push(inst as Instance);
    }
    expect(all.map((i) => i.category)).toEqual(["left", "right", "left"]);
    expect(all[0].categoryEmbedding?.vector).toEqual([0.1, 0.2]);
  });

  it("bumps format_id to 2.7 and writes /categories + category_vectors", async () => {
    const bytes = new Uint8Array(await saveSlpToBytes(categorizedLabels()));
    const { file, close } = await openH5File(bytes.buffer as ArrayBuffer);
    try {
      const attrs = (file.get("metadata") as any).attrs ?? {};
      const formatId = Number(attrs.format_id?.value ?? attrs.format_id);
      expect(formatId).toBeCloseTo(2.7);
      // Catalog holds the DISTINCT strings (first-seen order).
      const names = Array.from(
        (file.get("categories/name") as any).value as ArrayLike<unknown>,
      ).map((n) =>
        typeof n === "string" ? n : new TextDecoder().decode(n as Uint8Array),
      );
      expect(names).toEqual(["left", "right"]);
      expect((file.get("categories/links") as any).shape[0]).toBe(3);
      expect((file.get("embeddings/category_vectors") as any).shape).toEqual([
        3, 2,
      ]);
    } finally {
      close();
    }
  });

  it("does not bump format_id when no detection has a category", async () => {
    const video = new Video({ filename: "v.mp4" });
    const inst = Instance.fromArray(
      [
        [1, 2],
        [3, 4],
      ],
      SK,
    );
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const bytes = new Uint8Array(
      await saveSlpToBytes(
        new Labels({ labeledFrames: [lf], videos: [video], skeletons: [SK] }),
      ),
    );
    const { file, close } = await openH5File(bytes.buffer as ArrayBuffer);
    try {
      const attrs = (file.get("metadata") as any).attrs ?? {};
      const formatId = Number(attrs.format_id?.value ?? attrs.format_id);
      expect(formatId).toBeLessThan(2.7);
      expect(file.get("categories/links")).toBeNull();
    } finally {
      close();
    }
  });

  it("reads a Python-written 2.7 category file", async () => {
    const { fileURLToPath } = await import("node:url");
    const { readFileSync } = await import("node:fs");
    const nodePath = await import("node:path");
    const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));
    const p = nodePath.join(fixtureRoot, "slp", "py_written_27_category.slp");
    const loaded = await readSlp(
      new Uint8Array(readFileSync(p)).buffer as ArrayBuffer,
      { openVideos: false },
    );
    const all = loaded.labeledFrames.flatMap((f) => f.instances);
    expect(all).toHaveLength(3);
    expect(all.map((i) => i.category)).toEqual(["left", "right", "left"]);
    expect(all[0].categoryScore).toBeCloseTo(0.9, 5);
    expect(all[0].categoryEmbedding?.vector[0]).toBeCloseTo(0.1, 5);
  });
});
