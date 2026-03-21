import { ROI, type Geometry } from "../model/roi.js";

/** GeoJSON Feature type */
export interface GeoJSONFeature {
  type: "Feature";
  geometry: Geometry;
  properties?: Record<string, unknown>;
}

/** GeoJSON FeatureCollection type */
export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

/**
 * Convert ROIs to a GeoJSON FeatureCollection object.
 */
export function roisToGeoJSON(rois: ROI[]): GeoJSONFeatureCollection {
  return {
    type: "FeatureCollection",
    features: rois.map((roi) => roi.toGeoJSON()),
  };
}

/**
 * Parse a GeoJSON object into ROIs.
 * Accepts either a FeatureCollection or a single Feature.
 */
export function roisFromGeoJSON(
  geojson: GeoJSONFeatureCollection | GeoJSONFeature
): ROI[] {
  const features =
    geojson.type === "FeatureCollection" ? geojson.features : [geojson];

  return features.map((feature) => {
    const props = feature.properties ?? {};
    return new ROI({
      geometry: feature.geometry as Geometry,
      name: (props.name as string) ?? "",
      category: (props.category as string) ?? "",
      source: (props.source as string) ?? "",
      frameIdx: (props.frame_idx as number) ?? null,
    });
  });
}

/**
 * Serialize ROIs to a GeoJSON string.
 */
export function writeGeoJSON(rois: ROI[]): string {
  return JSON.stringify(roisToGeoJSON(rois), null, 2);
}

/**
 * Parse a GeoJSON string into ROIs.
 */
export function readGeoJSON(json: string): ROI[] {
  return roisFromGeoJSON(JSON.parse(json));
}
