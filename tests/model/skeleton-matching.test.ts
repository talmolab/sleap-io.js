/* @vitest-environment node */
/**
 * Ports of test_matching.py::TestSkeletonMatcher (GROUP 1) plus direct coverage
 * of Skeleton.matches / Skeleton.nodeSimilarities.
 *
 * Ground truth: C:/Users/Talmo/code/sleap-io/tests/model/test_matching.py
 * (pinned @ 054cce39f), lines 30-90 (TestSkeletonMatcher) and 585-602
 * (test_skeleton_matcher_invalid_method). The empty-skeleton cases are derived
 * from ARCHITECTURE §4.1 / PARITY-CHECKLIST §1.B (no direct Python test, but the
 * Python semantics are fixed by Skeleton.matches / node_similarities).
 */
import { describe, it, expect } from "vitest";
import { Skeleton } from "../../src/model/skeleton.js";
import {
  SkeletonMatcher,
  SkeletonMatchMethod,
} from "../../src/model/matching.js";

describe("SkeletonMatcher", () => {
  // test_matching.py:33-50 (test_exact_match)
  it("exact: identical nodes+edges match; reversed node order does not", () => {
    const skel1 = new Skeleton({
      nodes: ["head", "thorax", "abdomen"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });
    const skel2 = new Skeleton({
      nodes: ["head", "thorax", "abdomen"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });
    const skel3 = new Skeleton({
      // Different order.
      nodes: ["abdomen", "thorax", "head"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });

    const matcher = new SkeletonMatcher(SkeletonMatchMethod.EXACT);
    expect(matcher.match(skel1, skel2)).toBe(true);
    expect(matcher.match(skel1, skel3)).toBe(false); // Different order.
  });

  // test_matching.py:52-69 (test_structure_match)
  it("structure: same node set + edges match regardless of order; different node fails", () => {
    const skel1 = new Skeleton({
      nodes: ["head", "thorax", "abdomen"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });
    const skel2 = new Skeleton({
      // Different order.
      nodes: ["abdomen", "thorax", "head"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });
    const skel3 = new Skeleton({
      // Different node ("tail" instead of "abdomen").
      nodes: ["head", "thorax", "tail"],
      edges: [
        ["head", "thorax"],
        ["thorax", "tail"],
      ],
    });

    const matcher = new SkeletonMatcher(SkeletonMatchMethod.STRUCTURE);
    expect(matcher.match(skel1, skel2)).toBe(true); // Same structure, diff order.
    expect(matcher.match(skel1, skel3)).toBe(false); // Different nodes.
  });

  // test_matching.py:71-79 (test_overlap_match)
  it("overlap: 2/3 (jaccard 0.5) >= min_overlap 0.5 matches; 0/3 does not", () => {
    const skel1 = new Skeleton({ nodes: ["head", "thorax", "abdomen"] });
    const skel2 = new Skeleton({ nodes: ["head", "thorax", "tail"] }); // 2/3 overlap.
    const skel3 = new Skeleton({ nodes: ["wing1", "wing2", "tail"] }); // 0/3 overlap.

    const matcher = new SkeletonMatcher(SkeletonMatchMethod.OVERLAP, {
      minOverlap: 0.5,
    });
    // intersection 2, union 4 -> jaccard 0.5 >= 0.5 (inclusive) -> match.
    expect(matcher.match(skel1, skel2)).toBe(true);
    // jaccard 0 < 0.5 -> no match.
    expect(matcher.match(skel1, skel3)).toBe(false);
  });

  // test_matching.py:81-90 (test_subset_match) — asymmetric.
  it("subset: skel1 ⊆ skel2 matches; non-subset and reversed direction do not", () => {
    const skel1 = new Skeleton({ nodes: ["head", "thorax"] });
    const skel2 = new Skeleton({
      nodes: ["head", "thorax", "abdomen", "tail"],
    });
    const skel3 = new Skeleton({ nodes: ["head", "wing"] });

    const matcher = new SkeletonMatcher(SkeletonMatchMethod.SUBSET);
    expect(matcher.match(skel1, skel2)).toBe(true); // skel1 ⊆ skel2.
    expect(matcher.match(skel1, skel3)).toBe(false); // "thorax" missing.
    expect(matcher.match(skel2, skel1)).toBe(false); // asymmetric: skel2 ⊄ skel1.
  });

  // test_matching.py:585-602 (test_skeleton_matcher_invalid_method).
  // Python injects a Mock method via object.__setattr__ to bypass the converter;
  // the JS substitute mutates matcher.method to a bogus string directly.
  it("match() throws on an unknown method", () => {
    const skel1 = new Skeleton({ nodes: ["head", "thorax"] });
    const skel2 = new Skeleton({ nodes: ["head", "thorax"] });

    const matcher = new SkeletonMatcher(SkeletonMatchMethod.EXACT);
    // Bypass the constructor converter to inject an invalid method.
    (matcher as unknown as { method: string }).method = "INVALID_METHOD";

    expect(() => matcher.match(skel1, skel2)).toThrow(
      /Unknown skeleton match method/,
    );
  });

  // PARITY-CHECKLIST §1.B / ARCH §4.1 (no direct Python test): empty skeletons.
  describe("empty skeletons (ARCH §4.1)", () => {
    it("EXACT and STRUCTURE match two empty skeletons", () => {
      const a = new Skeleton({ nodes: [] });
      const b = new Skeleton({ nodes: [] });
      const exact = new SkeletonMatcher(SkeletonMatchMethod.EXACT);
      const structure = new SkeletonMatcher(SkeletonMatchMethod.STRUCTURE);
      expect(exact.match(a, b)).toBe(true);
      expect(structure.match(a, b)).toBe(true);
    });

    it("OVERLAP of two empty skeletons (jaccard 0) fails for min_overlap > 0", () => {
      const a = new Skeleton({ nodes: [] });
      const b = new Skeleton({ nodes: [] });
      // jaccard over empty union is 0; 0 >= 0.5 is false.
      const matcher = new SkeletonMatcher(SkeletonMatchMethod.OVERLAP, {
        minOverlap: 0.5,
      });
      expect(matcher.match(a, b)).toBe(false);
    });
  });
});

describe("Skeleton.matches / nodeSimilarities (direct)", () => {
  // Backs test_matching.py exact/structure semantics; compares by node NAME.
  it("matches() compares by node name with requireSameOrder semantics", () => {
    const s1 = new Skeleton({
      nodes: ["head", "thorax", "abdomen"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });
    const reordered = new Skeleton({
      nodes: ["abdomen", "thorax", "head"],
      edges: [
        ["head", "thorax"],
        ["thorax", "abdomen"],
      ],
    });

    // requireSameOrder=false (structure): set equality -> match.
    expect(s1.matches(reordered)).toBe(true);
    expect(s1.matches(reordered, { requireSameOrder: false })).toBe(true);
    // requireSameOrder=true (exact): ordered list differs -> no match.
    expect(s1.matches(reordered, { requireSameOrder: true })).toBe(false);
  });

  it("matches() short-circuits false on a node-count mismatch", () => {
    const s1 = new Skeleton({ nodes: ["a", "b"] });
    const s2 = new Skeleton({ nodes: ["a", "b", "c"] });
    expect(s1.matches(s2)).toBe(false);
  });

  it("matches() requires the same directed edge set", () => {
    const s1 = new Skeleton({
      nodes: ["a", "b"],
      edges: [["a", "b"]],
    });
    const s2 = new Skeleton({
      nodes: ["a", "b"],
      edges: [["b", "a"]], // reversed direction
    });
    expect(s1.matches(s2)).toBe(false);
  });

  it("nodeSimilarities() reports the jaccard used by OVERLAP", () => {
    const skel1 = new Skeleton({ nodes: ["head", "thorax", "abdomen"] });
    const skel2 = new Skeleton({ nodes: ["head", "thorax", "tail"] });
    const m = skel1.nodeSimilarities(skel2);
    // intersection {head,thorax}=2; union 4; self-only {abdomen}=1; other-only {tail}=1.
    expect(m.nCommon).toBe(2);
    expect(m.nSelfOnly).toBe(1);
    expect(m.nOtherOnly).toBe(1);
    expect(m.jaccard).toBeCloseTo(0.5, 10);
    expect(m.dice).toBeCloseTo(2 / 3, 10);
  });

  it("nodeSimilarities() of two empty skeletons yields jaccard 0", () => {
    const a = new Skeleton({ nodes: [] });
    const b = new Skeleton({ nodes: [] });
    const m = a.nodeSimilarities(b);
    expect(m.nCommon).toBe(0);
    expect(m.jaccard).toBe(0);
    expect(m.dice).toBe(0);
  });

  it("nodeSimilarities() of disjoint skeletons yields jaccard 0", () => {
    const skel1 = new Skeleton({ nodes: ["head", "thorax", "abdomen"] });
    const skel3 = new Skeleton({ nodes: ["wing1", "wing2", "tail"] });
    const m = skel1.nodeSimilarities(skel3);
    expect(m.nCommon).toBe(0);
    expect(m.jaccard).toBe(0);
  });
});
