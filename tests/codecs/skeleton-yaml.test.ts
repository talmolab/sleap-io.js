/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { decodeYamlSkeleton, encodeYamlSkeleton } from "../../src/codecs/skeleton-yaml.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("../data/slp", import.meta.url));

async function readFixture(filename: string) {
  return readFile(path.join(fixtureRoot, filename), "utf8");
}

describe("skeleton YAML codec", () => {
  it("decodes a single skeleton YAML file", async () => {
    const yamlText = await readFixture("flies13.skeleton.yml");
    const decoded = decodeYamlSkeleton(yamlText);
    const skeletons = Array.isArray(decoded) ? decoded : [decoded];
    expect(skeletons).toHaveLength(1);

    const skeleton = skeletons[0];
    expect(skeleton.name).toBe("Skeleton-0");
    expect(skeleton.nodeNames).toEqual([
      "head",
      "thorax",
      "abdomen",
      "wingL",
      "wingR",
      "forelegL4",
      "forelegR4",
      "midlegL4",
      "midlegR4",
      "hindlegL4",
      "hindlegR4",
      "eyeL",
      "eyeR",
    ]);
    expect(skeleton.edges).toHaveLength(12);
    expect(skeleton.edges[0].source.name).toBe("head");
    expect(skeleton.edges[0].destination.name).toBe("eyeL");
    expect(skeleton.symmetries).toHaveLength(10);
    expect(skeleton.symmetryNames[0]).toEqual(["wingL", "wingR"]);
  });

  it("decodes YAML with a named skeleton mapping", async () => {
    const yamlText = await readFixture("fly32.skeleton.yaml");
    const decoded = decodeYamlSkeleton(yamlText);
    const skeletons = Array.isArray(decoded) ? decoded : [decoded];
    expect(skeletons).toHaveLength(1);
    const skeleton = skeletons[0];
    expect(skeleton.name).toBe(
      "M:/talmo/data/leap_datasets/BermanFlies/2018-05-03_cluster-sampled.k=10,n=150.labels.mat"
    );
    expect(skeleton.nodeNames).toHaveLength(32);
    expect(skeleton.edges.length).toBeGreaterThan(0);
    expect(skeleton.symmetries).toHaveLength(0);
  });

  it("round-trips skeleton YAML", async () => {
    const yamlText = await readFixture("flies13.skeleton.yml");
    const decoded = decodeYamlSkeleton(yamlText);
    const skeletons = Array.isArray(decoded) ? decoded : [decoded];
    const encoded = encodeYamlSkeleton(skeletons[0]);
    const roundTrip = decodeYamlSkeleton(encoded);
    const roundSkeleton = Array.isArray(roundTrip) ? roundTrip[0] : roundTrip;

    expect(roundSkeleton.nodeNames).toEqual(skeletons[0].nodeNames);
    expect(roundSkeleton.edgeIndices).toEqual(skeletons[0].edgeIndices);
    expect(roundSkeleton.symmetryNames).toEqual(skeletons[0].symmetryNames);
  });

  it("encodes multiple skeletons into a mapping", () => {
    const left = new Skeleton({ name: "Left", nodes: ["a", "b"] });
    const right = new Skeleton({ name: "Right", nodes: ["x", "y"] });
    const yamlText = encodeYamlSkeleton([left, right]);
    const decoded = decodeYamlSkeleton(yamlText);
    const skeletons = Array.isArray(decoded) ? decoded : [decoded];
    const names = skeletons.map((skeleton) => skeleton.name).sort();
    expect(names).toEqual(["Left", "Right"]);
  });
});
