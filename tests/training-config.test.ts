/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
  readTrainingConfigSkeleton,
  readTrainingConfigSkeletons,
  isTrainingConfig,
} from "../src/codecs/training-config.js";
import { readSkeletonJson } from "../src/codecs/skeleton-json.js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

function loadFixtureJson(filename: string): string {
  return fs.readFileSync(path.join(fixtureRoot, "slp", filename), "utf-8");
}

describe("Training Config Skeleton", () => {
  it("reads fly32.training_config.json", () => {
    const json = loadFixtureJson("fly32.training_config.json");
    const skeleton = readTrainingConfigSkeleton(json);
    expect(skeleton.nodes.length).toBe(32);
    expect(skeleton.nodeNames).toContain("head");
    expect(skeleton.edges.length).toBeGreaterThan(0);
  });

  it("reads single_node_training_config.json", () => {
    const json = loadFixtureJson("single_node_training_config.json");
    const skeleton = readTrainingConfigSkeleton(json);
    expect(skeleton.nodes.length).toBe(1);
  });

  it("reads skeleton-order-bug/training_config_13pt_fly.json", () => {
    const json = loadFixtureJson(
      "skeleton-order-bug/training_config_13pt_fly.json"
    );
    const skeleton = readTrainingConfigSkeleton(json);
    expect(skeleton.nodes.length).toBe(13);
    expect(skeleton.edges.length).toBeGreaterThan(0);
  });

  it("training config skeleton matches standalone skeleton", () => {
    const configJson = loadFixtureJson(
      "skeleton-order-bug/training_config_13pt_fly.json"
    );
    const standaloneJson = loadFixtureJson(
      "skeleton-order-bug/skeleton_13pt_fly.json"
    );

    const configSkeleton = readTrainingConfigSkeleton(configJson);
    const standaloneSkeleton = readSkeletonJson(standaloneJson);

    expect(configSkeleton.nodeNames).toEqual(standaloneSkeleton.nodeNames);
    expect(configSkeleton.edges.length).toBe(standaloneSkeleton.edges.length);
  });

  it("isTrainingConfig detects format correctly", () => {
    const configJson = loadFixtureJson("fly32.training_config.json");
    expect(isTrainingConfig(configJson)).toBe(true);

    const skeletonJson = loadFixtureJson("flies13.skeleton.json");
    expect(isTrainingConfig(skeletonJson)).toBe(false);
  });

  it("readTrainingConfigSkeletons returns array", () => {
    const json = loadFixtureJson("fly32.training_config.json");
    const skeletons = readTrainingConfigSkeletons(json);
    expect(skeletons.length).toBeGreaterThan(0);
    expect(skeletons[0].nodes.length).toBe(32);
  });
});
