/**
 * End-to-end path resolution for external ImageVideo sequences loaded from a
 * `.slp` whose stored image paths were written on ANOTHER machine (issue #213).
 *
 * A `.slp` is written to a temp dir referencing a 3-image sequence by FOREIGN
 * absolute paths, with a stored `shape` (so `ImageVideoBackend.create` skips the
 * up-front frame-0 decode). The images actually live in a `raw_images_top/`
 * subfolder next to the `.slp`. On load with the Node FsResolver:
 *  - the loader grafts the subfolder tail onto the labels dir, opens the backend
 *    against the resolved paths, and decodes a real frame; and
 *  - when the images are NOT present, the loader withholds the (would-be
 *    "healthy") backend and records `backendError.kind === "image-sequence"`
 *    instead of silently rendering blanks.
 *
 * Also covers `ImageVideoBackend.probeFirstFrame` and the graceful degrade when
 * no FsResolver is available.
 */
import { describe, it, expect, afterEach } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readSlp } from "../../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../../src/codecs/slp/write.js";
import { Video } from "../../src/model/video.js";
import { Labels } from "../../src/model/labels.js";
import { ImageVideoBackend } from "../../src/video/image-video.js";
import {
  getFsResolver,
  setFsResolver,
  setDefaultFsResolver,
} from "../../src/model/matching.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const srcJpg = (i: number) =>
  path.join(fixtureRoot, "videos", "imgs", `img.0${i}.jpg`);

/** Foreign (Linux) absolute paths as they would be stored on the writing box. */
const FOREIGN = [0, 1, 2].map(
  (i) =>
    `/home/talmo/scratch/2026-07-10-mars/raw_images_top/MARS_top_0000${i}.jpg`,
);

/** Build the .slp bytes for an image sequence stored by FOREIGN abs paths + shape. */
async function makeImageSeqSlpBytes(): Promise<Uint8Array> {
  const video = new Video({
    filename: FOREIGN,
    backendMetadata: {
      filename: FOREIGN[0],
      filenames: FOREIGN,
      // A stored shape is what makes ImageVideoBackend.create skip the decode.
      shape: [3, 384, 384, 3],
    },
    openBackend: false,
  });
  const labels = new Labels({ videos: [video] });
  return new Uint8Array(await saveSlpToBytes(labels));
}

/** Write the .slp bytes and (optionally) the images-under-subfolder to a temp dir. */
function writeProject(bytes: Uint8Array, withImages: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sleap-213-"));
  fs.writeFileSync(path.join(dir, "mars_top.slp"), bytes);
  if (withImages) {
    const sub = path.join(dir, "raw_images_top");
    fs.mkdirSync(sub, { recursive: true });
    for (let i = 0; i < 3; i++) {
      fs.copyFileSync(srcJpg(i), path.join(sub, `MARS_top_0000${i}.jpg`));
    }
  }
  return dir;
}

afterEach(() => setFsResolver(null));

describe("ImageVideo external path resolution on load (issue #213)", () => {
  it("grafts the subfolder tail and opens a readable backend", async () => {
    const dir = writeProject(await makeImageSeqSlpBytes(), true);
    try {
      const labels = await readSlp(path.join(dir, "mars_top.slp"), {
        openVideos: true,
      });
      const video = labels.videos[0];
      expect(video.backendError).toBeNull();
      expect(video.backend).toBeInstanceOf(ImageVideoBackend);

      // The backend reads from the RESOLVED subfolder paths...
      const resolved = (video.backend as ImageVideoBackend).filename;
      const expectedFirst = path
        .join(dir, "raw_images_top", "MARS_top_00000.jpg")
        .replace(/\\/g, "/");
      expect(resolved[0]).toBe(expectedFirst);
      expect(resolved).toHaveLength(3);

      // ...while Video.filename keeps the ORIGINAL stored (foreign) paths so a
      // re-save stays portable and identity/matching is unchanged.
      expect(video.filename).toEqual(FOREIGN);

      // A real frame decodes end to end.
      const frame = (await video.getFrame(1)) as ImageData;
      expect(frame).not.toBeNull();
      expect(frame.width).toBeGreaterThan(0);
      expect(frame.height).toBeGreaterThan(0);

      // The stored backend metadata (what the writer serializes) also keeps the
      // ORIGINAL foreign paths, so a re-save stays portable.
      expect(video.backendMetadata.filenames).toEqual(FOREIGN);
      expect(video.backendMetadata.filename).toBe(FOREIGN[0]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-saving after a resolved load writes the ORIGINAL foreign paths, not resolved temp paths", async () => {
    const dir = writeProject(await makeImageSeqSlpBytes(), true);
    try {
      const labels = await readSlp(path.join(dir, "mars_top.slp"), {
        openVideos: true,
      });
      // The backend resolved to the local subfolder, but a re-save must not leak
      // machine-local paths into the portable videos_json.
      const bytes = new Uint8Array(await saveSlpToBytes(labels));
      const reloaded = await readSlp(bytes.buffer, { openVideos: false });
      const rv = reloaded.videos[0];
      expect(rv.filename).toEqual(FOREIGN);
      expect(rv.backendMetadata.filenames).toEqual(FOREIGN);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a MISSING single-file video is never routed through the image-sequence withhold gate", async () => {
    // Single-file (.mp4) source stored by a foreign absolute path, with a shape,
    // and no file on disk: the resolver reports it missing, but single files must
    // take the createVideoBackend path (lazy backend / decode error), NOT the
    // image-sequence withhold gate.
    const clip = "/home/talmo/scratch/2026-07-10-mars/clip.mp4";
    const video = new Video({
      filename: clip,
      backendMetadata: { filename: clip, shape: [3, 384, 384, 3] },
      openBackend: false,
    });
    const bytes = new Uint8Array(
      await saveSlpToBytes(new Labels({ videos: [video] })),
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sleap-213-mp4-"));
    fs.writeFileSync(path.join(dir, "mars_top.slp"), bytes);
    try {
      const labels = await readSlp(path.join(dir, "mars_top.slp"), {
        openVideos: true,
      });
      const rv = labels.videos[0];
      // Whatever happened (lazy backend, or a decode/unsupported error), it must
      // NOT be classified as an image-sequence miss.
      expect(rv.backendError?.kind).not.toBe("image-sequence");
      // Identity is preserved regardless.
      expect(rv.filename).toBe(clip);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("withholds an unreadable backend and flags image-sequence when images are missing", async () => {
    const dir = writeProject(await makeImageSeqSlpBytes(), false);
    try {
      const labels = await readSlp(path.join(dir, "mars_top.slp"), {
        openVideos: true,
      });
      const video = labels.videos[0];
      // Would-be "healthy" (shape present → decode skipped), but the resolver
      // confirms frame 0 is unreachable, so no backend is handed back.
      expect(video.backend).toBeNull();
      expect(video.backendError?.kind).toBe("image-sequence");
      expect(video.backendError?.message).toContain("MARS_top_00000.jpg");
      // Filename is preserved for a locate/repair affordance.
      expect(video.filename).toEqual(FOREIGN);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("degrades gracefully (verbatim, no missing flag) when no FsResolver is available", async () => {
    // Simulate a browser build with neither an override nor a default resolver.
    const savedDefault = getFsResolver();
    setFsResolver(null);
    setDefaultFsResolver(null);
    const dir = writeProject(await makeImageSeqSlpBytes(), false);
    try {
      const labels = await readSlp(path.join(dir, "mars_top.slp"), {
        openVideos: true,
      });
      const video = labels.videos[0];
      // With no resolver we cannot verify existence: build the backend from the
      // stored (foreign) paths + shape, exactly as before this change. It is NOT
      // flagged missing (the consumer's injected reader owns resolution).
      expect(video.backend).toBeInstanceOf(ImageVideoBackend);
      expect(video.backendError).toBeNull();
      expect((video.backend as ImageVideoBackend).filename).toEqual(FOREIGN);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      setDefaultFsResolver(savedDefault);
    }
  });
});

describe("ImageVideoBackend.probeFirstFrame", () => {
  it("resolves true for a readable first frame and false for a broken reader", async () => {
    const good = await ImageVideoBackend.create({
      filename: [srcJpg(0)],
      reader: async (p) => new Uint8Array(fs.readFileSync(p)),
      shape: [1, 384, 384, 3], // skip the decode so create() does no read
    });
    expect(await good.probeFirstFrame()).toBe(true);

    const bad = await ImageVideoBackend.create({
      filename: ["/does/not/exist.jpg"],
      reader: async () => {
        throw new Error("nope");
      },
      shape: [1, 384, 384, 3],
    });
    expect(await bad.probeFirstFrame()).toBe(false);
  });
});
