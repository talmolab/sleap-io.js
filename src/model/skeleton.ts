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
      | Array<Node | string>
  ) {
    const resolved = Array.isArray(options) ? { nodes: options } : options;
    this.nodes = resolved.nodes.map((node) => (typeof node === "string" ? new Node(node) : node));
    this.edges = [];
    this.symmetries = [];
    this.name = resolved.name;
    this.nameToNode = new Map();
    this.nodeToIndex = new Map();
    this.rebuildCache();
    if (resolved.edges) {
      this.edges = resolved.edges.map((edge) => (edge instanceof Edge ? edge : this.edgeFrom(edge)));
    }
    if (resolved.symmetries) {
      this.symmetries = resolved.symmetries.map((symmetry) =>
        symmetry instanceof Symmetry ? symmetry : this.symmetryFrom(symmetry)
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
    return this.edges.map((edge) => [this.index(edge.source), this.index(edge.destination)]);
  }

  get symmetryNames(): Array<[string, string]> {
    return this.symmetries.map((symmetry) => {
      const nodes = Array.from(symmetry.nodes).map((node) => node.name);
      return [nodes[0], nodes[1]] as [string, string];
    });
  }

  matches(other: Skeleton): boolean {
    if (this.nodeNames.length !== other.nodeNames.length) return false;
    for (let i = 0; i < this.nodeNames.length; i += 1) {
      if (this.nodeNames[i] !== other.nodeNames[i]) return false;
    }
    return true;
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
