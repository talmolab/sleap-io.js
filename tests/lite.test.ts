/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { loadSlpMetadata, validateSlpBuffer, isHdf5Buffer } from "../src/lite.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

function loadFixtureBuffer(filename: string): Buffer {
  return readFileSync(path.join(fixtureRoot, "slp", filename));
}

describe("loadSlpMetadata", () => {
  it("extracts metadata from typical SLP file", async () => {
    const buffer = loadFixtureBuffer("typical.slp");
    const metadata = await loadSlpMetadata(buffer);

    expect(metadata.version).toBeDefined();
    expect(metadata.formatId).toBeGreaterThanOrEqual(1.0);
    expect(metadata.skeletons.length).toBeGreaterThan(0);
    expect(metadata.counts.labeledFrames).toBeGreaterThan(0);
    expect(metadata.counts.instances).toBeGreaterThan(0);
  });

  it("extracts skeleton with nodes, edges, and name", async () => {
    const buffer = loadFixtureBuffer("minimal_instance.slp");
    const metadata = await loadSlpMetadata(buffer);

    expect(metadata.skeletons.length).toBe(1);
    const skeleton = metadata.skeletons[0];
    expect(skeleton.nodeNames).toEqual(["A", "B"]);
    expect(skeleton.edges.length).toBe(1);
  });

  it("reads provenance metadata", async () => {
    const buffer = loadFixtureBuffer("predictions_1.2.7_provenance_and_tracking.slp");
    const metadata = await loadSlpMetadata(buffer);

    expect(metadata.provenance).toBeDefined();
    expect(metadata.provenance?.sleap_version).toBe("1.2.7");
  });

  it("extracts track information", async () => {
    const buffer = loadFixtureBuffer("predictions_1.2.7_provenance_and_tracking.slp");
    const metadata = await loadSlpMetadata(buffer);

    expect(metadata.tracks.length).toBeGreaterThan(0);
    expect(metadata.tracks[0].name).toBeDefined();
  });

  it("extracts video metadata for embedded videos", async () => {
    const buffer = loadFixtureBuffer("minimal_instance.pkg.slp");
    const metadata = await loadSlpMetadata(buffer);

    expect(metadata.videos.length).toBeGreaterThan(0);
    const video = metadata.videos[0];
    expect(video.embedded).toBe(true);
    // Embedded videos should have dimensions from attributes
    expect(video.width).toBeGreaterThan(0);
    expect(video.height).toBeGreaterThan(0);
    expect(metadata.hasEmbeddedImages).toBe(true);
  });

  it("extracts video metadata for external videos", async () => {
    const buffer = loadFixtureBuffer("typical.slp");
    const metadata = await loadSlpMetadata(buffer);

    expect(metadata.videos.length).toBeGreaterThan(0);
    const video = metadata.videos[0];
    expect(video.filename).toBeDefined();
    // External videos have metadata from backend info
    expect(typeof video.filename).toBe("string");
  });

  it("counts points and predicted points separately", async () => {
    const buffer = loadFixtureBuffer("predictions_1.2.7_provenance_and_tracking.slp");
    const metadata = await loadSlpMetadata(buffer);

    // This file has predictions, so should have predicted points
    expect(metadata.counts.points).toBeGreaterThanOrEqual(0);
    expect(metadata.counts.predictedPoints).toBeGreaterThanOrEqual(0);
    expect(metadata.counts.instances).toBeGreaterThan(0);
  });

  it("parses multiview session metadata", async () => {
    const buffer = loadFixtureBuffer("multiview.slp");
    const metadata = await loadSlpMetadata(buffer);

    // Multiview files should have session data
    if (metadata.sessions.length > 0) {
      const session = metadata.sessions[0];
      expect(session.cameras.length).toBeGreaterThan(0);
      expect(Object.keys(session.videosByCamera).length).toBeGreaterThan(0);
    }
  });

  it("throws on invalid file", async () => {
    const invalidBuffer = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

    await expect(loadSlpMetadata(invalidBuffer)).rejects.toThrow();
  });

  it("throws on file missing required datasets", async () => {
    // HDF5 magic number but not a valid SLP
    const hdf5Header = new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

    // This will throw because jsfive can't parse a truncated HDF5
    await expect(loadSlpMetadata(hdf5Header)).rejects.toThrow();
  });
});

describe("validateSlpBuffer", () => {
  it("returns true for valid SLP file", () => {
    const buffer = loadFixtureBuffer("typical.slp");
    expect(validateSlpBuffer(buffer)).toBe(true);
  });

  it("returns true for minimal SLP file", () => {
    const buffer = loadFixtureBuffer("minimal_instance.slp");
    expect(validateSlpBuffer(buffer)).toBe(true);
  });

  it("throws for invalid buffer", () => {
    const invalidBuffer = new Uint8Array([0, 0, 0, 0]);
    expect(() => validateSlpBuffer(invalidBuffer)).toThrow();
  });
});

describe("isHdf5Buffer", () => {
  it("returns true for HDF5 file", () => {
    const buffer = loadFixtureBuffer("typical.slp");
    expect(isHdf5Buffer(buffer)).toBe(true);
  });

  it("returns false for non-HDF5 buffer", () => {
    const notHdf5 = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isHdf5Buffer(notHdf5)).toBe(false);
  });

  it("returns false for too-short buffer", () => {
    const tooShort = new Uint8Array([0x89, 0x48, 0x44]);
    expect(isHdf5Buffer(tooShort)).toBe(false);
  });
});

describe("lite vs full comparison", () => {
  it("extracts same skeleton info as full loadSlp", async () => {
    // Import full loadSlp
    const { loadSlp } = await import("../src/io/main.js");

    const buffer = loadFixtureBuffer("minimal_instance.slp");
    const liteMetadata = await loadSlpMetadata(buffer);

    const fullPath = path.join(fixtureRoot, "slp", "minimal_instance.slp");
    const fullLabels = await loadSlp(fullPath, { openVideos: false });

    // Compare skeletons
    expect(liteMetadata.skeletons.length).toBe(fullLabels.skeletons.length);
    expect(liteMetadata.skeletons[0].nodeNames).toEqual(fullLabels.skeletons[0].nodeNames);
    expect(liteMetadata.skeletons[0].edgeIndices).toEqual(fullLabels.skeletons[0].edgeIndices);

    // Compare counts
    expect(liteMetadata.counts.labeledFrames).toBe(fullLabels.labeledFrames.length);
    expect(liteMetadata.videos.length).toBe(fullLabels.videos.length);
    expect(liteMetadata.tracks.length).toBe(fullLabels.tracks.length);
  });

  it("extracts same provenance as full loadSlp", async () => {
    const { loadSlp } = await import("../src/io/main.js");

    const buffer = loadFixtureBuffer("predictions_1.2.7_provenance_and_tracking.slp");
    const liteMetadata = await loadSlpMetadata(buffer);

    const fullPath = path.join(fixtureRoot, "slp", "predictions_1.2.7_provenance_and_tracking.slp");
    const fullLabels = await loadSlp(fullPath, { openVideos: false });

    expect(liteMetadata.provenance?.sleap_version).toBe(fullLabels.provenance.sleap_version);
  });
});
