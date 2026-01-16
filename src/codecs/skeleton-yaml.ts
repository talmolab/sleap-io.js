import YAML from "yaml";
import { Skeleton, Node, Edge, Symmetry, NodeOrIndex } from "../model/skeleton.js";

type YAMLNodeEntry = { name: string } | string;

type YAMLEdgeEntry =
  | { source: { name: string } | string; destination: { name: string } | string }
  | [NodeOrIndex, NodeOrIndex];

type YAMLSymmetryEntry = Array<{ name: string } | string> | [NodeOrIndex, NodeOrIndex];

type YAMLSkeletonData = {
  nodes: YAMLNodeEntry[];
  edges?: YAMLEdgeEntry[];
  symmetries?: YAMLSymmetryEntry[];
  name?: string;
};

function getNodeName(entry: YAMLNodeEntry): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry.name === "string") return entry.name;
  throw new Error("Invalid node entry in skeleton YAML.");
}

function resolveName(value: { name?: string } | string): string {
  if (typeof value === "string") return value;
  if (value && typeof value.name === "string") return value.name;
  throw new Error("Invalid name reference in skeleton YAML.");
}

function decodeSkeleton(data: YAMLSkeletonData, fallbackName?: string): Skeleton {
  if (!data?.nodes) throw new Error("Skeleton YAML missing nodes.");
  const nodes = data.nodes.map((entry) => new Node(getNodeName(entry)));

  const edges = (data.edges ?? []).map((edge) => {
    if (Array.isArray(edge)) {
      const [source, destination] = edge;
      return new Edge(nodes[Number(source)], nodes[Number(destination)]);
    }
    const sourceName = resolveName(edge.source);
    const destName = resolveName(edge.destination);
    const source = nodes.find((node) => node.name === sourceName);
    const dest = nodes.find((node) => node.name === destName);
    if (!source || !dest) throw new Error("Edge references unknown node.");
    return new Edge(source, dest);
  });

  const symmetries = (data.symmetries ?? []).map((symmetry) => {
    if (!Array.isArray(symmetry) || symmetry.length !== 2) {
      throw new Error("Symmetry must contain exactly 2 nodes.");
    }
    const [left, right] = symmetry;
    const leftName = resolveName(left as { name?: string } | string);
    const rightName = resolveName(right as { name?: string } | string);
    const leftNode = nodes.find((node) => node.name === leftName);
    const rightNode = nodes.find((node) => node.name === rightName);
    if (!leftNode || !rightNode) throw new Error("Symmetry references unknown node.");
    return new Symmetry([leftNode, rightNode]);
  });

  return new Skeleton({
    name: data.name ?? fallbackName,
    nodes,
    edges,
    symmetries,
  });
}

export function decodeYamlSkeleton(yamlData: string): Skeleton | Skeleton[] {
  const parsed = YAML.parse(yamlData) as Record<string, unknown> | null;
  if (!parsed) throw new Error("Empty skeleton YAML.");

  if (Object.prototype.hasOwnProperty.call(parsed, "nodes")) {
    return decodeSkeleton(parsed as YAMLSkeletonData);
  }

  return Object.entries(parsed).map(([name, skeletonData]) =>
    decodeSkeleton(skeletonData as YAMLSkeletonData, name)
  );
}

export function encodeYamlSkeleton(skeletons: Skeleton | Skeleton[]): string {
  const list = Array.isArray(skeletons) ? skeletons : [skeletons];
  const payload: Record<string, YAMLSkeletonData> = {};

  list.forEach((skeleton, index) => {
    const name = skeleton.name ?? `Skeleton-${index}`;
    const nodes = skeleton.nodes.map((node) => ({ name: node.name }));
    const edges = skeleton.edges.map((edge) => ({
      source: { name: edge.source.name },
      destination: { name: edge.destination.name },
    }));
    const symmetries = skeleton.symmetries.map((symmetry) => {
      const pair = Array.from(symmetry.nodes);
      return [{ name: pair[0].name }, { name: pair[1].name }];
    });
    payload[name] = { nodes, edges, symmetries };
  });

  return YAML.stringify(payload);
}
