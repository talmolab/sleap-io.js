export class Node {
  name: string;

  constructor(name: string) {
    this.name = name;
  }
}

export class Edge {
  source: Node;
  destination: Node;

  constructor(source: Node, destination: Node) {
    this.source = source;
    this.destination = destination;
  }

  at(index: number): Node {
    if (index === 0) return this.source;
    if (index === 1) return this.destination;
    throw new Error("Edge only has 2 nodes (source and destination).");
  }
}

export class Symmetry {
  nodes: Set<Node>;

  constructor(nodes: Iterable<Node>) {
    const set = new Set(nodes);
    if (set.size !== 2) {
      throw new Error("Symmetry must contain exactly 2 nodes.");
    }
    this.nodes = set;
  }

  at(index: number): Node {
    let i = 0;
    for (const node of this.nodes) {
      if (i === index) return node;
      i += 1;
    }
    throw new Error("Symmetry index out of range.");
  }
}

export type NodeOrIndex = Node | string | number;

/** NUL delimiter for joining names into set keys (so ("A","BC") != ("AB","C")). */
const NAME_DELIM = "\u0000";

/** Check two sets of strings for equality (same size and same members). */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

/** Canonical key for a directed edge (order within the pair is preserved). */
function edgeKey(source: string, destination: string): string {
  return source + NAME_DELIM + destination;
}

/** Canonical key for a symmetry: the SORTED pair of its two node names. */
function symmetryKey(symmetry: Symmetry): string {
  const names = Array.from(symmetry.nodes).map((node) => node.name);
  names.sort();
  return names.join(NAME_DELIM);
}

export class Skeleton {
  nodes: Node[];
  edges: Edge[];
  symmetries: Symmetry[];
  name?: string;
  private nameToNode: Map<string, Node>;
  private nodeToIndex: Map<Node, number>;

  constructor(
    options:
      | {
          nodes: Array<Node | string>;
          edges?: Array<Edge | [NodeOrIndex, NodeOrIndex]>;
          symmetries?: Array<Symmetry | [NodeOrIndex, NodeOrIndex]>;
          name?: string;
        }
      | Array<Node | string>,
  ) {
    const resolved = Array.isArray(options) ? { nodes: options } : options;
    this.nodes = resolved.nodes.map((node) =>
      typeof node === "string" ? new Node(node) : node,
    );
    this.edges = [];
    this.symmetries = [];
    this.name = resolved.name;
    this.nameToNode = new Map();
    this.nodeToIndex = new Map();
    this.rebuildCache();
    if (resolved.edges) {
      this.edges = resolved.edges.map((edge) =>
        edge instanceof Edge ? edge : this.edgeFrom(edge),
      );
    }
    if (resolved.symmetries) {
      this.symmetries = resolved.symmetries.map((symmetry) =>
        symmetry instanceof Symmetry ? symmetry : this.symmetryFrom(symmetry),
      );
    }
  }

  rebuildCache(nodes: Node[] = this.nodes): void {
    this.nameToNode = new Map(nodes.map((node) => [node.name, node]));
    this.nodeToIndex = new Map(nodes.map((node, index) => [node, index]));
  }

  get nodeNames(): string[] {
    return this.nodes.map((node) => node.name);
  }

  index(node: NodeOrIndex): number {
    if (typeof node === "number") return node;
    if (typeof node === "string") {
      const found = this.nameToNode.get(node);
      if (!found) throw new Error(`Node '${node}' not found in skeleton.`);
      return this.nodeToIndex.get(found) ?? -1;
    }
    const idx = this.nodeToIndex.get(node);
    if (idx === undefined) throw new Error("Node not found in skeleton.");
    return idx;
  }

  node(node: NodeOrIndex): Node {
    if (node instanceof Node) return node;
    if (typeof node === "number") return this.nodes[node];
    const found = this.nameToNode.get(node);
    if (!found) throw new Error(`Node '${node}' not found in skeleton.`);
    return found;
  }

  get edgeIndices(): Array<[number, number]> {
    return this.edges.map((edge) => [
      this.index(edge.source),
      this.index(edge.destination),
    ]);
  }

  get symmetryNames(): Array<[string, string]> {
    return this.symmetries.map((symmetry) => {
      const nodes = Array.from(symmetry.nodes).map((node) => node.name);
      return [nodes[0], nodes[1]] as [string, string];
    });
  }

  /**
   * Check if this skeleton matches another skeleton's structure.
   *
   * Two skeletons match if they have the same nodes (by name), the same edges
   * (by directed source/destination name pairs), and the same symmetries (by
   * unordered node-name pairs). All comparisons are by node NAME, never by Node
   * identity. Two empty skeletons match.
   *
   * @param other Another skeleton to compare with.
   * @param opts.requireSameOrder If true, node names must be in the same order;
   *   if false (default), only the set of node names must match. Affects ONLY
   *   the node-name check — edges and symmetries are always compared as
   *   unordered sets.
   * @returns True if the skeletons match, false otherwise.
   */
  matches(other: Skeleton, opts: { requireSameOrder?: boolean } = {}): boolean {
    const requireSameOrder = opts.requireSameOrder ?? false;

    // 1. Same number of nodes.
    if (this.nodes.length !== other.nodes.length) return false;

    // 2. Node names: ordered list equality or set equality.
    const selfNames = this.nodeNames;
    const otherNames = other.nodeNames;
    if (requireSameOrder) {
      for (let i = 0; i < selfNames.length; i += 1) {
        if (selfNames[i] !== otherNames[i]) return false;
      }
    } else {
      if (!setsEqual(new Set(selfNames), new Set(otherNames))) return false;
    }

    // 3. Same number of edges.
    if (this.edges.length !== other.edges.length) return false;

    // 4. Edge set equality: directed (source.name, destination.name) pairs.
    const selfEdgeSet = new Set(
      this.edges.map((edge) =>
        edgeKey(edge.source.name, edge.destination.name),
      ),
    );
    const otherEdgeSet = new Set(
      other.edges.map((edge) =>
        edgeKey(edge.source.name, edge.destination.name),
      ),
    );
    if (!setsEqual(selfEdgeSet, otherEdgeSet)) return false;

    // 5. Same number of symmetries.
    if (this.symmetries.length !== other.symmetries.length) return false;

    // 6. Symmetry set equality: key from the SORTED pair of node names.
    const selfSymSet = new Set(this.symmetries.map(symmetryKey));
    const otherSymSet = new Set(other.symmetries.map(symmetryKey));
    return setsEqual(selfSymSet, otherSymSet);
  }

  /**
   * Calculate node overlap metrics with another skeleton.
   *
   * Node names are de-duplicated to sets first.
   *
   * @param other Another skeleton to compare with.
   * @returns An object with similarity metrics:
   *   - `nCommon`: Number of nodes in common.
   *   - `nSelfOnly`: Number of nodes only in this skeleton.
   *   - `nOtherOnly`: Number of nodes only in the other skeleton.
   *   - `jaccard`: Jaccard similarity (intersection/union), 0 if union empty.
   *   - `dice`: Dice coefficient (2*intersection/(nSelf+nOther)), 0 if both empty.
   */
  nodeSimilarities(other: Skeleton): {
    nCommon: number;
    nSelfOnly: number;
    nOtherOnly: number;
    jaccard: number;
    dice: number;
  } {
    const selfNodes = new Set(this.nodeNames);
    const otherNodes = new Set(other.nodeNames);

    let nCommon = 0;
    for (const name of selfNodes) {
      if (otherNodes.has(name)) nCommon += 1;
    }
    const sizeSelf = selfNodes.size;
    const sizeOther = otherNodes.size;
    const nSelfOnly = sizeSelf - nCommon;
    const nOtherOnly = sizeOther - nCommon;
    const nUnion = sizeSelf + sizeOther - nCommon;

    const jaccard = nUnion > 0 ? nCommon / nUnion : 0;
    const dice =
      sizeSelf + sizeOther > 0 ? (2 * nCommon) / (sizeSelf + sizeOther) : 0;

    return { nCommon, nSelfOnly, nOtherOnly, jaccard, dice };
  }

  addEdge(source: NodeOrIndex, destination: NodeOrIndex): void {
    this.edges.push(new Edge(this.node(source), this.node(destination)));
  }

  addSymmetry(left: NodeOrIndex, right: NodeOrIndex): void {
    this.symmetries.push(new Symmetry([this.node(left), this.node(right)]));
  }

  private edgeFrom(edge: [NodeOrIndex, NodeOrIndex]): Edge {
    const [source, destination] = edge;
    return new Edge(this.node(source), this.node(destination));
  }

  private symmetryFrom(symmetry: [NodeOrIndex, NodeOrIndex]): Symmetry {
    const [a, b] = symmetry;
    return new Symmetry([this.node(a), this.node(b)]);
  }
}
