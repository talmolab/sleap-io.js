/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readSkeletonJson } from "../src/codecs/skeleton-json.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

function loadFixtureJson(filename: string): string {
  return fs.readFileSync(path.join(fixtureRoot, "slp", filename), "utf-8");
}

describe("Skeleton JSON codec", () => {
  it("reads flies13.skeleton.json", () => {
    const json = loadFixtureJson("flies13.skeleton.json");
    const skeleton = readSkeletonJson(json);
    expect(skeleton.nodes.length).toBe(13);
    expect(skeleton.nodeNames).toContain("head");
    expect(skeleton.nodeNames).toContain("thorax");
    expect(skeleton.edges.length).toBeGreaterThan(0);
    expect(skeleton.symmetries.length).toBeGreaterThan(0);
    expect(skeleton.name).toBe("Skeleton-0");
  });

  it("reads fly32.skeleton.json", () => {
    const raw = loadFixtureJson("fly32.skeleton.json");
    // fly32 is wrapped in an array
    const arr = JSON.parse(raw) as unknown[];
    const skeleton = readSkeletonJson(arr[0] as Record<string, unknown>);
    expect(skeleton.nodes.length).toBe(32);
    expect(skeleton.nodeNames).toContain("head");
    expect(skeleton.edges.length).toBe(25);
    expect(skeleton.name).toBeDefined();
  });

  it("reads mice_hc.json", () => {
    const raw = loadFixtureJson("mice_hc.json");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // mice_hc has nx_graph wrapper
    const skeleton = readSkeletonJson(parsed.nx_graph as Record<string, unknown>);
    expect(skeleton.nodes.length).toBe(5);
    expect(skeleton.nodeNames).toContain("nose1");
    expect(skeleton.edges.length).toBe(4);
    expect(skeleton.name).toBe("Skeleton-0");
  });

  it("reads labels.v002.rel_paths.skeleton.json", () => {
    const json = loadFixtureJson("labels.v002.rel_paths.skeleton.json");
    const skeleton = readSkeletonJson(json);
    expect(skeleton.nodes.length).toBe(2);
    expect(skeleton.nodeNames).toContain("head");
    expect(skeleton.nodeNames).toContain("abdomen");
    expect(skeleton.edges.length).toBe(1);
  });

  it("reads skeleton-order-bug/skeleton_13pt_fly.json", () => {
    const json = loadFixtureJson("skeleton-order-bug/skeleton_13pt_fly.json");
    const skeleton = readSkeletonJson(json);
    expect(skeleton.nodes.length).toBe(13);
    expect(skeleton.edges.length).toBeGreaterThan(0);
  });

  it("symmetries are deduplicated", () => {
    const json = loadFixtureJson("flies13.skeleton.json");
    const skeleton = readSkeletonJson(json);
    // Symmetry pairs should not be duplicated (A-B and B-A count as one)
    const symKeys = new Set<string>();
    for (const [a, b] of skeleton.symmetryNames) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      expect(symKeys.has(key)).toBe(false);
      symKeys.add(key);
    }
  });

  it("loadSkeletonJson auto-detects standalone format", () => {
    const json = loadFixtureJson("flies13.skeleton.json");
    const skeleton = readSkeletonJson(json);
    expect(skeleton.nodes.length).toBe(13);
  });
});
