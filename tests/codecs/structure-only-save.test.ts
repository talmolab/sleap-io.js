/**
 * `saveSlpStructureToBytes` (Phase 2 / Task 2.1 of the streaming pkg.slp
 * writer, see spike/write-bseam-device).
 *
 * The streaming writer splits a pkg.slp save across the main thread
 * (labels/metadata — the "structure" half) and a Web Worker (the
 * embedded-image half, appended straight to disk via the raw-copy path
 * already covered by `buildSerializableEmbedPlan`/the worker's
 * `appendEmbeddedVideos`). `saveSlpStructureToBytes` is the main-thread half:
 * it must write everything `saveSlpToBytes` writes EXCEPT the
 * `video{i}/video` (and sibling `frame_numbers`/`frame_sizes`) embedded-image
 * datasets, which the worker adds later in append mode.
 */
import { describe, it, expect } from "../bun-test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import * as os from "node:os";
import { readSlp } from "../../src/codecs/slp/read.js";
import { openH5File } from "../../src/codecs/slp/h5.js";
import {
  loadSlp,
  saveSlpToBytes,
  saveSlpStructureToBytes,
} from "../../src/index.js";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const pkg = (name: string) => path.join(fixtureRoot, "slp", name);

/**
 * Reload saved SLP bytes via a temp DISK file (mirrors
 * `tests/reembed-preserve.test.ts`'s `reloadFromDisk`): the in-memory
 * `loadSlp(bytes)` Node path stages to a temp file whose handle is unlinked
 * after load, so a retained embedded backend can't read frames back from it.
 */
async function reloadFromDisk(bytes: Uint8Array) {
  const p = path.join(
    os.tmpdir(),
    `structure_only_${process.pid}_${Math.random().toString(16).slice(2)}.slp`,
  );
  fs.writeFileSync(p, bytes);
  const labels = await readSlp(p, { openVideos: true });
  return { labels, cleanup: () => fs.unlinkSync(p) };
}

describe("saveSlpStructureToBytes (structure-only save, no embedded image data)", () => {
  it("round-trips labels/skeletons/tracks/suggestions and marks the video embedded", async () => {
    const src = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });

    const bytes = await saveSlpStructureToBytes(src);
    const { labels: out, cleanup } = await reloadFromDisk(bytes);

    expect(out.labeledFrames.length).toBe(src.labeledFrames.length);
    expect(out.skeletons.length).toBe(src.skeletons.length);
    expect(out.tracks.length).toBe(src.tracks.length);
    expect(out.suggestions.length).toBe(src.suggestions.length);
    expect(out.videos.length).toBe(src.videos.length);
    // videos_json marks the video embedded, same as a normal embedded save.
    expect(out.videos[0].hasEmbeddedImages).toBe(true);

    src.videos[0].close();
    out.videos[0].close();
    cleanup();
  });

  it("does NOT write the video{i}/video image dataset (nor frame_numbers/frame_sizes)", async () => {
    const src = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });

    const bytes = await saveSlpStructureToBytes(src);
    const { file, close } = await openH5File(bytes);

    const rootKeys: string[] = file.keys();
    // videos_json itself must still be present (the small structural record
    // that marks video0 embedded) ...
    expect(rootKeys).toContain("videos_json");
    // ... but the ENTIRE `video0` group is deferred to the worker's append
    // step: `writeEmbeddedVideoData` (main-thread full embed) and the
    // worker's `appendEmbeddedVideos` both `create_group("video0")`
    // themselves, and the worker's create_group would collide if the
    // structure writer had already created it. So a structure-only save must
    // not create the group at all, which subsumes "no video0/video dataset
    // (nor frame_numbers/frame_sizes)".
    expect(rootKeys).not.toContain("video0");

    close();
    src.videos[0].close();
  });

  it("produces bytes much smaller than a full embedded saveSlpToBytes of the same fixture", async () => {
    const src = await loadSlp(pkg("minimal_instance.pkg.slp"), {
      openVideos: true,
    });
    const fns = src.videos[0].embeddedFrameIndices!;
    expect(fns.length).toBeGreaterThan(0);

    // Sum of the raw embedded blob sizes this fixture stores — the bytes
    // saveSlpStructureToBytes must be missing relative to a full embed.
    let embeddedBytes = 0;
    for (const fn of fns) {
      const blob = await src.videos[0].getFrameBuffer!(fn);
      embeddedBytes += blob!.length;
    }

    const structureBytes = await saveSlpStructureToBytes(src);
    const fullBytes = await saveSlpToBytes(src);

    expect(structureBytes.length).toBeLessThan(fullBytes.length);
    // The size gap should be at least on the order of the embedded image
    // bytes (allow slack for HDF5 chunk/metadata overhead on the full save).
    expect(fullBytes.length - structureBytes.length).toBeGreaterThanOrEqual(
      embeddedBytes * 0.9,
    );

    src.videos[0].close();
  });
});
