import { describe, it, expect } from "./bun-test";
import { readSkeletonJson, writeSkeletonJson } from "../src/codecs/skeleton-json.js";
import { Skeleton, Node, Edge, Symmetry } from "../src/model/skeleton.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

function loadFixtureJson(filename: string): string {
  return fs.readFileSync(path.join(fixtureRoot, "slp", filename), "utf-8");
}

// Content comparison helpers (order-independent; the jsonpickle format does not
// preserve node order, mirroring Python — assert membership, not ordering).
const nameKeys = (s: Skeleton) => [...s.nodeNames].sort();
const edgeKeys = (s: Skeleton) =>
  s.edges.map((e) => `${e.source.name} ${e.destination.name}`).sort();
const symKeys = (s: Skeleton) =>
  s.symmetryNames.map(([a, b]) => [a, b].slice().sort().join(" ")).sort();

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

describe("writeSkeletonJson", () => {
  // Read a fixture, write it back out, read again, and assert content survives.
  function roundTripFixture(original: Skeleton): Skeleton {
    const json = writeSkeletonJson(original);
    expect(typeof json).toBe("string");
    return readSkeletonJson(json);
  }

  it("round-trips flies13 (edges + symmetries)", () => {
    const original = readSkeletonJson(loadFixtureJson("flies13.skeleton.json"));
    const reparsed = roundTripFixture(original);
    expect(reparsed.nodes.length).toBe(original.nodes.length);
    expect(nameKeys(reparsed)).toEqual(nameKeys(original));
    expect(edgeKeys(reparsed)).toEqual(edgeKeys(original));
    expect(symKeys(reparsed)).toEqual(symKeys(original));
    expect(reparsed.symmetryNames.length).toBeGreaterThan(0);
    expect(reparsed.name).toBe(original.name);
  });

  it("round-trips fly32 (32 nodes, 25 edges, no symmetries)", () => {
    const arr = JSON.parse(loadFixtureJson("fly32.skeleton.json")) as unknown[];
    const original = readSkeletonJson(arr[0] as Record<string, unknown>);
    const reparsed = roundTripFixture(original);
    expect(reparsed.nodes.length).toBe(32);
    expect(nameKeys(reparsed)).toEqual(nameKeys(original));
    expect(edgeKeys(reparsed)).toEqual(edgeKeys(original));
    expect(reparsed.symmetryNames.length).toBe(0);
  });

  it("round-trips mice_hc", () => {
    const parsed = JSON.parse(loadFixtureJson("mice_hc.json")) as Record<string, unknown>;
    const original = readSkeletonJson(parsed.nx_graph as Record<string, unknown>);
    const reparsed = roundTripFixture(original);
    expect(reparsed.nodes.length).toBe(5);
    expect(nameKeys(reparsed)).toEqual(nameKeys(original));
    expect(edgeKeys(reparsed)).toEqual(edgeKeys(original));
    expect(reparsed.name).toBe("Skeleton-0");
  });

  it("emits jsonpickle duplicate-object structure (py/object nodes, py/reduce then py/id edge types)", () => {
    const original = readSkeletonJson(loadFixtureJson("flies13.skeleton.json"));
    const data = JSON.parse(writeSkeletonJson(original)) as Record<string, unknown>;
    expect(data.directed).toBe(true);
    expect(data.multigraph).toBe(true);
    const links = data.links as Array<Record<string, any>>;
    // Every link source/target is a fresh py/object Node (duplicate-object mode).
    expect(links[0].source["py/object"]).toBe("sleap.skeleton.Node");
    expect(links[0].source["py/state"]["py/tuple"][1]).toBe(1.0);
    // First edge type is a py/reduce; a later edge reuses it via py/id.
    expect(links[0].type["py/reduce"][0]["py/type"]).toBe("sleap.skeleton.EdgeType");
    expect(links[0].type["py/reduce"][1]["py/tuple"][0]).toBe(1);
    expect(links[1].type["py/id"]).toBe(1);
    // num_edges_inserted matches the edge count.
    expect((data.graph as any).num_edges_inserted).toBe(original.edges.length);
  });

  it("returns a bare object for one skeleton and an array for a list", () => {
    const sk = readSkeletonJson(loadFixtureJson("flies13.skeleton.json"));
    expect(Array.isArray(JSON.parse(writeSkeletonJson(sk)))).toBe(false);
    const arr = JSON.parse(writeSkeletonJson([sk])) as unknown[];
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(1);
    // Each element round-trips independently.
    expect(readSkeletonJson(arr[0] as Record<string, unknown>).nodes.length).toBe(13);
  });

  it("preserves an isolated node (no edges/symmetries) through round-trip", () => {
    const [a, b, c] = [new Node("a"), new Node("b"), new Node("c")];
    const original = new Skeleton({
      nodes: [a, b, c],
      edges: [new Edge(a, b)],
      name: "Iso",
    });
    const reparsed = roundTripFixture(original);
    expect(reparsed.nodes.length).toBe(3);
    expect(nameKeys(reparsed)).toEqual(["a", "b", "c"]);
    expect(edgeKeys(reparsed)).toEqual(["a b"]);
  });

  it("preserves a nodes-only skeleton (no links at all)", () => {
    const original = new Skeleton({
      nodes: [new Node("x"), new Node("y")],
      name: "NodesOnly",
    });
    const reparsed = roundTripFixture(original);
    expect(reparsed.nodes.length).toBe(2);
    expect(nameKeys(reparsed)).toEqual(["x", "y"]);
    expect(reparsed.edges.length).toBe(0);
  });

  it("round-trips a symmetry-bearing skeleton built from scratch", () => {
    const [l, r, m] = [new Node("L"), new Node("R"), new Node("mid")];
    const original = new Skeleton({
      nodes: [l, r, m],
      edges: [new Edge(m, l), new Edge(m, r)],
      symmetries: [new Symmetry([l, r])],
      name: "Sym",
    });
    const reparsed = roundTripFixture(original);
    expect(nameKeys(reparsed)).toEqual(["L", "R", "mid"]);
    expect(edgeKeys(reparsed)).toEqual(["mid L", "mid R"]);
    expect(symKeys(reparsed)).toEqual(["L R"]);
  });
});
