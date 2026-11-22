/**
 * Every reader refuses SLP files it cannot read (issue #278).
 *
 * Before this check, a format 3.0 file (one dataset per column, written by
 * Python sleap-io 0.10) loaded with no error and no poses: the readers asked
 * each pose table for a compound value, got nothing back from a group, and
 * carried on. Now the in-memory, lazy, streaming and lite readers throw
 * `SlpFormatError` for a file of format 3 or higher and for a file whose
 * `required_features` attribute names a feature this version doesn't know.
 *
 * Fixtures (`tests/data/slp/gen_format3_fixture.py`) were written with Python
 * sleap-io 0.10.0 from the `release/0.10` branch at commit fe4f91c7b:
 *   - format3_minimal.slp: format 3.0
 *   - format3_minimal.v2.slp: the same labels in the 2.x layout
 *   - format4_stub.slp: the 2.x file with `format_id` set to 4.0
 *   - required_features_unknown.slp / _bytes.slp: the 2.x file with a
 *     `required_features` attribute (variable-length and fixed-length strings)
 */
import { describe, it, expect } from "./bun-test";
import { readSlp, readSlpLazy } from "../src/codecs/slp/read.js";
import { readFromStreamingFile } from "../src/codecs/slp/read-streaming.js";
import type { StreamingH5File } from "../src/codecs/slp/h5-streaming.js";
import {
  checkSlpFormat,
  SlpFormatError,
  SLP_FORMAT_ID_LIMIT,
  SLP_SUPPORTED_FEATURES,
} from "../src/codecs/slp/format-check.js";
import {
  loadSlp,
  SlpFormatError as PublicSlpFormatError,
} from "../src/index.js";
import {
  loadSlpMetadata,
  validateSlpBuffer,
  SlpFormatError as LiteSlpFormatError,
} from "../src/lite.js";
import { ready, File as H5File } from "h5wasm/node";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const slpDir = path.join(
  fileURLToPath(new URL("./data", import.meta.url)),
  "slp",
);
const slpPath = (name: string) => path.join(slpDir, name);
const slpBytes = (name: string) => new Uint8Array(readFileSync(slpPath(name)));

const V3 = "format3_minimal.slp";
const V2 = "format3_minimal.v2.slp";
const V4 = "format4_stub.slp";
const FEATURES = "required_features_unknown.slp";
const FEATURES_BYTES = "required_features_unknown_bytes.slp";
/** Fixtures this version must refuse; every other one in the folder loads. */
const REFUSED = [V3, V4, FEATURES, FEATURES_BYTES];
const N_FRAMES = 3;

/**
 * The `/metadata` attributes of a fixture as the streaming worker's `getAttrs`
 * returns them: every value wrapped as `{ value }` (see `serializeAttrValue` in
 * h5-worker.ts).
 */
async function workerStyleMetadataAttrs(
  name: string,
): Promise<Record<string, unknown>> {
  await ready;
  const h5 = new H5File(slpPath(name), "r");
  try {
    const attrs = (h5.get("metadata") as unknown as { attrs: object }).attrs;
    const out: Record<string, unknown> = {};
    for (const [key, attr] of Object.entries(attrs)) {
      out[key] = { value: (attr as { value: unknown }).value };
    }
    return out;
  } finally {
    h5.close();
  }
}

/**
 * A `StreamingH5File` that serves only the `/metadata` attributes of a fixture.
 * `readSlpStreaming` needs a Web Worker and can't run in this suite, so the
 * streaming reader is driven through `readFromStreamingFile`. The format check
 * has to fire before any other method of the file is reached; a reader that
 * went further would fail here with a `TypeError`, not `SlpFormatError`.
 */
async function metadataOnlyStreamingFile(
  name: string,
): Promise<StreamingH5File> {
  const attrs = await workerStyleMetadataAttrs(name);
  return {
    getAttrs: async (p: string) => {
      if (p !== "metadata") throw new Error(`Path not found: ${p}`);
      return attrs;
    },
  } as unknown as StreamingH5File;
}

/** Every reader entry point, as a call that loads the named fixture. */
const READERS: Array<[string, (name: string) => Promise<unknown>]> = [
  ["readSlp (in memory)", (n) => readSlp(slpPath(n), { openVideos: false })],
  [
    "readSlp (in memory, from bytes)",
    (n) => readSlp(slpBytes(n), { openVideos: false, h5: { filenameHint: n } }),
  ],
  ["readSlpLazy", (n) => readSlpLazy(slpPath(n), { openVideos: false })],
  ["loadSlp", (n) => loadSlp(slpPath(n), { openVideos: false })],
  [
    "loadSlp with lazy",
    (n) => loadSlp(slpPath(n), { openVideos: false, lazy: true }),
  ],
  [
    "readFromStreamingFile (streaming)",
    async (n) =>
      readFromStreamingFile(
        await metadataOnlyStreamingFile(n),
        `https://example.com/${n}`,
      ),
  ],
  [
    "readFromStreamingFile (streaming, lazy)",
    async (n) =>
      readFromStreamingFile(
        await metadataOnlyStreamingFile(n),
        `https://example.com/${n}`,
        undefined,
        false,
        undefined,
        false,
        true,
      ),
  ],
  [
    "loadSlpMetadata (lite)",
    (n) => loadSlpMetadata(slpBytes(n), { filename: n }),
  ],
];

/** Run `load` and return the error it rejects with. */
async function refusal(load: () => Promise<unknown>): Promise<SlpFormatError> {
  let error: unknown;
  try {
    await load();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(SlpFormatError);
  return error as SlpFormatError;
}

describe("format 3.0 files are refused by every reader", () => {
  for (const [label, load] of READERS) {
    it(`${label} throws SlpFormatError naming the format and a reader`, async () => {
      const error = await refusal(() => load(V3));
      expect(error.name).toBe("SlpFormatError");
      expect(error.formatId).toBe(3);
      expect(error.unsupportedFeatures).toEqual([]);
      expect(error.labelsPath).toContain(V3);
      expect(error.message).toContain(V3);
      expect(error.message).toContain("SLP format 3.0");
      expect(error.message).toContain("Python sleap-io 0.10 or newer");
      expect(error.message).toContain("legacy_format=True");
    });
  }

  it("validateSlpBuffer (lite) throws SlpFormatError", () => {
    let error: unknown;
    try {
      validateSlpBuffer(slpBytes(V3));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SlpFormatError);
    expect((error as SlpFormatError).message).toContain("SLP format 3.0");
  });
});

describe("formats above 3 are refused by every reader", () => {
  for (const [label, load] of READERS) {
    it(`${label} throws SlpFormatError for format 4.0`, async () => {
      const error = await refusal(() => load(V4));
      expect(error.formatId).toBe(4);
      expect(error.message).toContain("SLP format 4.0");
      // sleap-io 0.10 can't read format 4 either, so it isn't recommended.
      expect(error.message).not.toContain("0.10");
      expect(error.message).toContain("the tool that wrote it");
    });
  }
});

describe("unknown required features are refused by every reader", () => {
  for (const fixture of [FEATURES, FEATURES_BYTES]) {
    for (const [label, load] of READERS) {
      it(`${label} throws SlpFormatError for ${fixture}`, async () => {
        const error = await refusal(() => load(fixture));
        expect(error.formatId).toBe(1.4);
        expect(error.unsupportedFeatures).toEqual([
          "another_one",
          "made_up_feature",
        ]);
        expect(error.message).toContain(fixture);
        expect(error.message).toContain("another_one, made_up_feature");
        expect(error.message).toContain("SLP format 1.4");
      });
    }

    it(`validateSlpBuffer (lite) throws SlpFormatError for ${fixture}`, () => {
      expect(() => validateSlpBuffer(slpBytes(fixture))).toThrow(
        "another_one, made_up_feature",
      );
    });
  }
});

describe("old-layout files load as before", () => {
  /** Coordinates the generator script wrote for frame `i`. */
  const userXY = (i: number) => [
    [10 + i, 20],
    [30 + i, 40],
  ];
  const predictedXY = (i: number) => [
    [11 + i, 21],
    [31 + i, 41],
  ];

  it("readSlp loads the 2.x twin of the format 3.0 fixture with every pose", async () => {
    const labels = await readSlp(slpPath(V2), { openVideos: false });
    expect(labels.labeledFrames.length).toBe(N_FRAMES);
    labels.labeledFrames.forEach((frame, i) => {
      expect(frame.frameIdx).toBe(i);
      expect(frame.userInstances.length).toBe(1);
      expect(frame.predictedInstances.length).toBe(1);
      expect(frame.userInstances[0].numpy()).toEqual(userXY(i));
      expect(
        frame.predictedInstances[0].numpy().map((row) => row.slice(0, 2)),
      ).toEqual(predictedXY(i));
    });
    expect(labels.skeletons[0].nodeNames).toEqual(["head", "tail"]);
    expect(labels.tracks.map((t) => t.name)).toEqual(["animal"]);
  });

  it("readSlpLazy loads the 2.x twin with every frame", async () => {
    const labels = await readSlpLazy(slpPath(V2), { openVideos: false });
    expect(labels.isLazy).toBe(true);
    expect(labels.length).toBe(N_FRAMES);
  });

  it("loadSlp loads the 2.x twin, eagerly and lazily", async () => {
    const eager = await loadSlp(slpPath(V2), { openVideos: false });
    expect(eager.labeledFrames.length).toBe(N_FRAMES);
    const lazy = await loadSlp(slpPath(V2), { openVideos: false, lazy: true });
    expect(lazy.length).toBe(N_FRAMES);
  });

  it("the streaming reader gets past the format check on the 2.x twin", async () => {
    // The stub serves metadata only, so the reader fails at its next step
    // (reading tracks). What matters is that it is not the format refusal.
    let error: unknown;
    try {
      await readFromStreamingFile(
        await metadataOnlyStreamingFile(V2),
        `https://example.com/${V2}`,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error).not.toBeInstanceOf(SlpFormatError);
  });

  it("the lite reader counts the 2.x twin's rows and validates it", async () => {
    const metadata = await loadSlpMetadata(slpBytes(V2));
    expect(metadata.formatId).toBe(1.4);
    expect(metadata.counts).toEqual({
      labeledFrames: N_FRAMES,
      instances: 2 * N_FRAMES,
      points: 2 * N_FRAMES,
      predictedPoints: 2 * N_FRAMES,
    });
    expect(validateSlpBuffer(slpBytes(V2))).toBe(true);
  });

  it("no other SLP fixture in the suite is refused", async () => {
    await ready;
    const fixtures = readdirSync(slpDir).filter(
      (name) => name.endsWith(".slp") && !REFUSED.includes(name),
    );
    expect(fixtures.length).toBeGreaterThan(15);
    for (const name of fixtures) {
      const h5 = new H5File(slpPath(name), "r");
      try {
        // A few fixtures are not SLP files proper and have no `/metadata`.
        const group = h5.get("metadata") as unknown as {
          attrs: Record<string, unknown>;
        } | null;
        expect(() => checkSlpFormat(name, group?.attrs)).not.toThrow();
      } finally {
        h5.close();
      }
    }
  });
});

describe("checkSlpFormat", () => {
  it("passes every format below the limit, wrapped or bare", () => {
    for (const formatId of [1.0, 1.1, 1.2, 1.4, 2.0, 2.3, 2.8, 2.99]) {
      expect(() =>
        checkSlpFormat("a.slp", { format_id: formatId }),
      ).not.toThrow();
      expect(() =>
        checkSlpFormat("a.slp", { format_id: { value: formatId } }),
      ).not.toThrow();
    }
  });

  it("passes a file with no format_id, no attributes, or a non-numeric one", () => {
    expect(() => checkSlpFormat("a.slp", {})).not.toThrow();
    expect(() => checkSlpFormat("a.slp", null)).not.toThrow();
    expect(() => checkSlpFormat("a.slp", undefined)).not.toThrow();
    expect(() => checkSlpFormat("a.slp", { format_id: "abc" })).not.toThrow();
  });

  it("refuses the limit itself and everything above it", () => {
    expect(SLP_FORMAT_ID_LIMIT).toBe(3.0);
    for (const formatId of [3, 3.0, 3.1, 4, 10]) {
      expect(() => checkSlpFormat("a.slp", { format_id: formatId })).toThrow(
        SlpFormatError,
      );
      expect(() =>
        checkSlpFormat("a.slp", { format_id: { value: formatId } }),
      ).toThrow(SlpFormatError);
    }
    expect(() => checkSlpFormat("a.slp", { format_id: 3.1 })).toThrow(
      "SLP format 3.1",
    );
  });

  it("reads required_features in every shape a backend hands over", () => {
    expect(SLP_SUPPORTED_FEATURES.size).toBe(0);
    const shapes: unknown[] = [
      ["x"],
      { value: ["x"] },
      "x",
      { value: "x" },
      ["x\u0000\u0000\u0000"],
      [new TextEncoder().encode("x")],
      ["x", "x"],
    ];
    for (const required_features of shapes) {
      let error: unknown;
      try {
        checkSlpFormat("a.slp", { format_id: 2.8, required_features });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SlpFormatError);
      expect((error as SlpFormatError).unsupportedFeatures).toEqual(["x"]);
    }
  });

  it("passes an empty or absent required_features", () => {
    for (const required_features of [[], { value: [] }, "", null, undefined]) {
      expect(() =>
        checkSlpFormat("a.slp", { format_id: 2.8, required_features }),
      ).not.toThrow();
    }
  });

  it("reports the format number before the features when both apply", () => {
    let error: unknown;
    try {
      checkSlpFormat("a.slp", { format_id: 3.0, required_features: ["x"] });
    } catch (e) {
      error = e;
    }
    expect((error as SlpFormatError).formatId).toBe(3);
    expect((error as SlpFormatError).message).toContain("SLP format 3.0");
  });

  it("is the same class from the main and lite entry points", () => {
    expect(PublicSlpFormatError).toBe(SlpFormatError);
    expect(LiteSlpFormatError).toBe(SlpFormatError);
  });
});
