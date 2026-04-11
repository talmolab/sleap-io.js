import type { Video } from "./video.js";
import type { Track, Instance } from "./instance.js";

import type { SegmentationMask } from "./mask.js";

// Late-binding factory to avoid circular imports with mask.ts.
// Set by mask.ts when it is imported.
type MaskFactory = (
  mask: Uint8Array,
  height: number,
  width: number,
  options: Record<string, unknown>,
) => SegmentationMask;
let _maskFactory: MaskFactory | null = null;
export function _registerMaskFactory(factory: MaskFactory): void {
  _maskFactory = factory;
}

export enum AnnotationType {
  DEFAULT = 0,
  BOUNDING_BOX = 1,
  SEGMENTATION = 2,
  ARENA = 3,
  ANCHOR = 4,
}

export type Geometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "MultiPoint"; coordinates: number[][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "GeometryCollection"; geometries: Geometry[] };

export interface ROIOptions {
  geometry: Geometry;
  name?: string;
  category?: string;
  source?: string;
  video?: Video | null;
  track?: Track | null;
  trackingScore?: number | null;
  instance?: Instance | null;
}

export class ROI {
  geometry: Geometry;
  name: string;
  category: string;
  source: string;
  video: Video | null;
  track: Track | null;
  trackingScore: number | null = null;
  instance: Instance | null;
  /** @internal Deferred instance index for lazy resolution. */
  _instanceIdx: number | null = null;

  constructor(options: ROIOptions) {
    if (new.target === ROI) {
      throw new TypeError(
        "ROI is abstract. Use UserROI or PredictedROI.",
      );
    }
    this.geometry = options.geometry;
    this.name = options.name ?? "";
    this.category = options.category ?? "";
    this.source = options.source ?? "";
    this.video = options.video ?? null;
    this.track = options.track ?? null;
    this.trackingScore = options.trackingScore ?? null;
    this.instance = options.instance ?? null;
  }

  /** @deprecated Use BoundingBox.fromXywh() instead. */
  static fromBbox(
    x: number,
    y: number,
    width: number,
    height: number,
    options?: Omit<ROIOptions, "geometry">,
  ): UserROI {
    const geometry: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [x, y],
          [x + width, y],
          [x + width, y + height],
          [x, y + height],
          [x, y],
        ],
      ],
    };
    return new UserROI({
      geometry,
      ...options,
    });
  }

  /** @deprecated Use BoundingBox.fromXyxy() instead. */
  static fromXyxy(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options?: Omit<ROIOptions, "geometry">,
  ): UserROI {
    const geometry: Geometry = {
      type: "Polygon",
      coordinates: [
        [
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
          [x1, y1],
        ],
      ],
    };
    return new UserROI({
      geometry,
      ...options,
    });
  }

  static fromPolygon(
    coords: number[][],
    options?: Omit<ROIOptions, "geometry">,
  ): UserROI {
    const ring = [...coords];
    if (
      ring.length > 0 &&
      (ring[0][0] !== ring[ring.length - 1][0] ||
        ring[0][1] !== ring[ring.length - 1][1])
    ) {
      ring.push([ring[0][0], ring[0][1]]);
    }
    const geometry: Geometry = { type: "Polygon", coordinates: [ring] };
    return new UserROI({
      geometry,
      ...options,
    });
  }

  static fromMultiPolygon(
    polygons: number[][][][],
    options?: Omit<ROIOptions, "geometry">,
  ): UserROI {
    return new UserROI({
      geometry: { type: "MultiPolygon", coordinates: polygons },
      ...options,
    });
  }

  /** Whether this is a predicted ROI (has a score). */
  get isPredicted(): boolean {
    return false;
  }

  explode(): ROI[] {
    // Use runtime constructor to preserve subclass (UserROI vs PredictedROI).
    // The any cast is safe because copyFields dynamically includes score for predicted.
    const Ctor = this.constructor as new (options: any) => ROI;
    const copyFields: Record<string, unknown> = {
      name: this.name,
      category: this.category,
      source: this.source,
      video: this.video,
      track: this.track,
      trackingScore: this.trackingScore,
      instance: this.instance,
    };
    if (this.isPredicted && "score" in this) {
      copyFields.score = (this as any).score;
    }
    if (this.geometry.type === "MultiPolygon") {
      return this.geometry.coordinates.map((coords) =>
        new Ctor({
          geometry: { type: "Polygon", coordinates: coords },
          ...copyFields,
        })
      );
    }
    if (this.geometry.type === "GeometryCollection") {
      return this.geometry.geometries.map((geom) =>
        new Ctor({
          geometry: geom,
          ...copyFields,
        })
      );
    }
    // Single geometry, return copy
    return [new Ctor({
      geometry: this.geometry,
      ...copyFields,
    })];
  }

  toGeoJSON(): {
    type: "Feature";
    geometry: Geometry;
    properties: Record<string, unknown>;
  } {
    return {
      type: "Feature",
      geometry: this.geometry,
      properties: {
        name: this.name,
        category: this.category,
        source: this.source,
      },
    };
  }

  get isBbox(): boolean {
    if (this.geometry.type !== "Polygon") return false;
    const coords = this.geometry.coordinates[0];
    if (!coords || coords.length !== 5) return false;
    for (let i = 0; i < 4; i++) {
      const dx = Math.abs(coords[i + 1][0] - coords[i][0]);
      const dy = Math.abs(coords[i + 1][1] - coords[i][1]);
      if (dx > 1e-10 && dy > 1e-10) return false;
    }
    return true;
  }

  get bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    const points = this._allPoints();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  get area(): number {
    if (this.geometry.type === "Point") return 0;
    if (this.geometry.type === "MultiPoint") return 0;
    if (this.geometry.type === "LineString") return 0;
    if (this.geometry.type === "Polygon") {
      return polygonArea(this.geometry.coordinates);
    }
    if (this.geometry.type === "MultiPolygon") {
      let total = 0;
      for (const poly of this.geometry.coordinates) {
        total += polygonArea(poly);
      }
      return total;
    }
    if (this.geometry.type === "GeometryCollection") {
      let total = 0;
      for (const geom of this.geometry.geometries) {
        const sub = new UserROI({ geometry: geom });
        total += sub.area;
      }
      return total;
    }
    return 0;
  }

  /** Centroid of the geometry as `[x, y]`. */
  get centroidXy(): [number, number] {
    if (this.geometry.type === "Point") {
      return [this.geometry.coordinates[0], this.geometry.coordinates[1]];
    }
    const b = this.bounds;
    return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  }

  /** @deprecated Use `centroidXy` instead. */
  get centroid(): { x: number; y: number } {
    if (this.geometry.type === "Point") {
      return { x: this.geometry.coordinates[0], y: this.geometry.coordinates[1] };
    }
    const b = this.bounds;
    return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }

  toMask(height: number, width: number): SegmentationMask {
    if (!_maskFactory) {
      throw new Error(
        "SegmentationMask not available. Import mask.ts before calling toMask().",
      );
    }
    const mask = rasterizeGeometry(this.geometry, height, width);
    return _maskFactory(mask, height, width, {
      name: this.name,
      category: this.category,
      source: this.source,
      track: this.track,
      instance: this.instance,
    });
  }

  private _allPoints(): number[][] {
    if (this.geometry.type === "Point") {
      return [this.geometry.coordinates];
    }
    if (this.geometry.type === "Polygon") {
      return this.geometry.coordinates.flat();
    }
    if (this.geometry.type === "MultiPolygon") {
      return this.geometry.coordinates.flat(2);
    }
    if (this.geometry.type === "MultiPoint") {
      return this.geometry.coordinates;
    }
    if (this.geometry.type === "LineString") {
      return this.geometry.coordinates;
    }
    if (this.geometry.type === "GeometryCollection") {
      const pts: number[][] = [];
      for (const geom of this.geometry.geometries) {
        const sub = new UserROI({ geometry: geom });
        pts.push(...sub._allPoints());
      }
      return pts;
    }
    return [];
  }
}

function ringArea(ring: number[][]): number {
  let area = 0;
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function polygonArea(rings: number[][][]): number {
  if (rings.length === 0) return 0;
  let area = Math.abs(ringArea(rings[0]));
  for (let i = 1; i < rings.length; i++) {
    area -= Math.abs(ringArea(rings[i]));
  }
  return Math.abs(area);
}

export function rasterizeGeometry(
  geometry: Geometry,
  height: number,
  width: number,
): Uint8Array {
  const mask = new Uint8Array(height * width);

  if (geometry.type === "Polygon") {
    scanlineFill(geometry.coordinates[0], mask, height, width, true);
    for (let i = 1; i < geometry.coordinates.length; i++) {
      scanlineFill(geometry.coordinates[i], mask, height, width, false);
    }
    return mask;
  }

  if (geometry.type === "MultiPolygon") {
    for (const poly of geometry.coordinates) {
      const polyMask = rasterizeGeometry({ type: "Polygon", coordinates: poly }, height, width);
      for (let i = 0; i < mask.length; i++) {
        if (polyMask[i]) mask[i] = 1;
      }
    }
    return mask;
  }

  if (geometry.type === "GeometryCollection") {
    for (const geom of geometry.geometries) {
      const subMask = rasterizeGeometry(geom, height, width);
      for (let i = 0; i < mask.length; i++) {
        if (subMask[i]) mask[i] = 1;
      }
    }
    return mask;
  }

  // Point, MultiPoint, LineString: return empty mask
  return mask;
}

function scanlineFill(
  coords: number[][],
  mask: Uint8Array,
  height: number,
  width: number,
  fill: boolean,
): void {
  if (!coords || coords.length < 3) return;

  let minY = Infinity,
    maxY = -Infinity;
  for (const [, y] of coords) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const startY = Math.max(0, Math.floor(minY));
  const endY = Math.min(height - 1, Math.floor(maxY));

  const n = coords.length - 1;

  for (let y = startY; y <= endY; y++) {
    const intersections: number[] = [];
    for (let i = 0; i < n; i++) {
      const y0 = coords[i][1];
      const y1 = coords[i + 1][1];
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1);
      const hi = Math.max(y0, y1);
      if (lo <= y + 0.5 && y + 0.5 < hi) {
        const x0 = coords[i][0];
        const x1 = coords[i + 1][0];
        const t = (y + 0.5 - y0) / (y1 - y0);
        intersections.push(x0 + t * (x1 - x0));
      }
    }

    intersections.sort((a, b) => a - b);
    for (let j = 0; j < intersections.length - 1; j += 2) {
      const xStart = Math.max(0, Math.floor(intersections[j]));
      const xEnd = Math.min(width, Math.ceil(intersections[j + 1]));
      const val = fill ? 1 : 0;
      for (let x = xStart; x < xEnd; x++) {
        mask[y * width + x] = val;
      }
    }
  }
}

// WKB encoding/decoding

export function encodeWkb(geometry: Geometry): Uint8Array {
  if (geometry.type === "Point") {
    const buf = new ArrayBuffer(21);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint32(1, 1, true);
    view.setFloat64(5, geometry.coordinates[0], true);
    view.setFloat64(13, geometry.coordinates[1], true);
    return new Uint8Array(buf);
  }

  if (geometry.type === "Polygon") {
    return encodeWkbPolygon(geometry.coordinates);
  }

  if (geometry.type === "MultiPolygon") {
    const polygonBuffers: Uint8Array[] = [];
    for (const poly of geometry.coordinates) {
      polygonBuffers.push(encodeWkbPolygon(poly));
    }
    const totalSize = 9 + polygonBuffers.reduce((sum, b) => sum + b.length, 0);
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint32(1, 6, true);
    view.setUint32(5, geometry.coordinates.length, true);
    let offset = 9;
    for (const pb of polygonBuffers) {
      new Uint8Array(buf, offset, pb.length).set(pb);
      offset += pb.length;
    }
    return new Uint8Array(buf);
  }

  if (geometry.type === "LineString") {
    // WKB type 2: header(5) + numPoints(4) + points(numPoints * 16)
    const numPoints = geometry.coordinates.length;
    const size = 9 + numPoints * 16;
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint32(1, 2, true);
    view.setUint32(5, numPoints, true);
    let offset = 9;
    for (const [x, y] of geometry.coordinates) {
      view.setFloat64(offset, x, true);
      view.setFloat64(offset + 8, y, true);
      offset += 16;
    }
    return new Uint8Array(buf);
  }

  if (geometry.type === "MultiPoint") {
    // WKB type 4: header(5) + numPoints(4) + for each: WKB Point(21)
    const numPoints = geometry.coordinates.length;
    const size = 9 + numPoints * 21;
    const buf = new ArrayBuffer(size);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint32(1, 4, true);
    view.setUint32(5, numPoints, true);
    let offset = 9;
    for (const [x, y] of geometry.coordinates) {
      view.setUint8(offset, 1);
      view.setUint32(offset + 1, 1, true);
      view.setFloat64(offset + 5, x, true);
      view.setFloat64(offset + 13, y, true);
      offset += 21;
    }
    return new Uint8Array(buf);
  }

  if (geometry.type === "GeometryCollection") {
    // WKB type 7: header(5) + numGeometries(4) + for each: recursive encodeWkb
    const subBuffers: Uint8Array[] = [];
    for (const geom of geometry.geometries) {
      subBuffers.push(encodeWkb(geom));
    }
    const totalSize = 9 + subBuffers.reduce((sum, b) => sum + b.length, 0);
    const buf = new ArrayBuffer(totalSize);
    const view = new DataView(buf);
    view.setUint8(0, 1);
    view.setUint32(1, 7, true);
    view.setUint32(5, geometry.geometries.length, true);
    let offset = 9;
    for (const sb of subBuffers) {
      new Uint8Array(buf, offset, sb.length).set(sb);
      offset += sb.length;
    }
    return new Uint8Array(buf);
  }

  throw new Error(`Unsupported geometry type: ${(geometry as Geometry).type}`);
}

function encodeWkbPolygon(rings: number[][][]): Uint8Array {
  let size = 9;
  for (const ring of rings) {
    size += 4 + ring.length * 16;
  }
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint8(0, 1);
  view.setUint32(1, 3, true);
  view.setUint32(5, rings.length, true);
  let offset = 9;
  for (const ring of rings) {
    view.setUint32(offset, ring.length, true);
    offset += 4;
    for (const [x, y] of ring) {
      view.setFloat64(offset, x, true);
      view.setFloat64(offset + 8, y, true);
      offset += 16;
    }
  }
  return new Uint8Array(buf);
}

export function decodeWkb(bytes: Uint8Array): Geometry {
  return decodeWkbInternal(bytes).geometry;
}

function decodeWkbInternal(bytes: Uint8Array): { geometry: Geometry; bytesRead: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const byteOrder = view.getUint8(0);
  const le = byteOrder === 1;
  const wkbType = view.getUint32(1, le);

  if (wkbType === 1) {
    const x = view.getFloat64(5, le);
    const y = view.getFloat64(13, le);
    return { geometry: { type: "Point", coordinates: [x, y] }, bytesRead: 21 };
  }

  if (wkbType === 3) {
    const { rings, bytesRead } = decodeWkbPolygon(view, 5, le);
    return { geometry: { type: "Polygon", coordinates: rings }, bytesRead: 5 + bytesRead };
  }

  if (wkbType === 6) {
    const numPolygons = view.getUint32(5, le);
    const polygons: number[][][][] = [];
    let offset = 9;
    for (let i = 0; i < numPolygons; i++) {
      const innerLe = view.getUint8(offset) === 1;
      offset += 5;
      const { rings, bytesRead } = decodeWkbPolygon(view, offset, innerLe);
      polygons.push(rings);
      offset += bytesRead;
    }
    return { geometry: { type: "MultiPolygon", coordinates: polygons }, bytesRead: offset };
  }

  if (wkbType === 2) {
    // LineString
    const numPoints = view.getUint32(5, le);
    const coords: number[][] = [];
    let offset = 9;
    for (let i = 0; i < numPoints; i++) {
      const x = view.getFloat64(offset, le);
      const y = view.getFloat64(offset + 8, le);
      coords.push([x, y]);
      offset += 16;
    }
    return { geometry: { type: "LineString", coordinates: coords }, bytesRead: offset };
  }

  if (wkbType === 4) {
    // MultiPoint
    const numPoints = view.getUint32(5, le);
    const coords: number[][] = [];
    let offset = 9;
    for (let i = 0; i < numPoints; i++) {
      const innerLe = view.getUint8(offset) === 1;
      offset += 5;
      const x = view.getFloat64(offset, innerLe);
      const y = view.getFloat64(offset + 8, innerLe);
      coords.push([x, y]);
      offset += 16;
    }
    return { geometry: { type: "MultiPoint", coordinates: coords }, bytesRead: offset };
  }

  if (wkbType === 7) {
    // GeometryCollection
    const numGeometries = view.getUint32(5, le);
    const geometries: Geometry[] = [];
    let offset = 9;
    for (let i = 0; i < numGeometries; i++) {
      const subBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
      const { geometry: geom, bytesRead } = decodeWkbInternal(subBytes);
      geometries.push(geom);
      offset += bytesRead;
    }
    return { geometry: { type: "GeometryCollection", geometries }, bytesRead: offset };
  }

  throw new Error(`Unsupported WKB type: ${wkbType}`);
}

function decodeWkbPolygon(
  view: DataView,
  offset: number,
  le: boolean,
): { rings: number[][][]; bytesRead: number } {
  const numRings = view.getUint32(offset, le);
  let pos = offset + 4;
  const rings: number[][][] = [];
  for (let i = 0; i < numRings; i++) {
    const numPoints = view.getUint32(pos, le);
    pos += 4;
    const ring: number[][] = [];
    for (let j = 0; j < numPoints; j++) {
      const x = view.getFloat64(pos, le);
      const y = view.getFloat64(pos + 8, le);
      ring.push([x, y]);
      pos += 16;
    }
    rings.push(ring);
  }
  return { rings, bytesRead: pos - offset };
}

/** User-annotated region of interest (no prediction score). */
export class UserROI extends ROI {}

/** Predicted region of interest with a confidence score. */
export class PredictedROI extends ROI {
  score: number;

  constructor(options: ROIOptions & { score: number }) {
    super(options);
    this.score = options.score;
  }

  get isPredicted(): boolean {
    return true;
  }
}
