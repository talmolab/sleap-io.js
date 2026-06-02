/**
 * Permanent regression suite for edge-less / isolated-node skeletons
 * (sleap-io.js issue #148; Python sleap-io PR #438, commit 63b77132e).
 *
 * Background
 * ----------
 * Python sleap-io PR #438 fixed a bug in its jsonpickle SkeletonEncoder: for
 * edge-less skeletons (a single node, or nodes that participate in no edge) the
 * encoder used to emit dangling `py/id` back-references with no preceding
 * `py/object` definition, so those isolated nodes decoded to nothing and the
 * skeleton round-tripped to EMPTY. The fix makes the encoder emit FULL node
 * objects for isolated nodes.
 *
 * Does this reproduce in the JS port?  No -- and this suite proves it across
 * EVERY skeleton serialization path, so the property can never silently
 * regress:
 *
 *   - The JS port has NO jsonpickle ENCODER, so the Python encoder bug has no
 *     JS analogue. The SLP WRITE path (serializeSkeletons, write.ts) emits the
 *     integer-index node-link format: a global `nodes:[{name}]` list plus a
 *     per-skeleton `nodes:[{id:<int>}]` list of ALL node ids derived from
 *     `skeleton.nodeNames` (NOT from links), so isolated ids are listed
 *     explicitly. This matches Python sleap-io 0.8.0's on-disk SLP format.
 *   - The SLP READ path (parseSkeletons, parsers.ts) rebuilds the node list
 *     from that `nodes:[{id}]` array (NOT from links), preserving isolated
 *     nodes' count AND declared order.
 *   - The jsonpickle DECODER (readSkeletonJson, skeleton-json.ts) decodes the
 *     exact bytes Python's encode_skeleton produces, recovering isolated nodes
 *     from the `nodes[]` array even when they appear in no link.
 *   - The YAML codec (skeleton-yaml.ts) and training-config extraction
 *     (training-config.ts) serialize/extract the full node list independently
 *     of edges.
 *
 * Coverage
 * --------
 *   1. SLP JS write -> JS read round-trip: single / one-isolated /
 *      multiple-isolated / symmetry-only-node / two-skeletons-shared-nodes /
 *      isolated-declared-first. Asserts node NAMES and ORDER, edge/symmetry
 *      counts and contents.
 *   2. SLP encoder GUARD: a direct read of the written /metadata JSON proving
 *      the per-skeleton nodes[] lists ALL ids (incl. isolated). This FAILS if a
 *      future change makes the encoder derive nodes from links.
 *   3. readSkeletonJson shared-object AND duplicate-object jsonpickle forms with
 *      isolated nodes, against exact Python 0.8.0 encode_skeleton golden bytes.
 *   4. YAML codec round-trip for every case.
 *   5. training-config skeleton extraction for the jsonpickle cases.
 *   6. Python <-> JS cross-compat over SLP, both directions (gated on a usable
 *      Python interpreter; skips gracefully otherwise).
 *
 * For SLP round-trips use loadSlp(bytes/path, { openVideos: false }) so the
 * dummy video is never opened.
 */
import { describe, it, expect, setDefaultTimeout } from "../bun-test";
import { readSkeletonJson } from "../../src/codecs/skeleton-json.js";
import {
  decodeYamlSkeleton,
  encodeYamlSkeleton,
} from "../../src/codecs/skeleton-yaml.js";
import { readTrainingConfigSkeletons } from "../../src/codecs/training-config.js";
import { saveSlpToBytes } from "../../src/codecs/slp/write.js";
import { loadSlp } from "../../src/io/main.js";
import { Skeleton, Node, Edge, Symmetry } from "../../src/model/skeleton.js";
import { Labels } from "../../src/model/labels.js";
import { Instance } from "../../src/model/instance.js";
import { LabeledFrame } from "../../src/model/labeled-frame.js";
import { Video } from "../../src/model/video.js";
import { ready, File as H5File } from "h5wasm/node";
import { execFileSync } from "node:child_process";
import {
  writeFileSync,
  unlinkSync,
  existsSync,
  accessSync,
  constants,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Cross-compat tests may shell out to Python (cold `uv` cache can be slow).
setDefaultTimeout(120_000);

// ---------------------------------------------------------------------------
// Exact jsonpickle bytes produced by Python sleap-io 0.8.0 encode_skeleton()
// for the edge-case skeletons (captured verbatim from
// /home/talmo/code/sleap-io/.venv). Hard-coding the on-the-wire form tests the
// JS decoder against the REAL Python output, not a JS-authored approximation.
//
// These are the PR-#438 cases: links carry full py/object node defs; the
// nodes[] array carries py/id back-refs for the linked nodes PLUS a full
// py/object for each ISOLATED node (the bug PR #438 fixed was emitting a
// dangling py/id there instead of the full object).
// ---------------------------------------------------------------------------
const PY_JSONPICKLE = {
  // single node, no edges, no symmetries
  single:
    '{"directed": true, "graph": {"name": "single", "num_edges_inserted": 0}, "links": [], "multigraph": true, "nodes": [{"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["only", 1.0]}}}]}',
  // A,B with edge A-B; C isolated. Links emit A,B as full py/object; the nodes
  // section refs A,B by py/id and emits C as a full py/object. usesSharedNodeRefs
  // is false here (links use py/object, not py/id), so the decoder picks A,B up
  // from the links and C from the nodes[] py/object scan.
  iso_abc:
    '{"directed": true, "graph": {"name": "iso_abc", "num_edges_inserted": 1}, "links": [{"edge_insert_idx": 0, "key": 0, "source": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["A", 1.0]}}, "target": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["B", 1.0]}}, "type": {"py/reduce": [{"py/type": "sleap.skeleton.EdgeType"}, {"py/tuple": [1]}]}}], "multigraph": true, "nodes": [{"id": {"py/id": 1}}, {"id": {"py/id": 2}}, {"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["C", 1.0]}}}]}',
  // all four nodes isolated, no links at all (pure duplicate-object form).
  multi_iso:
    '{"directed": true, "graph": {"name": "multi_iso", "num_edges_inserted": 0}, "links": [], "multigraph": true, "nodes": [{"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["w", 1.0]}}}, {"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["x", 1.0]}}}, {"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["y", 1.0]}}}, {"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["z", 1.0]}}}]}',
  // L,R joined ONLY by a symmetry (type 2 link, no edges); M isolated.
  sym_only:
    '{"directed": true, "graph": {"name": "sym_only", "num_edges_inserted": 0}, "links": [{"key": 0, "source": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["L", 1.0]}}, "target": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["R", 1.0]}}, "type": {"py/reduce": [{"py/type": "sleap.skeleton.EdgeType"}, {"py/tuple": [2]}]}}], "multigraph": true, "nodes": [{"id": {"py/id": 1}}, {"id": {"py/id": 2}}, {"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["M", 1.0]}}}]}',
};

// Hand-crafted jsonpickle "duplicate-object" form: every link carries fresh
// py/object nodes (no py/id refs), and the isolated node C lives ONLY in the
// nodes[] array as a py/object. Exercises the usesSharedNodeRefs=false +
// nodes[] py/object scan branch (skeleton-json.ts:146-159).
const DUP_ISO =
  '{"directed": true, "graph": {"name": "DupIso", "num_edges_inserted": 1}, "links": [{"edge_insert_idx": 0, "key": 0, "source": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["A", 1.0]}}, "target": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["B", 1.0]}}, "type": {"py/reduce": [{"py/type": "sleap.skeleton.EdgeType"}, {"py/tuple": [1]}]}}], "multigraph": true, "nodes": [{"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["A", 1.0]}}}, {"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["B", 1.0]}}}, {"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["C", 1.0]}}}]}';
// Pure single-node duplicate-object form (no links at all).
const DUP_SINGLE =
  '{"directed": true, "graph": {"name": "DupSingle", "num_edges_inserted": 0}, "links": [], "multigraph": true, "nodes": [{"id": {"py/object": "sleap.skeleton.Node", "py/state": {"py/tuple": ["solo", 1.0]}}}]}';

// ---------------------------------------------------------------------------
// Case matrix. `names` is the DECLARED node order, preserved by the SLP
// integer-index path and the YAML codec. `jsonpickleNames`, when present, is the
// link-first order the standalone jsonpickle decoder produces (matching
// Python's own decode_skeleton); the jsonpickle path asserts on the node SET +
// count + order where order is stable.
// ---------------------------------------------------------------------------
type Case = {
  key: string;
  build: () => Skeleton;
  names: string[];
  edgePairs: Array<[string, string]>;
  symPairs: Array<[string, string]>;
  /** jsonpickle/decoder order (Python's link-first decode order). */
  jsonpickleNames?: string[];
};

function makeSingle(): Skeleton {
  return new Skeleton({ nodes: ["only"], name: "single" });
}
function makeIsoAbc(): Skeleton {
  return new Skeleton({
    nodes: ["A", "B", "C"],
    edges: [["A", "B"]],
    name: "iso_abc",
  });
}
function makeMultiIso(): Skeleton {
  return new Skeleton({ nodes: ["w", "x", "y", "z"], name: "multi_iso" });
}
function makeSymOnly(): Skeleton {
  return new Skeleton({
    nodes: ["L", "R", "M"],
    symmetries: [["L", "R"]],
    name: "sym_only",
  });
}
// Isolated node declared FIRST, before the connected pair. Stresses ordering:
// the SLP integer-index format preserves declared order [Z, X, Y]; the
// standalone jsonpickle codec emits a link-first order (Python's own decoder
// returns [X, Y, Z] for this), so the jsonpickle-order field differs.
function makeIsoFirst(): Skeleton {
  return new Skeleton({
    nodes: ["Z", "X", "Y"],
    edges: [["X", "Y"]],
    name: "iso_first",
  });
}

// Cases whose jsonpickle golden bytes are pinned above.
const JSONPICKLE_CASES: Case[] = [
  {
    key: "single",
    build: makeSingle,
    names: ["only"],
    edgePairs: [],
    symPairs: [],
  },
  {
    key: "iso_abc",
    build: makeIsoAbc,
    names: ["A", "B", "C"],
    edgePairs: [["A", "B"]],
    symPairs: [],
  },
  {
    key: "multi_iso",
    build: makeMultiIso,
    names: ["w", "x", "y", "z"],
    edgePairs: [],
    symPairs: [],
  },
  {
    key: "sym_only",
    build: makeSymOnly,
    names: ["L", "R", "M"],
    edgePairs: [],
    symPairs: [["L", "R"]],
  },
];

// Full SLP/YAML matrix (adds the order-stress case).
const SLP_CASES: Case[] = [
  ...JSONPICKLE_CASES,
  {
    key: "iso_first",
    build: makeIsoFirst,
    names: ["Z", "X", "Y"],
    edgePairs: [["X", "Y"]],
    symPairs: [],
    jsonpickleNames: ["X", "Y", "Z"],
  },
];

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Build Labels carrying a single instance per skeleton so the writer has data. */
function labelsForSkeleton(sk: Skeleton): Labels {
  const video = new Video({ filename: "dummy.mp4" });
  const inst = new Instance({
    skeleton: sk,
    points: sk.nodes.map(() => ({
      xy: [1, 2] as [number, number],
      visible: true,
      complete: true,
    })),
  });
  const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
  return new Labels({ skeletons: [sk], videos: [video], labeledFrames: [lf] });
}

async function roundTripSlp(labels: Labels): Promise<Labels> {
  const bytes = await saveSlpToBytes(labels);
  return loadSlp(bytes, { openVideos: false });
}

/** Sorted (source, destination) name pairs for an edge list. */
function edgeNamePairs(sk: Skeleton): Array<[string, string]> {
  return sk.edges
    .map((e) => [e.source.name, e.destination.name] as [string, string])
    .sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
}

/** Sorted unordered symmetry name pairs. */
function symNamePairs(sk: Skeleton): Array<[string, string]> {
  return sk.symmetries
    .map((s) => {
      const ns = Array.from(s.nodes)
        .map((n) => n.name)
        .sort();
      return [ns[0], ns[1]] as [string, string];
    })
    .sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
}

function sortPairs(
  pairs: Array<[string, string]>
): Array<[string, string]> {
  return [...pairs].sort((a, b) => (a.join("\0") < b.join("\0") ? -1 : 1));
}

// ===========================================================================
// 1. SLP JS write -> JS read round-trip (declared order preserved).
// ===========================================================================
describe("edge-less skeletons: SLP JS write -> JS read round-trip", () => {
  for (const c of SLP_CASES) {
    it(`round-trips ${c.key} (names, order, edges, symmetries)`, async () => {
      const out = await roundTripSlp(labelsForSkeleton(c.build()));
      const rsk = out.skeletons[0];
      // Integer-index SLP format preserves the FULL declared node order.
      expect(rsk.nodeNames).toEqual(c.names);
      expect(rsk.name).toBe(c.key);
      expect(edgeNamePairs(rsk)).toEqual(sortPairs(c.edgePairs));
      expect(symNamePairs(rsk)).toEqual(sortPairs(c.symPairs));
    });
  }

  it("preserves an isolated node built with explicit Node/Edge/Symmetry objects", async () => {
    const A = new Node("A");
    const B = new Node("B");
    const C = new Node("C");
    const sk = new Skeleton({
      name: "explicit",
      nodes: [A, B, C],
      edges: [new Edge(A, B)],
      symmetries: [new Symmetry([A, B])],
    });
    const out = await roundTripSlp(labelsForSkeleton(sk));
    const rsk = out.skeletons[0];
    expect(rsk.nodeNames).toEqual(["A", "B", "C"]);
    expect(edgeNamePairs(rsk)).toEqual([["A", "B"]]);
    expect(symNamePairs(rsk)).toEqual([["A", "B"]]);
  });

  it("two skeletons sharing global nodes each keep their own isolated node", async () => {
    // sk1: A-B edge, isolated C. sk2: B-C edge, isolated E (reuses B,C names).
    const sk1 = new Skeleton({
      name: "sk1",
      nodes: ["A", "B", "C"],
      edges: [["A", "B"]],
    });
    const sk2 = new Skeleton({
      name: "sk2",
      nodes: ["B", "C", "E"],
      edges: [["B", "C"]],
    });
    const video = new Video({ filename: "dummy.mp4" });
    const i1 = new Instance({
      skeleton: sk1,
      points: sk1.nodes.map(() => ({
        xy: [1, 1] as [number, number],
        visible: true,
        complete: true,
      })),
    });
    const i2 = new Instance({
      skeleton: sk2,
      points: sk2.nodes.map(() => ({
        xy: [2, 2] as [number, number],
        visible: true,
        complete: true,
      })),
    });
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [i1, i2] });
    const labels = new Labels({
      skeletons: [sk1, sk2],
      videos: [video],
      labeledFrames: [lf],
    });
    const out = await roundTripSlp(labels);
    // Per-skeleton nodes[] index lists are independent, so the shared global
    // node pool does not drop sk1's isolated C nor sk2's isolated E.
    expect(out.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    expect(edgeNamePairs(out.skeletons[0])).toEqual([["A", "B"]]);
    expect(out.skeletons[1].nodeNames).toEqual(["B", "C", "E"]);
    expect(edgeNamePairs(out.skeletons[1])).toEqual([["B", "C"]]);
  });
});

// ===========================================================================
// 2. SLP encoder GUARD: the written /metadata must list ALL per-skeleton node
//    ids (incl. isolated), NOT just those reachable from links. This test FAILS
//    if a future change makes serializeSkeletons derive nodes from links.
// ===========================================================================
describe("edge-less skeletons: SLP encoder guard (nodes listed, not link-derived)", () => {
  it("written metadata lists ALL node ids even when most are isolated", async () => {
    await ready;
    // 5 nodes, only A-B has an edge; C,D,E are isolated. A link-derived encoder
    // would emit nodes:[A,B] and silently drop C,D,E.
    const sk = new Skeleton({
      name: "guard",
      nodes: ["A", "B", "C", "D", "E"],
      edges: [["A", "B"]],
    });
    const bytes = await saveSlpToBytes(labelsForSkeleton(sk));

    const tmp = join(
      tmpdir(),
      `edgeless-guard-${Date.now()}-${Math.random().toString(16).slice(2)}.slp`
    );
    writeFileSync(tmp, bytes);
    try {
      const file = new H5File(tmp, "r");
      const meta = JSON.parse(
        file.get("metadata").attrs.json.value as string
      ) as {
        skeletons: Array<{ nodes: Array<{ id: number }>; links: unknown[] }>;
        nodes: Array<{ name: string }>;
      };
      file.close();

      const skel = meta.skeletons[0];
      // The per-skeleton nodes[] must list all 5 ids in declared order.
      expect(skel.nodes.map((n) => n.id)).toEqual([0, 1, 2, 3, 4]);
      // Only ONE link exists (A-B); the node count must exceed link-reachable
      // nodes, proving the encoder did not derive the list from links.
      const linkReachable = new Set<number>();
      for (const link of skel.links as Array<{ source: number; target: number }>) {
        linkReachable.add(link.source);
        linkReachable.add(link.target);
      }
      expect(skel.nodes.length).toBeGreaterThan(linkReachable.size);
      expect(skel.nodes.length).toBe(5);
      // Global nodes pool carries every name.
      expect(meta.nodes.map((n) => n.name).sort()).toEqual([
        "A",
        "B",
        "C",
        "D",
        "E",
      ]);
    } finally {
      unlinkSync(tmp);
    }
  });

  it("symmetry-only nodes still appear in the per-skeleton nodes[] list", async () => {
    await ready;
    // L,R only joined by a symmetry (no edges); M isolated. nodes[] must list
    // all three; links must contain exactly the symmetry (type 2).
    const sk = new Skeleton({
      name: "symguard",
      nodes: ["L", "R", "M"],
      symmetries: [["L", "R"]],
    });
    const bytes = await saveSlpToBytes(labelsForSkeleton(sk));
    const tmp = join(
      tmpdir(),
      `edgeless-symguard-${Date.now()}-${Math.random().toString(16).slice(2)}.slp`
    );
    writeFileSync(tmp, bytes);
    try {
      const file = new H5File(tmp, "r");
      const meta = JSON.parse(
        file.get("metadata").attrs.json.value as string
      ) as { skeletons: Array<{ nodes: Array<{ id: number }>; links: unknown[] }> };
      file.close();
      const skel = meta.skeletons[0];
      expect(skel.nodes.map((n) => n.id)).toEqual([0, 1, 2]);
      // One link (the symmetry), but all three nodes listed.
      expect(skel.links.length).toBe(1);
      expect(skel.nodes.length).toBe(3);
    } finally {
      unlinkSync(tmp);
    }
  });
});

// ===========================================================================
// 3. readSkeletonJson: shared-object AND duplicate-object jsonpickle forms,
//    against exact Python 0.8.0 encode_skeleton golden bytes.
// ===========================================================================
describe("edge-less skeletons: readSkeletonJson (Python jsonpickle golden bytes)", () => {
  for (const c of JSONPICKLE_CASES) {
    it(`decodes Python encode_skeleton bytes for ${c.key} (no decode-to-empty)`, () => {
      const sk = readSkeletonJson(
        PY_JSONPICKLE[c.key as keyof typeof PY_JSONPICKLE]
      );
      const expectedNames = c.jsonpickleNames ?? c.names;
      // Node SET + count must match (the #148 bug was decode-to-empty).
      expect(new Set(sk.nodeNames)).toEqual(new Set(expectedNames));
      expect(sk.nodes.length).toBe(c.names.length);
      expect(edgeNamePairs(sk)).toEqual(sortPairs(c.edgePairs));
      expect(symNamePairs(sk)).toEqual(sortPairs(c.symPairs));
      expect(sk.name).toBe(c.key);
    });
  }

  it("decodes the exact single-node case to ['only'], not empty (the PR #438 case)", () => {
    const sk = readSkeletonJson(PY_JSONPICKLE.single);
    expect(sk.nodeNames).toEqual(["only"]);
    expect(sk.edges.length).toBe(0);
    expect(sk.symmetries.length).toBe(0);
  });

  it("decodes the duplicate-object form with an isolated node only in nodes[]", () => {
    const sk = readSkeletonJson(DUP_ISO);
    expect(new Set(sk.nodeNames)).toEqual(new Set(["A", "B", "C"]));
    expect(sk.nodes.length).toBe(3);
    expect(edgeNamePairs(sk)).toEqual([["A", "B"]]);
  });

  it("decodes the duplicate-object single node with no links", () => {
    const sk = readSkeletonJson(DUP_SINGLE);
    expect(sk.nodeNames).toEqual(["solo"]);
    expect(sk.edges.length).toBe(0);
  });
});

// ===========================================================================
// 4. YAML codec round-trip (full node list independent of edges).
// ===========================================================================
describe("edge-less skeletons: YAML codec round-trip", () => {
  for (const c of SLP_CASES) {
    it(`round-trips ${c.key} through encodeYamlSkeleton -> decodeYamlSkeleton`, () => {
      const yaml = encodeYamlSkeleton(c.build());
      const decoded = decodeYamlSkeleton(yaml);
      const dsk = Array.isArray(decoded) ? decoded[0] : decoded;
      expect(dsk.nodeNames).toEqual(c.names);
      expect(edgeNamePairs(dsk)).toEqual(sortPairs(c.edgePairs));
      expect(symNamePairs(dsk)).toEqual(sortPairs(c.symPairs));
    });
  }
});

// ===========================================================================
// 5. training-config skeleton extraction (delegates to readSkeletonJson).
// ===========================================================================
describe("edge-less skeletons: training-config skeleton extraction", () => {
  for (const c of JSONPICKLE_CASES) {
    it(`extracts ${c.key} from a training-config wrapper`, () => {
      const config = {
        data: {
          labels: {
            skeletons: [
              JSON.parse(PY_JSONPICKLE[c.key as keyof typeof PY_JSONPICKLE]),
            ],
          },
        },
      };
      const skeletons = readTrainingConfigSkeletons(config);
      expect(skeletons.length).toBe(1);
      expect(skeletons[0].nodes.length).toBe(c.names.length);
      expect(new Set(skeletons[0].nodeNames)).toEqual(
        new Set(c.jsonpickleNames ?? c.names)
      );
      expect(skeletons[0].edges.length).toBe(c.edgePairs.length);
      expect(skeletons[0].symmetries.length).toBe(c.symPairs.length);
    });
  }
});

// ===========================================================================
// 6. Python <-> JS cross-compat over the SLP format, both directions.
//    Gated on a usable Python interpreter; skips gracefully otherwise.
// ===========================================================================
const VENV_PYTHON = "/home/talmo/code/sleap-io/.venv/bin/python";

function pythonRunner(): { cmd: string; args: string[] } | null {
  if (existsSync(VENV_PYTHON)) {
    try {
      accessSync(VENV_PYTHON, constants.X_OK);
      execFileSync(VENV_PYTHON, ["-c", "import sleap_io"], { stdio: "pipe" });
      return { cmd: VENV_PYTHON, args: [] };
    } catch {
      /* fall through */
    }
  }
  try {
    execFileSync(
      "uv",
      ["run", "--with", "sleap-io", "python", "-c", "import sleap_io"],
      { stdio: "pipe", timeout: 120_000 }
    );
    return { cmd: "uv", args: ["run", "--with", "sleap-io", "python"] };
  } catch {
    return null;
  }
}

function runPython(
  runner: { cmd: string; args: string[] },
  script: string
): string {
  const pyPath = join(
    tmpdir(),
    `edgeless-py-${Date.now()}-${Math.random().toString(16).slice(2)}.py`
  );
  try {
    writeFileSync(pyPath, script);
    return execFileSync(runner.cmd, [...runner.args, pyPath], {
      encoding: "utf-8",
      timeout: 120_000,
    });
  } finally {
    try {
      unlinkSync(pyPath);
    } catch {
      /* ignore */
    }
  }
}

const runner = pythonRunner();
const describePy = runner ? describe : describe.skip;

describePy("edge-less skeletons: Python <-> JS SLP cross-compat", () => {
  it("JS-written SLP loads in Python with all isolated nodes preserved (JS -> Python)", async () => {
    const r = runner!;
    const tmpFiles: string[] = [];
    try {
      const expectations: Record<
        string,
        { names: string[]; edges: number; sym: number }
      > = {};
      const pathsByKey: Record<string, string> = {};
      for (const c of SLP_CASES) {
        const bytes = await saveSlpToBytes(labelsForSkeleton(c.build()));
        const slpPath = join(
          tmpdir(),
          `edgeless-js-${c.key}-${Date.now()}-${Math.random()
            .toString(16)
            .slice(2)}.slp`
        );
        writeFileSync(slpPath, bytes);
        tmpFiles.push(slpPath);
        pathsByKey[c.key] = slpPath;
        expectations[c.key] = {
          names: c.names,
          edges: c.edgePairs.length,
          sym: c.symPairs.length,
        };
      }

      const script = `
import sleap_io as sio

paths = ${JSON.stringify(pathsByKey)}
expect = ${JSON.stringify(expectations)}

for key, path in paths.items():
    labels = sio.load_slp(path, open_videos=False)
    sk = labels.skeletons[0]
    got = [n.name for n in sk.nodes]
    e = expect[key]
    assert got == e["names"], f"{key}: nodes {got} != {e['names']}"
    assert len(sk.edges) == e["edges"], f"{key}: edges {len(sk.edges)} != {e['edges']}"
    assert len(sk.symmetries) == e["sym"], f"{key}: sym {len(sk.symmetries)} != {e['sym']}"

print("OK: Python read all JS-written edge-less skeletons")
`;
      const out = runPython(r, script);
      expect(out).toContain(
        "OK: Python read all JS-written edge-less skeletons"
      );
    } finally {
      for (const f of tmpFiles) {
        try {
          unlinkSync(f);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("Python-written SLP loads in JS with all isolated nodes preserved (Python -> JS)", async () => {
    const r = runner!;
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const expectations: Record<
      string,
      { names: string[]; edges: number; sym: number }
    > = {
      single: { names: ["only"], edges: 0, sym: 0 },
      iso_abc: { names: ["A", "B", "C"], edges: 1, sym: 0 },
      multi_iso: { names: ["w", "x", "y", "z"], edges: 0, sym: 0 },
      sym_only: { names: ["L", "R", "M"], edges: 0, sym: 1 },
      iso_first: { names: ["Z", "X", "Y"], edges: 1, sym: 0 },
    };
    const pathsByKey: Record<string, string> = {};
    for (const key of Object.keys(expectations)) {
      pathsByKey[key] = join(tmpdir(), `edgeless-py-${key}-${stamp}.slp`);
    }

    const script = `
import sleap_io as sio
from sleap_io import Skeleton, Labels, Video

paths = ${JSON.stringify(pathsByKey)}

def build(key):
    if key == "single":
        return Skeleton(nodes=["only"], name="single")
    if key == "iso_abc":
        s = Skeleton(nodes=["A", "B", "C"], name="iso_abc"); s.add_edge("A", "B"); return s
    if key == "multi_iso":
        return Skeleton(nodes=["w", "x", "y", "z"], name="multi_iso")
    if key == "sym_only":
        s = Skeleton(nodes=["L", "R", "M"], name="sym_only"); s.add_symmetry("L", "R"); return s
    if key == "iso_first":
        s = Skeleton(nodes=["Z", "X", "Y"], name="iso_first"); s.add_edge("X", "Y"); return s
    raise ValueError(key)

for key, path in paths.items():
    sk = build(key)
    labels = Labels(videos=[Video.from_filename("dummy.mp4")], skeletons=[sk], labeled_frames=[])
    sio.save_slp(labels, path)

print("OK: Python wrote all edge-less skeletons")
`;
    const out = runPython(r, script);
    expect(out).toContain("OK: Python wrote all edge-less skeletons");

    try {
      for (const [key, path] of Object.entries(pathsByKey)) {
        const labels = await loadSlp(path, { openVideos: false });
        const sk = labels.skeletons[0];
        const e = expectations[key];
        expect(sk.nodeNames).toEqual(e.names);
        expect(sk.edges.length).toBe(e.edges);
        expect(sk.symmetries.length).toBe(e.sym);
      }
    } finally {
      for (const path of Object.values(pathsByKey)) {
        try {
          unlinkSync(path);
        } catch {
          /* ignore */
        }
      }
    }
  });
});
