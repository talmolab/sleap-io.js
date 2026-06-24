/**
 * Regression tests for PR #111 follow-ups:
 * - attrToString / attrToNumber helpers handle the three attribute shapes
 *   (string, Uint8Array, { value }) and BigInt coercion.
 * - read.ts (Node path) reads the `frames` HDF5 attribute on embedded video
 *   datasets and propagates it to Video.backendMetadata.shape[0] / backend shape.
 * - h5-worker.ts closeFile() cleanup sequence (unlink+rmdir for buffer mounts)
 *   leaves MEMFS clean across repeated open/close cycles.
 *
 * The worker code itself lives inside a template literal and is hard to exercise
 * in Node. Instead, we drive h5wasm's FS module directly in Node and reproduce
 * the buffer-mount lifecycle from h5-worker.ts to validate the cleanup algorithm.
 */
import { describe, it, expect } from "./bun-test";
import { attrToNumber, attrToString } from "../src/codecs/slp/parsers.js";
import { readSlp } from "../src/codecs/slp/read.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

describe("attrToString", () => {
  it("returns undefined for null/undefined", () => {
    expect(attrToString(undefined)).toBeUndefined();
    expect(attrToString(null)).toBeUndefined();
  });

  it("returns the string for raw string input", () => {
    expect(attrToString("RGB")).toBe("RGB");
  });

  it("decodes Uint8Array input", () => {
    expect(attrToString(new TextEncoder().encode("BGR"))).toBe("BGR");
  });

  it("unwraps { value: string }", () => {
    expect(attrToString({ value: "png" })).toBe("png");
  });

  it("unwraps { value: Uint8Array }", () => {
    expect(attrToString({ value: new TextEncoder().encode("jpg") })).toBe(
      "jpg",
    );
  });

  it("trims trailing nulls and whitespace from fixed-width HDF5 strings", () => {
    expect(attrToString("png\0\0")).toBe("png");
    expect(attrToString({ value: "BGR  " })).toBe("BGR");
  });

  it("returns undefined for unsupported shapes", () => {
    expect(attrToString(42)).toBeUndefined();
    expect(attrToString({ noValue: true })).toBeUndefined();
  });
});

describe("attrToNumber", () => {
  it("returns undefined for null/undefined", () => {
    expect(attrToNumber(undefined)).toBeUndefined();
    expect(attrToNumber(null)).toBeUndefined();
  });

  it("returns plain numbers as-is", () => {
    expect(attrToNumber(14100)).toBe(14100);
    expect(attrToNumber(0)).toBe(0);
  });

  it("unwraps { value: number }", () => {
    expect(attrToNumber({ value: 50 })).toBe(50);
  });

  it("coerces BigInt to Number (HDF5 int64 attributes)", () => {
    expect(attrToNumber(14100n)).toBe(14100);
    expect(attrToNumber({ value: 14100n })).toBe(14100);
  });

  it("parses numeric strings", () => {
    expect(attrToNumber("42")).toBe(42);
  });

  it("returns undefined for non-numeric / non-finite", () => {
    expect(attrToNumber(NaN)).toBeUndefined();
    expect(attrToNumber(Infinity)).toBeUndefined();
    expect(attrToNumber("not-a-number")).toBeUndefined();
    expect(attrToNumber({ noValue: true })).toBeUndefined();
  });
});

describe("read.ts honors `frames` HDF5 attribute on embedded video dataset", () => {
  // Build a synthetic minimal SLP file from scratch where videos_json carries an
  // explicit shape (so the original code path constructs a 4D shape) and
  // video0/video carries a `frames` HDF5 attribute that disagrees with shape[0].
  // Loading via readSlp should yield a backendMetadata.shape whose [0] reflects
  // the attribute, not the JSON subset count.
  //
  // We synthesize from scratch (rather than mutating saveSlpToBytes output)
  // because write.ts only emits shape from `video.backend?.shape`, not
  // `backendMetadata.shape`, so we'd have no way to inject the JSON shape via
  // the public API.
  async function buildFixture(opts: {
    jsonFrameCount: number;
    framesAttr: number | null;
  }) {
    const h5 = await import("h5wasm");
    await h5.ready;
    const FS = h5.FS;
    const memPath =
      "/test-fixture-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2) +
      ".slp";
    FS.writeFile(memPath, new Uint8Array(0));
    const f = new h5.File(memPath, "w");

    const meta = f.create_group("metadata") as {
      create_attribute: (n: string, v: unknown, s?: null, t?: string) => void;
    };
    meta.create_attribute("format_id", 1.5);
    meta.create_attribute(
      "json",
      JSON.stringify({ skeletons: [], provenance: {} }),
    );

    f.create_dataset({
      name: "videos_json",
      data: [
        JSON.stringify({
          filename: ".",
          backend: {
            filename: ".",
            dataset: "video0/video",
            format: "png",
            channel_order: "RGB",
            shape: [opts.jsonFrameCount, 100, 100, 1],
          },
        }),
      ],
      shape: [1],
      dtype: "S",
    });

    const v0 = f.create_group("video0") as {
      create_dataset: (cfg: Record<string, unknown>) => {
        create_attribute: (n: string, v: number, s: null, t: string) => void;
      };
    };
    const vd = v0.create_dataset({
      name: "video",
      data: new Uint8Array([0x89]),
      shape: [1],
      dtype: "<B",
    });
    if (opts.framesAttr !== null) {
      vd.create_attribute("frames", opts.framesAttr, null, "<i8");
    }
    v0.create_dataset({
      name: "frame_numbers",
      data: new Uint32Array([0]),
      shape: [1],
      dtype: "<i4",
    });

    f.create_dataset({ name: "tracks_json", data: [], shape: [0], dtype: "S" });
    f.create_dataset({
      name: "suggestions_json",
      data: [],
      shape: [0],
      dtype: "S",
    });
    f.close();

    const out = FS.readFile(memPath);
    FS.unlink(memPath);
    return new Uint8Array(out).buffer;
  }

  it("overrides shape[0] when `frames` attribute is present", async () => {
    const buf = await buildFixture({ jsonFrameCount: 50, framesAttr: 14100 });
    const labels = await readSlp(buf, { openVideos: false });
    expect(labels.videos.length).toBe(1);
    const shape = (labels.videos[0].backendMetadata as { shape?: number[] })
      ?.shape;
    expect(shape).toBeDefined();
    expect(shape?.[0]).toBe(14100);
    expect(shape?.slice(1)).toEqual([100, 100, 1]);
  });

  it("falls back to JSON shape[0] when `frames` attribute is absent", async () => {
    const buf = await buildFixture({ jsonFrameCount: 50, framesAttr: null });
    const labels = await readSlp(buf, { openVideos: false });
    expect(labels.videos.length).toBe(1);
    const shape = (labels.videos[0].backendMetadata as { shape?: number[] })
      ?.shape;
    expect(shape).toBeDefined();
    expect(shape?.[0]).toBe(50);
  });
});

describe("MEMFS cleanup algorithm (mirrors h5-worker.ts closeFile)", () => {
  it("buffer-mount cycles leave no residual MEMFS entries", async () => {
    // Reproduces the openBufferFile → closeFile cycle from h5-worker.ts.
    // The pre-fix code called only FS.rmdir(mountPath) on a file path, which
    // fails with errno 54 (ENOTDIR) and leaks both the file and parent dir
    // for the lifetime of the worker.
    const h5 = await import("h5wasm");
    await h5.ready;
    const FS = h5.FS;

    const before = new Set(FS.readdir("/"));
    const data = new Uint8Array(
      fs.readFileSync(path.join(fixtureRoot, "slp", "minimal_instance.slp")),
    );

    for (let i = 0; i < 10; i++) {
      // open
      const mountPath = "/buffer-" + Date.now() + "-" + i + "/data.h5";
      const dir = mountPath.substring(0, mountPath.lastIndexOf("/"));
      FS.mkdir(dir);
      FS.writeFile(mountPath, data);
      const f = new h5.File(mountPath, "r");
      void f.keys();
      f.close();
      // close (post-fix cleanup sequence: unlink file, then rmdir parent)
      FS.unlink(mountPath);
      FS.rmdir(dir);
    }

    const after = FS.readdir("/");
    const leaks = after.filter((n: string) => !before.has(n));
    expect(leaks).toEqual([]);
  });
});
