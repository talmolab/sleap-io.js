/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { SuggestionFrame, Video, Labels, Skeleton } from "../src/index.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { readSlp } from "../src/codecs/slp/read.js";
import { loadSlp } from "../src/io/main.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

describe("SuggestionFrame", () => {
  it("defaults group to 'default'", () => {
    const video = new Video({ filename: "test.mp4" });
    const suggestion = new SuggestionFrame({ video, frameIdx: 0 });
    expect(suggestion.group).toBe("default");
  });

  it("accepts explicit group", () => {
    const video = new Video({ filename: "test.mp4" });
    const suggestion = new SuggestionFrame({ video, frameIdx: 0, group: "initial" });
    expect(suggestion.group).toBe("initial");
  });

  it("extracts group from metadata if not explicitly set", () => {
    const video = new Video({ filename: "test.mp4" });
    const suggestion = new SuggestionFrame({ video, frameIdx: 0, metadata: { group: "batch1" } });
    expect(suggestion.group).toBe("batch1");
  });

  it("round-trips group through write and read", async () => {
    const video = new Video({ filename: "test.mp4" });
    const skeleton = new Skeleton({ nodes: ["A"] });
    const suggestions = [
      new SuggestionFrame({ video, frameIdx: 0, group: "group_a" }),
      new SuggestionFrame({ video, frameIdx: 5, group: "group_b" }),
      new SuggestionFrame({ video, frameIdx: 10 }),
    ];
    const labels = new Labels({ videos: [video], skeletons: [skeleton], suggestions });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.suggestions.length).toBe(3);
    expect(loaded.suggestions[0].group).toBe("group_a");
    expect(loaded.suggestions[1].group).toBe("group_b");
    expect(loaded.suggestions[2].group).toBe("default");
  });

  it("reads suggestions from fixture files", async () => {
    const labels = await loadSlp(path.join(fixtureRoot, "slp", "centered_pair_predictions.slp"), { openVideos: false });
    for (const suggestion of labels.suggestions) {
      expect(suggestion.group).toBeDefined();
      expect(typeof suggestion.group).toBe("string");
    }
  });
});
