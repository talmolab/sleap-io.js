import { describe, expect, it } from "../bun-test";

import {
  isDlcData,
  readDlc,
  readDlcProject,
  type DlcFileSystem,
} from "../../src/io/dlc";

// ---------------------------------------------------------------------------
// In-memory DlcFileSystem — proves the browser-safe core needs no disk.
//
// `textFiles` maps absolute POSIX paths -> file content (config.yaml, CSVs).
// `binaryPaths` are paths that exist but are never read as text (frame images);
// the core only existence-probes these. Directories are synthesized from the
// path prefixes of every entry.
// ---------------------------------------------------------------------------

function makeMemFs(
  textFiles: Record<string, string>,
  binaryPaths: string[] = [],
): DlcFileSystem {
  const files = new Set<string>([...Object.keys(textFiles), ...binaryPaths]);
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const d = parts.slice(0, i).join("/");
      if (d !== "") dirs.add(d);
    }
  }
  return {
    exists: (p) => files.has(p) || dirs.has(p),
    isFile: (p) => files.has(p),
    isDirectory: (p) => dirs.has(p),
    readTextFile: (p) => {
      const t = textFiles[p];
      if (t === undefined) throw new Error(`ENOENT (mem): ${p}`);
      return t;
    },
    readDir: (p) => {
      const prefix = `${p}/`;
      const names = new Set<string>();
      for (const entry of [...files, ...dirs]) {
        if (entry.startsWith(prefix)) {
          const rest = entry.slice(prefix.length);
          const name = rest.split("/")[0];
          if (name) names.add(name);
        }
      }
      return [...names];
    },
  };
}

// A minimal single-animal DLC project laid out under /p.
const CSV = [
  "scorer,LM,LM,LM,LM,LM,LM",
  "bodyparts,A,A,B,B,C,C",
  "coords,x,y,x,y,x,y",
  "labeled-data/vid1/img000.png,0,1,2,3,4,5",
  "labeled-data/vid1/img001.png,10,11,12,13,14,15",
  "",
].join("\n");

const CONFIG = [
  "Task: proj",
  "scorer: LM",
  "bodyparts:",
  "- A",
  "- B",
  "- C",
  "skeleton:",
  "- - A",
  "  - B",
  "- - B",
  "  - C",
  "video_sets:",
  '  "/p/videos/vid1.mp4": {}',
  "",
].join("\n");

function projectFs(): DlcFileSystem {
  return makeMemFs(
    {
      "/p/config.yaml": CONFIG,
      "/p/labeled-data/vid1/CollectedData_LM.csv": CSV,
    },
    ["/p/labeled-data/vid1/img000.png", "/p/labeled-data/vid1/img001.png"],
  );
}

describe("browser-safe DLC core (in-memory DlcFileSystem)", () => {
  it("readDlcProject builds Labels from a project via an injected fs (no disk)", () => {
    const labels = readDlcProject("/p/config.yaml", { fs: projectFs() });
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    // Edges + name come from config.yaml.
    expect(
      labels.skeletons[0].edges.map((e) => [e.source.name, e.destination.name]),
    ).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(labels.skeletons[0].name).toBe("proj");
    expect(labels.labeledFrames.length).toBe(2);
    const inst = labels.labeledFrames[0].instances[0];
    expect(inst.points[0].xy).toEqual([0, 1]);
    expect(inst.points[2].xy).toEqual([4, 5]);
    // Image-sequence video points at the (existence-probed) frame images.
    expect(labels.videos.length).toBe(1);
  });

  it("readDlc loads a single CSV and auto-discovers config through the fs", () => {
    const labels = readDlc("/p/labeled-data/vid1/CollectedData_LM.csv", {
      fs: projectFs(),
    });
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    // Auto-discovered /p/config.yaml supplies the edges.
    expect(labels.skeletons[0].edges.length).toBe(2);
    expect(labels.labeledFrames.length).toBe(2);
  });

  it("readDlc with config:false skips edges", () => {
    const labels = readDlc("/p/labeled-data/vid1/CollectedData_LM.csv", {
      fs: projectFs(),
      config: false,
    });
    expect(labels.skeletons[0].edges.length).toBe(0);
  });

  it("isDlcData sniffs DLC header text without any fs", () => {
    expect(isDlcData(CSV)).toBe(true);
    expect(isDlcData("col1,col2,col3\n1,2,3\n")).toBe(false);
    expect(isDlcData("")).toBe(false);
  });
});
