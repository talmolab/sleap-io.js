/**
 * Regression: classic PyQt-SLEAP `.slp` files serialize each skeleton as a
 * jsonpickle of `sleap.skeleton.Skeleton`, wrapping the networkx node-link graph
 * under an `nx_graph` key — `{ description, nx_graph: { nodes, links, graph, … },
 * preview_image }` — whereas modern sleap-io writes the node-link dict FLAT on the
 * entry (`{ nodes, links, graph, … }`).
 *
 * `parseSkeletons` only read the flat shape (`entry.nodes` / `entry.links`). For a
 * classic file it found no `entry.nodes`, then fell back to "all global nodes",
 * so a 2-node skeleton on a project whose global `nodes` list still carried the
 * parent 13-node fly (e.g. `clip.2node.slp`) decoded to a 13-node, edge-less
 * skeleton — silently different from what Python sleap-io reads, which made
 * Merge-into-Project wrongly block on "skeleton mismatch".
 *
 * This asserts the classic `nx_graph` shape decodes to the correct SUBSET.
 */
import { describe, it, expect } from "../bun-test";
import { parseSkeletons } from "../../src/codecs/slp/parsers.js";

// 13-node global list (parent fly); the 2-node skeleton references head=11,
// thorax=4 by index — mirroring tracks/clip.2node.slp.
const GLOBAL_13 = [
  "forelegL4",
  "wingR",
  "hindlegR4",
  "eyeL",
  "thorax",
  "abdomen",
  "eyeR",
  "wingL",
  "forelegR4",
  "midlegL4",
  "midlegR4",
  "head",
  "hindlegL4",
].map((name) => ({ name }));

const bodyEdgeType = {
  "py/reduce": [{ "py/type": "sleap.skeleton.EdgeType" }, { "py/tuple": [1] }],
};

describe("parseSkeletons — classic nx_graph-wrapped skeleton", () => {
  it("decodes only the referenced subset, not the whole global node list", () => {
    const metadataJson = {
      nodes: GLOBAL_13,
      skeletons: [
        {
          description: null,
          nx_graph: {
            directed: true,
            graph: { name: "Skeleton-3", num_edges_inserted: 12 },
            multigraph: true,
            nodes: [{ id: 11 }, { id: 4 }], // head, thorax
            links: [
              {
                edge_insert_idx: 0,
                key: 0,
                source: 4,
                target: 11,
                type: bodyEdgeType,
              },
            ],
          },
          preview_image: null,
        },
      ],
    };

    const skeletons = parseSkeletons(metadataJson);
    expect(skeletons.length).toBe(1);
    const s = skeletons[0];
    expect(s.nodes.map((n) => n.name)).toEqual(["head", "thorax"]);
    expect(s.name).toBe("Skeleton-3");
    // Edge thorax(4)->head(11) remapped to local indices [thorax=1, head=0].
    expect(s.edges.length).toBe(1);
  });

  it("still decodes the flat (sleap-io) shape correctly", () => {
    const metadataJson = {
      nodes: [{ name: "A" }, { name: "B" }, { name: "C" }],
      skeletons: [
        {
          directed: true,
          graph: { name: "flat" },
          multigraph: true,
          nodes: [{ id: 0 }, { id: 2 }], // A, C — subset of a 3-node global list
          links: [],
        },
      ],
    };
    const s = parseSkeletons(metadataJson)[0];
    expect(s.nodes.map((n) => n.name)).toEqual(["A", "C"]);
    expect(s.name).toBe("flat");
  });
});
