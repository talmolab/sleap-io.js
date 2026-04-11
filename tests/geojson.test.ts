/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { roisToGeoJSON, roisFromGeoJSON, writeGeoJSON, readGeoJSON } from "../src/io/geojson.js";
import { ROI } from "../src/model/roi.js";

describe("GeoJSON I/O", () => {
  it("round-trips ROIs through GeoJSON", () => {
    const rois = [
      ROI.fromPolygon([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], { name: "test", category: "region" }),
      ROI.fromBbox(5, 5, 20, 20, { name: "box" }),
    ];
    const json = writeGeoJSON(rois);
    const parsed = readGeoJSON(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("test");
    expect(parsed[0].category).toBe("region");
    expect(parsed[0].geometry.type).toBe("Polygon");
    expect(parsed[1].name).toBe("box");
  });

  it("reads single Feature", () => {
    const feature = {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [5, 10] },
      properties: { name: "pt" },
    };
    const rois = roisFromGeoJSON(feature);
    expect(rois).toHaveLength(1);
    expect(rois[0].geometry.type).toBe("Point");
    expect(rois[0].name).toBe("pt");
  });

  it("reads FeatureCollection", () => {
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        { type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [1, 2] } },
        { type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
      ],
    };
    const rois = roisFromGeoJSON(fc);
    expect(rois).toHaveLength(2);
    expect(rois[0].geometry.type).toBe("Point");
    expect(rois[1].geometry.type).toBe("Polygon");
  });

  it("roisToGeoJSON creates valid FeatureCollection", () => {
    const rois = [
      ROI.fromBbox(0, 0, 10, 10, { name: "a", category: "cat1" }),
    ];
    const fc = roisToGeoJSON(rois);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].type).toBe("Feature");
    expect(fc.features[0].properties?.name).toBe("a");
  });

  it("handles missing properties gracefully", () => {
    const feature = {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [0, 0] },
    };
    const rois = roisFromGeoJSON(feature);
    expect(rois).toHaveLength(1);
    expect(rois[0].name).toBe("");
    expect(rois[0].category).toBe("");
  });
});
