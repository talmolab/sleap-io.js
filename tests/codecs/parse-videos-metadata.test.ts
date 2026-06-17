/**
 * Unit tests for `parseVideosMetadata` — the videos_json parser used by the
 * streaming reader (read-streaming.ts), which is the path the browser AND the
 * Tauri desktop app take.
 *
 * Image-sequence videos (Python `ImageVideo`) store the FULL ordered image list
 * under `backend.filenames` (plural) AND only the first image under the singular
 * `backend.filename`. Reading the singular field collapses an N-image sequence
 * to a single frame, so the parser must surface the whole list.
 */
import { describe, it, expect } from "../bun-test";
import { parseVideosMetadata } from "../../src/codecs/slp/parsers.js";

describe("parseVideosMetadata", () => {
  it("surfaces the full image list for an image-sequence (backend.filenames)", () => {
    const entry = JSON.stringify({
      filename: ["a.jpg", "b.jpg", "c.jpg"],
      backend: {
        type: "ImageVideo",
        filename: "a.jpg",
        filenames: ["a.jpg", "b.jpg", "c.jpg"],
        shape: [3, 384, 384, 1],
        height_: 384,
        width_: 384,
        channels_: 1,
        grayscale: true,
      },
    });

    const [meta] = parseVideosMetadata([entry]);

    expect(Array.isArray(meta.filename)).toBe(true);
    expect(meta.filename).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(meta.frameCount).toBe(3);
    expect(meta.embedded).toBe(false);
  });

  it("falls back to the singular filename when no filenames list is present", () => {
    const entry = JSON.stringify({
      backend: {
        type: "MediaVideo",
        filename: "movie.mp4",
        shape: [100, 480, 640, 3],
      },
    });

    const [meta] = parseVideosMetadata([entry]);

    expect(meta.filename).toBe("movie.mp4");
    expect(meta.frameCount).toBe(100);
    expect(meta.embedded).toBe(false);
  });

  it("treats an embedded '.' filename as embedded (not a 1-image sequence)", () => {
    const entry = JSON.stringify({
      backend: { type: "HDF5Video", filename: ".", dataset: "video0/video" },
    });

    const [meta] = parseVideosMetadata([entry], "/projects/labels.slp");

    expect(meta.filename).toBe("/projects/labels.slp");
    expect(meta.embedded).toBe(true);
  });
});
