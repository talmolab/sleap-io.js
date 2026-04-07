/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  isTrackMateFile,
  readTrackMateCsv,
  loadTrackMate,
} from "../src/io/trackmate.js";
import { PredictedCentroid } from "../src/model/centroid.js";

const SPOTS_HEADER =
  "LABEL,ID,TRACK_ID,QUALITY,POSITION_X,POSITION_Y,POSITION_Z," +
  "POSITION_T,FRAME,RADIUS,VISIBILITY\n" +
  "Label,Spot ID,Track ID,Quality,X,Y,Z,T,Frame,Radius,Visibility\n" +
  "Label,Spot ID,Track ID,Quality,X,Y,Z,T,Frame,R,Visibility\n" +
  ",,,(quality),(pixel),(pixel),(pixel),(frame),,(pixel),\n";

const EDGES_HEADER =
  "LABEL,TRACK_ID,SPOT_SOURCE_ID,SPOT_TARGET_ID,LINK_COST," +
  "SPEED,DISPLACEMENT\n" +
  "Label,Track ID,Source spot ID,Target spot ID,Edge cost," +
  "Speed,Displacement\n" +
  "Label,Track ID,Source ID,Target ID,Cost,Speed,Disp.\n" +
  ",,,,(cost),(pixel/frame),(pixel)\n";

function writeSpots(filePath: string, rows: string[]): void {
  fs.writeFileSync(filePath, SPOTS_HEADER + rows.join("\n") + "\n");
}

function writeEdges(filePath: string, rows: string[]): void {
  fs.writeFileSync(filePath, EDGES_HEADER + rows.join("\n") + "\n");
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trackmate-test-"));
}

describe("isTrackMateFile", () => {
  it("returns true for valid TrackMate spots CSV", () => {
    const dir = tmpDir();
    const p = path.join(dir, "spots.csv");
    writeSpots(p, []);
    expect(isTrackMateFile(p)).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it("returns false for generic CSV", () => {
    const dir = tmpDir();
    const p = path.join(dir, "generic.csv");
    fs.writeFileSync(p, "col_a,col_b,col_c\n1,2,3\n");
    expect(isTrackMateFile(p)).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });

  it("returns false for non-existent file", () => {
    expect(isTrackMateFile("/tmp/nonexistent_trackmate.csv")).toBe(false);
  });
});

describe("readTrackMateCsv", () => {
  it("basic import with two tracks", () => {
    const dir = tmpDir();
    const spotsPath = path.join(dir, "test_spots.csv");
    writeSpots(spotsPath, [
      "ID100,100,0,5.5,10.0,20.0,0.0,0.0,0,11.5,1",
      "ID101,101,0,5.3,12.0,22.0,0.0,1.0,1,11.5,1",
      "ID200,200,1,4.0,50.0,60.0,0.0,0.0,0,11.5,1",
    ]);

    const labels = readTrackMateCsv(spotsPath);

    expect(labels.centroids).toHaveLength(3);
    expect(labels.tracks).toHaveLength(2);

    const c0 = labels.centroids[0] as PredictedCentroid;
    expect(c0).toBeInstanceOf(PredictedCentroid);
    expect(c0.x).toBeCloseTo(10.0);
    expect(c0.y).toBeCloseTo(20.0);
    expect(c0.z).toBeNull(); // 0.0 -> null
    expect(c0.frameIdx).toBe(0);
    expect(c0.score).toBeCloseTo(5.5);
    expect(c0.name).toBe("ID100");
    expect(c0.source).toBe("trackmate");
    expect(c0.track).not.toBeNull();
    expect(c0.track!.name).toBe("Track_0");

    const c2 = labels.centroids[2] as PredictedCentroid;
    expect(c2.track!.name).toBe("Track_1");

    fs.rmSync(dir, { recursive: true });
  });

  it("edges CSV populates tracking_score", () => {
    const dir = tmpDir();
    writeSpots(path.join(dir, "data_spots.csv"), [
      "ID10,10,0,5.0,1.0,2.0,0.0,0.0,0,11.5,1",
      "ID11,11,0,5.0,3.0,4.0,0.0,1.0,1,11.5,1",
      "ID12,12,0,5.0,5.0,6.0,0.0,2.0,2,11.5,1",
    ]);
    writeEdges(path.join(dir, "data_edges.csv"), [
      "ID10 -> ID11,0,10,11,0.5,2.0,2.0",
      "ID11 -> ID12,0,11,12,1.2,1.5,1.5",
    ]);

    const labels = readTrackMateCsv(path.join(dir, "data_spots.csv"));

    expect(labels.centroids).toHaveLength(3);

    // First spot: no edge -> trackingScore is null
    expect(labels.centroids[0].trackingScore).toBeNull();

    // Target spots get trackingScore from edge cost
    expect(labels.centroids[1].trackingScore).toBeCloseTo(0.5);
    expect(labels.centroids[2].trackingScore).toBeCloseTo(1.2);

    fs.rmSync(dir, { recursive: true });
  });

  it("auto-detects sibling edges CSV", () => {
    const dir = tmpDir();
    writeSpots(path.join(dir, "sample_spots.csv"), [
      "ID1,1,0,5.0,1.0,2.0,0.0,0.0,0,11.5,1",
      "ID2,2,0,5.0,3.0,4.0,0.0,1.0,1,11.5,1",
    ]);
    writeEdges(path.join(dir, "sample_edges.csv"), [
      "ID1 -> ID2,0,1,2,0.8,1.0,1.0",
    ]);

    // Don't pass edgesPath — should be auto-detected
    const labels = readTrackMateCsv(path.join(dir, "sample_spots.csv"));
    expect((labels.centroids[1] as PredictedCentroid).trackingScore).toBeCloseTo(0.8);

    fs.rmSync(dir, { recursive: true });
  });

  it("string video path creates Video object", () => {
    const dir = tmpDir();
    writeSpots(path.join(dir, "test_spots.csv"), [
      "ID1,1,0,5.0,1.0,2.0,0.0,0.0,0,11.5,1",
    ]);

    const labels = readTrackMateCsv(path.join(dir, "test_spots.csv"), { video: "my_video.tif" });

    expect(labels.videos).toHaveLength(1);
    expect(labels.videos[0].filename).toBe("my_video.tif");
    expect(labels.centroids[0].video).toBe(labels.videos[0]);

    fs.rmSync(dir, { recursive: true });
  });

  it("empty TRACK_ID -> track=null", () => {
    const dir = tmpDir();
    writeSpots(path.join(dir, "test_spots.csv"), [
      "ID1,1,,3.0,10.0,20.0,0.0,0.0,0,11.5,1",
      "ID2,2,0,5.0,30.0,40.0,0.0,0.0,0,11.5,1",
    ]);

    const labels = readTrackMateCsv(path.join(dir, "test_spots.csv"));
    expect(labels.centroids[0].track).toBeNull();
    expect(labels.centroids[1].track).not.toBeNull();
    expect(labels.tracks).toHaveLength(1);

    fs.rmSync(dir, { recursive: true });
  });

  it("non-zero Z populates z field", () => {
    const dir = tmpDir();
    writeSpots(path.join(dir, "test_spots.csv"), [
      "ID1,1,0,5.0,1.0,2.0,3.5,0.0,0,11.5,1",
      "ID2,2,0,5.0,4.0,5.0,0.0,1.0,1,11.5,1",
    ]);

    const labels = readTrackMateCsv(path.join(dir, "test_spots.csv"));
    expect(labels.centroids[0].z).toBeCloseTo(3.5);
    expect(labels.centroids[1].z).toBeNull();

    fs.rmSync(dir, { recursive: true });
  });

  it("throws for missing file", () => {
    expect(() => readTrackMateCsv("/tmp/nonexistent_spots.csv")).toThrow(/not found/);
  });

  it("throws for non-TrackMate CSV", () => {
    const dir = tmpDir();
    const p = path.join(dir, "bad.csv");
    fs.writeFileSync(p, "col_a,col_b\n1,2\n");
    expect(() => readTrackMateCsv(p)).toThrow(/Not a TrackMate/);
    fs.rmSync(dir, { recursive: true });
  });
});

describe("loadTrackMate", () => {
  it("works as public API wrapper", () => {
    const dir = tmpDir();
    writeSpots(path.join(dir, "test_spots.csv"), [
      "ID1,1,0,5.0,1.0,2.0,0.0,0.0,0,11.5,1",
    ]);

    const labels = loadTrackMate(path.join(dir, "test_spots.csv"));
    expect(labels.centroids).toHaveLength(1);
    expect(labels.centroids[0].x).toBeCloseTo(1.0);

    fs.rmSync(dir, { recursive: true });
  });
});
