import { Skeleton, Node, Edge, Symmetry } from "../model/skeleton.js";

interface JsonPickleNode {
  "py/object"?: string;
  "py/state"?: { "py/tuple": [string, number] };
  "py/id"?: number;
}

interface JsonPickleEdgeType {
  "py/reduce"?: [{ "py/type": string }, { "py/tuple": [number] }];
  "py/id"?: number;
}

interface JsonPickleLink {
  source: JsonPickleNode;
  target: JsonPickleNode;
  type: JsonPickleEdgeType;
  edge_insert_idx?: number;
  key?: number;
}

interface JsonPickleSkeletonData {
  directed?: boolean;
  graph?: { name?: string; num_edges_inserted?: number };
  links: JsonPickleLink[];
  nodes: Array<{ id: JsonPickleNode }>;
  multigraph?: boolean;
}

/**
 * Parse a skeleton from jsonpickle graph format (used in .json skeleton files
 * and training config files).
 *
 * The jsonpickle format uses py/object for first occurrences and py/id for
 * back-references. Two format variants exist:
 * - Shared-object: nodes use py/id refs across links (flies13 style)
 * - Duplicate-object: every link has fresh py/object nodes (fly32 style)
 *
 * We use separate ID registries for nodes and edge types to handle both.
 */
export function readSkeletonJson(
  json: string | Record<string, unknown>
): Skeleton {
  const data: JsonPickleSkeletonData =
    typeof json === "string"
      ? (JSON.parse(json) as JsonPickleSkeletonData)
      : (json as unknown as JsonPickleSkeletonData);

  // Separate registries for nodes and edge types.
  // In some jsonpickle versions they share an ID space, in others they don't.
  // We detect which mode by checking if links reuse node refs via py/id.
  const globalRegistry = new Map<number, unknown>();
  let globalCounter = 0;

  // Detect format: check if any link source/target uses py/id
  const usesSharedNodeRefs = data.links.some(
    (link) => link.source["py/id"] !== undefined || link.target["py/id"] !== undefined
  );

  // Edge type registry (separate from node registry for duplicate-object format)
  const edgeTypeRegistry = new Map<number, number>();
  let edgeTypeCounter = 0;

  function resolveNode(obj: JsonPickleNode): string {
    if (obj["py/object"]) {
      const name = obj["py/state"]!["py/tuple"][0];
      if (usesSharedNodeRefs) {
        globalCounter += 1;
        globalRegistry.set(globalCounter, name);
      }
      return name;
    }
    if (obj["py/id"] !== undefined) {
      return globalRegistry.get(obj["py/id"]) as string;
    }
    throw new Error("Cannot resolve jsonpickle node reference");
  }

  function resolveEdgeTypeValue(obj: JsonPickleEdgeType): number {
    if (obj["py/reduce"]) {
      const value = obj["py/reduce"][1]["py/tuple"][0];
      if (usesSharedNodeRefs) {
        globalCounter += 1;
        globalRegistry.set(globalCounter, value);
      } else {
        edgeTypeCounter += 1;
        edgeTypeRegistry.set(edgeTypeCounter, value);
      }
      return value;
    }
    if (obj["py/id"] !== undefined) {
      if (usesSharedNodeRefs) {
        return globalRegistry.get(obj["py/id"]) as number;
      }
      return edgeTypeRegistry.get(obj["py/id"]) as number;
    }
    return 1;
  }

  // Parse links to collect edges/symmetries and build ID registry
  const edgePairs: Array<[string, string]> = [];
  const symmetryPairs: Array<[string, string]> = [];
  const allNodeNames: string[] = [];
  const nodeNameSet = new Set<string>();

  for (const link of data.links) {
    const sourceName = resolveNode(link.source);
    const targetName = resolveNode(link.target);
    const edgeType = resolveEdgeTypeValue(link.type);

    if (!nodeNameSet.has(sourceName)) {
      nodeNameSet.add(sourceName);
      allNodeNames.push(sourceName);
    }
    if (!nodeNameSet.has(targetName)) {
      nodeNameSet.add(targetName);
      allNodeNames.push(targetName);
    }

    if (edgeType === 1) {
      edgePairs.push([sourceName, targetName]);
    } else if (edgeType === 2) {
      symmetryPairs.push([sourceName, targetName]);
    }
  }

  // Resolve node order from the nodes array using py/id refs
  let nodeNames: string[];
  if (usesSharedNodeRefs && data.nodes.length > 0) {
    const orderedNames: string[] = [];
    for (const nodeEntry of data.nodes) {
      const nodeObj = nodeEntry.id;
      if (nodeObj["py/object"]) {
        globalCounter += 1;
        const name = nodeObj["py/state"]!["py/tuple"][0];
        globalRegistry.set(globalCounter, name);
        orderedNames.push(name);
      } else if (nodeObj["py/id"] !== undefined) {
        const resolved = globalRegistry.get(nodeObj["py/id"]);
        if (typeof resolved === "string") {
          orderedNames.push(resolved);
        }
      }
    }
    nodeNames = orderedNames.length === nodeNameSet.size ? orderedNames : allNodeNames;
  } else {
    // Duplicate-object format or no links at all.
    // Check nodes array for any py/object definitions not seen in links.
    for (const nodeEntry of data.nodes) {
      const nodeObj = nodeEntry.id;
      if (nodeObj["py/object"]) {
        const name = nodeObj["py/state"]!["py/tuple"][0];
        if (!nodeNameSet.has(name)) {
          nodeNameSet.add(name);
          allNodeNames.push(name);
        }
      }
    }
    nodeNames = allNodeNames;
  }

  const nodes = nodeNames.map((name) => new Node(name));
  const nodeMap = new Map(nodes.map((n) => [n.name, n]));

  const edges = edgePairs.map(
    ([src, dst]) => new Edge(nodeMap.get(src)!, nodeMap.get(dst)!)
  );

  // Deduplicate symmetries (each pair appears twice in jsonpickle format)
  const seenSymmetries = new Set<string>();
  const symmetries: Symmetry[] = [];
  for (const [a, b] of symmetryPairs) {
    const key = [a, b].sort().join("\0");
    if (!seenSymmetries.has(key)) {
      seenSymmetries.add(key);
      symmetries.push(new Symmetry([nodeMap.get(a)!, nodeMap.get(b)!]));
    }
  }

  return new Skeleton({ nodes, edges, symmetries, name: data.graph?.name });
}
