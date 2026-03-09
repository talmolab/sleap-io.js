/**
 * Tests for the h5 provider registration pattern.
 *
 * Verifies that:
 * - Node h5 providers are registered and functional
 * - File writer provider is registered and functional
 * - The provider pattern produces the same results as before
 */
/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { getH5Module, openH5File } from "../src/codecs/slp/h5.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { writeSlp } from "../src/codecs/slp/write.js";
import { readSlp } from "../src/codecs/slp/read.js";
import { Labels } from "../src/model/labels.js";
import { Skeleton } from "../src/model/skeleton.js";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

describe("h5 provider pattern", () => {
  it("getH5Module returns a valid h5wasm module", async () => {
    const module = await getH5Module();
    expect(module).toBeDefined();
    expect(module.File).toBeDefined();
    expect(typeof module.File).toBe("function");
  });

  it("openH5File opens an SLP file by path (Node provider)", async () => {
    const fixturePath = join(fixturesDir, "slp", "centered_pair_predictions.slp");
    if (!existsSync(fixturePath)) return; // skip if fixture missing

    const { file, close } = await openH5File(fixturePath);
    try {
      const metadata = file.get("metadata");
      expect(metadata).toBeDefined();
    } finally {
      close();
    }
  });

  it("openH5File opens an SLP file from bytes (Node provider)", async () => {
    const fixturePath = join(fixturesDir, "slp", "centered_pair_predictions.slp");
    if (!existsSync(fixturePath)) return;

    const bytes = readFileSync(fixturePath);
    const { file, close } = await openH5File(new Uint8Array(bytes));
    try {
      const metadata = file.get("metadata");
      expect(metadata).toBeDefined();
    } finally {
      close();
    }
  });

  it("openH5File opens from ArrayBuffer (Node provider)", async () => {
    const fixturePath = join(fixturesDir, "slp", "centered_pair_predictions.slp");
    if (!existsSync(fixturePath)) return;

    const bytes = readFileSync(fixturePath);
    const { file, close } = await openH5File(bytes.buffer as ArrayBuffer);
    try {
      const metadata = file.get("metadata");
      expect(metadata).toBeDefined();
    } finally {
      close();
    }
  });

  it("writeSlp writes to disk using registered file writer", async () => {
    const labels = new Labels({
      skeletons: [new Skeleton({ nodes: [{ name: "A" }, { name: "B" }] })],
    });

    const tempPath = join(tmpdir(), `sleap-io-test-${Date.now()}.slp`);
    try {
      await writeSlp(tempPath, labels);
      expect(existsSync(tempPath)).toBe(true);

      // Verify the written file can be read back
      const loaded = await readSlp(tempPath, { openVideos: false });
      expect(loaded.skeletons).toHaveLength(1);
      expect(loaded.skeletons[0].nodeNames).toEqual(["A", "B"]);
    } finally {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    }
  });

  it("saveSlpToBytes works without file writer (browser-compatible path)", async () => {
    const labels = new Labels({
      skeletons: [new Skeleton({ nodes: [{ name: "X" }] })],
    });

    const bytes = await saveSlpToBytes(labels);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);

    // Verify round-trip
    const loaded = await readSlp(bytes, { openVideos: false });
    expect(loaded.skeletons).toHaveLength(1);
    expect(loaded.skeletons[0].nodeNames).toEqual(["X"]);
  });
});
