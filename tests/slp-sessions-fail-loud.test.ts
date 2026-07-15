import { describe, it, expect } from "./bun-test";
import { readSessionsStreaming } from "../src/codecs/slp/read-streaming.js";
import {
  parseSessionsMetadata,
  sessionsReadError,
} from "../src/codecs/slp/parsers.js";

// Phase 0 of the SLP 2.8 session port: fail LOUD when a `sessions_json` dataset is
// present but unreadable (the h5wasm variable-length-string read ceiling, ~0.45 GB,
// returns empty strings with no throw). Previously readSessionsStreaming swallowed
// this with `catch { return [] }`, silently dropping calibration + grouping + 3D —
// and the next save overwrote the file 2D-only, destroying it. See sleap-io.js#220.

type FakeFile = Parameters<typeof readSessionsStreaming>[0];

/** A minimal StreamingH5File exposing only what readSessionsStreaming touches. */
function fakeSessionsFile(value: unknown[], hasKey = true): FakeFile {
  return {
    keys: () => (hasKey ? ["sessions_json"] : []),
    getDatasetValue: async (name: string) =>
      name === "sessions_json" ? { value } : { value: [] },
  } as unknown as FakeFile;
}

const VALID_SESSION = JSON.stringify({
  calibration: {
    metadata: {},
    "0": { name: "c0", rotation: [0, 0, 0], translation: [0, 0, 0] },
  },
  camcorder_to_video_idx_map: {},
  frame_group_dicts: [],
  metadata: {},
});

describe("Sessions fail-loud (sleap-io.js#220)", () => {
  describe("readSessionsStreaming", () => {
    it("returns [] when sessions_json is absent (a session-free file)", async () => {
      const file = fakeSessionsFile([], /* hasKey */ false);
      expect(await readSessionsStreaming(file, [], [], undefined)).toEqual([]);
    });

    it("returns [] when sessions_json is present but empty (0 sessions)", async () => {
      const file = fakeSessionsFile([]);
      expect(await readSessionsStreaming(file, [], [], undefined)).toEqual([]);
    });

    it("THROWS when an entry reads back empty (the h5wasm vlen ceiling)", async () => {
      const file = fakeSessionsFile([""]);
      await expect(
        readSessionsStreaming(file, [], [], undefined),
      ).rejects.toThrow(/read back empty|0\.45 GB/);
    });

    it("THROWS on an unparseable entry instead of returning []", async () => {
      const file = fakeSessionsFile(["{not valid json"]);
      await expect(
        readSessionsStreaming(file, [], [], undefined),
      ).rejects.toThrow(/could not be parsed|Refusing to load/);
    });

    it("still reads a valid session normally", async () => {
      const file = fakeSessionsFile([VALID_SESSION]);
      const sessions = await readSessionsStreaming(file, [], [], undefined);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].cameraGroup.cameras).toHaveLength(1);
    });
  });

  describe("parseSessionsMetadata (lite path)", () => {
    it("returns [] on empty input", () => {
      expect(parseSessionsMetadata([])).toEqual([]);
    });

    it("THROWS when an entry reads back empty", () => {
      expect(() => parseSessionsMetadata([""])).toThrow(/read back empty/);
    });

    it("THROWS on an unparseable entry", () => {
      expect(() => parseSessionsMetadata(["{bad"])).toThrow(
        /could not be parsed|Refusing to load/,
      );
    });

    it("parses a valid entry", () => {
      const meta = parseSessionsMetadata([VALID_SESSION]);
      expect(meta).toHaveLength(1);
      expect(meta[0].cameras).toHaveLength(1);
    });
  });

  describe("sessionsReadError", () => {
    it("a blank entry produces the vlen-ceiling message", () => {
      const e = sessionsReadError(1, "");
      expect(e.message).toMatch(/read back empty/);
      expect(e.message).toMatch(/0\.45 GB/);
      expect(e.message).toMatch(/1 entry/);
    });

    it("a non-blank entry produces the parse-failure message", () => {
      const e = sessionsReadError(3, "{bad", new Error("Unexpected token"));
      expect(e.message).toMatch(/could not be parsed/);
      expect(e.message).toMatch(/3 entries/);
    });
  });
});
