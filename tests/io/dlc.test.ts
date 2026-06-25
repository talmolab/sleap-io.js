import { afterEach, beforeEach, describe, expect, it } from "../bun-test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  dlcMergedOrder,
  discoverConfig,
  isDlcFile,
  isDlcProjectPath,
  loadDlc,
  loadDlcProject,
  loadDlcSplits,
  looksLikeDlcConfig,
  parseDlcCrop,
  readCsvScorer,
  readDlcConfig,
  readDlcSplit,
  readPickle,
  warnIfNonlexicographic,
} from "../../src/io/dlc";
import { LabelsSet } from "../../src/model/labels-set";

const fixtureRoot = fileURLToPath(new URL("../data", import.meta.url));
const dlcDir = path.join(fixtureRoot, "dlc");
const videoDir = path.join(dlcDir, "labeled-data", "video");
const configPath = path.join(dlcDir, "madlc_230_config.yaml");
const multiDir = path.join(fixtureRoot, "dlc_multiple_datasets");

function csv(name: string): string {
  return path.join(videoDir, name);
}

// ---------------------------------------------------------------------------
// Minimal protocol-2 pickle writer (test-only), matching CPython's output for
// the DLC Documentation pickle shape `[data, trainList, testList, frac]`.
// ---------------------------------------------------------------------------

function pickleBytes(train: number[], test: number[], frac: number): Buffer {
  const bytes: number[] = [];
  const push = (...b: number[]) => bytes.push(...b);
  const pushUInt32LE = (n: number) => {
    push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  };
  const writeInt = (n: number) => {
    if (n >= 0 && n < 256) {
      push(0x4b, n & 0xff); // BININT1
    } else if (n >= 0 && n < 65536) {
      push(0x4d, n & 0xff, (n >> 8) & 0xff); // BININT2
    } else {
      push(0x4a); // BININT (signed 4-byte LE)
      pushUInt32LE(n >>> 0);
    }
  };
  const writeUnicode = (s: string) => {
    const enc = Buffer.from(s, "utf-8");
    push(0x58); // BINUNICODE
    pushUInt32LE(enc.length);
    for (const b of enc) push(b);
  };
  const writeIntList = (arr: number[]) => {
    push(0x5d); // EMPTY_LIST
    push(0x28); // MARK
    for (const n of arr) writeInt(n);
    push(0x65); // APPENDS
  };
  const writeDouble = (d: number) => {
    const buf = Buffer.alloc(8);
    buf.writeDoubleBE(d, 0);
    push(0x47); // BINFLOAT (8 bytes BE)
    for (const b of buf) push(b);
  };

  push(0x80, 0x02); // PROTO 2
  push(0x5d); // EMPTY_LIST (outer)
  push(0x28); // MARK (outer items)

  // data: a one-element list with a single dict {"image": ("a","b","c")}
  push(0x5d); // EMPTY_LIST (data)
  push(0x7d); // EMPTY_DICT
  writeUnicode("image");
  // tuple ("labeled-data", "vid1", "img000.png") via TUPLE3
  writeUnicode("labeled-data");
  writeUnicode("vid1");
  writeUnicode("img000.png");
  push(0x87); // TUPLE3
  push(0x73); // SETITEM
  push(0x61); // APPEND (dict -> data list)

  // trainIndices, testIndices, trainFraction
  writeIntList(train);
  writeIntList(test);
  writeDouble(frac);

  push(0x65); // APPENDS (outer)
  push(0x2e); // STOP
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Synthetic DLC project builder (mirrors Python tests' make_dlc_project).
// ---------------------------------------------------------------------------

interface MakeProjectOpts {
  scorer?: string;
  task?: string;
  date?: string;
  iteration?: number;
  bodyparts?: string[];
  skeleton?: Array<[string, string]>;
  folders?: Record<string, string[]>;
  videoSets?: Record<string, unknown>;
  makeImages?: boolean;
  trainIndices?: number[];
  testIndices?: number[];
  trainFraction?: number;
  shuffle?: number;
  csvScorer?: string;
}

function makeDlcProject(root: string, opts: MakeProjectOpts = {}): string {
  const scorer = opts.scorer ?? "LM";
  const task = opts.task ?? "proj";
  const date = opts.date ?? "Jan1";
  const iteration = opts.iteration ?? 0;
  const bodyparts = opts.bodyparts ?? ["snout", "leftear", "rightear"];
  const skeleton = opts.skeleton ?? [
    ["snout", "leftear"],
    ["snout", "rightear"],
  ];
  const folders = opts.folders ?? {
    vid1: ["img000", "img001", "img002"],
    vid2: ["img000", "img001"],
  };
  const csvScorer = opts.csvScorer ?? scorer;
  const makeImages = opts.makeImages ?? true;
  const trainFraction = opts.trainFraction ?? 0.8;
  const shuffle = opts.shuffle ?? 1;

  const nbp = bodyparts.length;
  const scorerRow = `scorer,${Array(2 * nbp)
    .fill(csvScorer)
    .join(",")}`;
  const bpRow = `bodyparts,${bodyparts.flatMap((bp) => [bp, bp]).join(",")}`;
  const coordRow = `coords,${Array(nbp).fill("x,y").join(",")}`;

  for (const [folder, imgs] of Object.entries(folders)) {
    const d = path.join(root, "labeled-data", folder);
    fs.mkdirSync(d, { recursive: true });
    const lines = [scorerRow, bpRow, coordRow];
    imgs.forEach((img, i) => {
      const vals = Array.from({ length: 2 * nbp }, (_, k) => i * 100 + k);
      lines.push(`labeled-data/${folder}/${img}.png,${vals.join(",")}`);
    });
    fs.writeFileSync(
      path.join(d, `CollectedData_${scorer}.csv`),
      `${lines.join("\n")}\n`,
    );
    if (makeImages) {
      for (const img of imgs) {
        fs.writeFileSync(path.join(d, `${img}.png`), "dummy");
      }
    }
  }

  let videoSets = opts.videoSets;
  if (videoSets === undefined) {
    videoSets = {};
    for (const folder of Object.keys(folders)) {
      (videoSets as Record<string, unknown>)[
        path.join(root, "videos", `${folder}.mp4`)
      ] = { crop: "0, 100, 0, 100" };
    }
  }

  // Build config.yaml (write minimal YAML by hand to control formatting).
  const cfgLines: string[] = [];
  cfgLines.push(`Task: ${task}`);
  cfgLines.push(`scorer: ${scorer}`);
  cfgLines.push(`date: ${date}`);
  cfgLines.push(`iteration: ${iteration}`);
  cfgLines.push("multianimalproject: false");
  cfgLines.push("video_sets:");
  for (const [k, v] of Object.entries(videoSets)) {
    cfgLines.push(`  ${JSON.stringify(k)}:`);
    const crop = (v as Record<string, unknown>)?.crop;
    if (crop !== undefined) {
      cfgLines.push(`    crop: ${JSON.stringify(String(crop))}`);
    } else {
      cfgLines.push("    {}");
    }
  }
  cfgLines.push("bodyparts:");
  for (const bp of bodyparts) cfgLines.push(`- ${bp}`);
  cfgLines.push("skeleton:");
  for (const [s, dst] of skeleton) {
    cfgLines.push("- - " + s);
    cfgLines.push("  - " + dst);
  }
  cfgLines.push("TrainingFraction:");
  cfgLines.push(`- ${trainFraction}`);
  fs.writeFileSync(path.join(root, "config.yaml"), `${cfgLines.join("\n")}\n`);

  if (opts.trainIndices !== undefined && opts.testIndices !== undefined) {
    const tdir = path.join(
      root,
      "training-datasets",
      `iteration-${iteration}`,
      `UnaugmentedDataSet_${task}${date}`,
    );
    fs.mkdirSync(tdir, { recursive: true });
    const name = `Documentation_data-${task}_${Math.round(
      trainFraction * 100,
    )}shuffle${shuffle}.pickle`;
    fs.writeFileSync(
      path.join(tdir, name),
      pickleBytes(opts.trainIndices, opts.testIndices, trainFraction),
    );
  }

  return path.join(root, "config.yaml");
}

function frameKeys(labels: {
  labeledFrames: Array<{
    video: { filename: string | string[] };
    frameIdx: number;
  }>;
}): Array<[string, string]> {
  const keys: Array<[string, string]> = [];
  for (const lf of labels.labeledFrames) {
    const fn = Array.isArray(lf.video.filename)
      ? lf.video.filename[lf.frameIdx]
      : lf.video.filename;
    keys.push([path.basename(path.dirname(fn)), path.basename(fn)]);
  }
  keys.sort((a, b) =>
    a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]),
  );
  return keys;
}

// ===========================================================================
// Read path: single CSV
// ===========================================================================

describe("loadDlc single-animal", () => {
  it("loads SADLC structure, frames, and points", () => {
    const labels = loadDlc(csv("dlc_testdata.csv"));
    expect(labels.skeletons.length).toBe(1);
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    expect(labels.tracks.length).toBe(0);
    expect(labels.labeledFrames.length).toBe(4);
    expect(labels.labeledFrames.map((f) => f.frameIdx)).toEqual([0, 1, 2, 3]);
    expect(labels.labeledFrames.map((f) => f.instances.length)).toEqual([
      1, 1, 0, 1,
    ]);

    const f0 = labels.labeledFrames[0].instances[0];
    expect(f0.points[0].xy).toEqual([0, 1]);
    expect(f0.points[1].xy).toEqual([2, 3]);
    expect(f0.points[2].xy).toEqual([4, 5]);

    // Frame 1: B is missing (NaN) but still produces an instance.
    const f1 = labels.labeledFrames[1].instances[0];
    expect(f1.points[0].xy).toEqual([12, 13]);
    expect(Number.isNaN(f1.points[1].xy[0])).toBe(true);
    expect(f1.points[1].visible).toBe(false);
    expect(f1.points[2].xy).toEqual([15, 16]);
  });

  it("auto-discovers config only if named config.yaml (fixture is not)", () => {
    // Fixture config is madlc_230_config.yaml, not config.yaml, so no edges.
    const labels = loadDlc(csv("dlc_testdata.csv"));
    expect(labels.skeletons[0].edges.length).toBe(0);
    expect(labels.skeletons[0].name).toBeUndefined();
  });

  it("applies edges and name from an explicit config", () => {
    const labels = loadDlc(csv("dlc_testdata.csv"), { config: configPath });
    const edges = labels.skeletons[0].edges.map((e) => [
      e.source.name,
      e.destination.name,
    ]);
    expect(edges).toEqual([
      ["A", "B"],
      ["B", "C"],
      ["A", "C"],
    ]);
    expect(labels.skeletons[0].name).toBe("maudlc_2.3.0");
  });

  it("config:false disables edges, name, and crops", () => {
    const labels = loadDlc(csv("dlc_testdata.csv"), { config: false });
    expect(labels.skeletons[0].edges.length).toBe(0);
    expect(labels.skeletons[0].name).toBeUndefined();
    expect(labels.provenance.dlc_crops).toBeUndefined();
  });

  it("loads the v2 (split-path multiindex) CSV identically", () => {
    const labels = loadDlc(csv("dlc_testdata_v2.csv"));
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    expect(labels.labeledFrames.map((f) => f.frameIdx)).toEqual([0, 1, 2, 3]);
    expect(labels.labeledFrames.map((f) => f.instances.length)).toEqual([
      1, 1, 0, 1,
    ]);
    const f0 = labels.labeledFrames[0].instances[0];
    expect(f0.points[0].xy).toEqual([0, 1]);
  });

  it("emits an empty LabeledFrame for an all-NaN row (PR #418)", () => {
    const labels = loadDlc(csv("dlc_testdata.csv"));
    const empties = labels.labeledFrames.filter(
      (f) => f.instances.length === 0,
    );
    expect(empties.length).toBe(1);
    expect(empties[0].frameIdx).toBe(2);
  });
});

describe("loadDlc multi-animal", () => {
  it("loads maDLC structure and tracks", () => {
    const labels = loadDlc(csv("madlc_testdata.csv"));
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    expect(labels.tracks.map((t) => t.name)).toEqual(["Animal1", "Animal2"]);
    expect(labels.labeledFrames.map((f) => f.instances.length)).toEqual([
      2, 2, 0, 1,
    ]);
    const [i0, i1] = labels.labeledFrames[0].instances;
    expect(i0.track?.name).toBe("Animal1");
    expect(i1.track?.name).toBe("Animal2");
  });

  it("loads MAUDLC with the single-animal individual", () => {
    const labels = loadDlc(csv("maudlc_testdata.csv"));
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C", "D", "E"]);
    expect(labels.tracks.map((t) => t.name)).toEqual([
      "Animal1",
      "Animal2",
      "single",
    ]);
    expect(labels.labeledFrames.map((f) => f.instances.length)).toEqual([
      2, 3, 0, 2,
    ]);
    // The `single` track carries D, E in frame 1 (img001 has D/E values).
    const single = labels.labeledFrames[1].instances.find(
      (i) => i.track?.name === "single",
    );
    expect(single).toBeDefined();
    expect(single!.points[3].xy).toEqual([22, 23]);
    expect(single!.points[4].xy).toEqual([24, 25]);
  });

  it("loads CollectedData_LM (MAUDLC v2) identically", () => {
    const labels = loadDlc(csv("CollectedData_LM.csv"));
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C", "D", "E"]);
    expect(labels.tracks.map((t) => t.name)).toEqual([
      "Animal1",
      "Animal2",
      "single",
    ]);
    expect(labels.labeledFrames.map((f) => f.instances.length)).toEqual([
      2, 3, 0, 2,
    ]);
  });
});

describe("loadDlc multi-dataset", () => {
  it("loads video1 dataset (basename-in-CSV-dir image resolution)", () => {
    const labels = loadDlc(path.join(multiDir, "video1", "dlc_dataset_1.csv"));
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    expect(labels.tracks.map((t) => t.name)).toEqual(["Animal1", "Animal2"]);
    expect(labels.labeledFrames.length).toBe(2);
    expect(labels.videos.length).toBe(1);
  });

  it("loads video2 dataset", () => {
    const labels = loadDlc(path.join(multiDir, "video2", "dlc_dataset_2.csv"));
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C"]);
    expect(labels.labeledFrames.length).toBe(1);
  });
});

// ===========================================================================
// Config / edges / crops
// ===========================================================================

describe("config + edges + crops", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-cfg-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("drops ghost edges referencing absent bodyparts with a warning", () => {
    const spy = mockWarn();
    try {
      const cfgPath = path.join(tmp, "ghost.yaml");
      fs.writeFileSync(
        cfgPath,
        [
          "Task: t",
          "scorer: S",
          "skeleton:",
          "- - A",
          "  - B",
          "- - A",
          "  - ghost",
        ].join("\n"),
      );
      const labels = loadDlc(csv("dlc_testdata.csv"), { config: cfgPath });
      const edges = labels.skeletons[0].edges.map((e) => [
        e.source.name,
        e.destination.name,
      ]);
      expect(edges).toEqual([["A", "B"]]);
      expect(spy.messages.some((m) => m.includes("ghost"))).toBe(true);
    } finally {
      spy.restore();
    }
  });

  it("skips malformed skeleton entries without throwing", () => {
    const spy = mockWarn();
    try {
      const cfgPath = path.join(tmp, "malformed.yaml");
      fs.writeFileSync(
        cfgPath,
        [
          "Task: t",
          "scorer: S",
          "skeleton:",
          "- - snout",
          "- bad",
          "- - a",
          "  - b",
          "  - c",
        ].join("\n"),
      );
      expect(() =>
        loadDlc(csv("dlc_testdata.csv"), { config: cfgPath }),
      ).not.toThrow();
    } finally {
      spy.restore();
    }
  });

  it("records non-identity crops and links a closed source video", () => {
    // Synthetic config: a video_sets key whose stem matches the folder "video".
    const cfgPath = path.join(tmp, "crop.yaml");
    const sourcePath = "/some/where/video.mp4";
    fs.writeFileSync(
      cfgPath,
      [
        "Task: t",
        "scorer: S",
        "video_sets:",
        `  ${JSON.stringify(sourcePath)}:`,
        "    crop: '10, 60, 20, 90'",
      ].join("\n"),
    );
    const labels = loadDlc(csv("dlc_testdata.csv"), { config: cfgPath });
    expect(labels.provenance.dlc_crops).toEqual({
      [sourcePath]: [10, 20, 60, 90],
    });
    const v = labels.videos[0];
    expect(v.sourceVideo).not.toBeNull();
    expect(v.sourceVideo!.filename).toBe(sourcePath);
    expect(v.sourceVideo!.openBackend).toBe(false);
    expect(v.originalVideo).toBe(v.sourceVideo);
  });

  it("identity crop is not recorded", () => {
    const cfgPath = path.join(tmp, "identity.yaml");
    fs.writeFileSync(
      cfgPath,
      [
        "Task: t",
        "scorer: S",
        "video_sets:",
        '  "/x/video.mp4":',
        "    crop: '0, 384, 0, 384'",
      ].join("\n"),
    );
    const labels = loadDlc(csv("dlc_testdata.csv"), { config: cfgPath });
    expect(labels.provenance.dlc_crops).toBeUndefined();
  });

  it("links no source video on a stem mismatch", () => {
    const cfgPath = path.join(tmp, "mismatch.yaml");
    fs.writeFileSync(
      cfgPath,
      [
        "Task: t",
        "scorer: S",
        "video_sets:",
        '  "/x/somethingelse.mp4":',
        "    crop: '10, 60, 20, 90'",
      ].join("\n"),
    );
    const labels = loadDlc(csv("dlc_testdata.csv"), { config: cfgPath });
    expect(labels.videos[0].sourceVideo).toBeNull();
    expect(labels.provenance.dlc_crops).toBeUndefined();
  });

  it("skips placeholder video_sets keys", () => {
    const cfgPath = path.join(tmp, "placeholder.yaml");
    fs.writeFileSync(
      cfgPath,
      [
        "Task: t",
        "scorer: S",
        "video_sets:",
        '  "WILL BE AUTOMATICALLY UPDATED BY DEMO CODE":',
        "    crop: '10, 60, 20, 90'",
      ].join("\n"),
    );
    const labels = loadDlc(csv("dlc_testdata.csv"), { config: cfgPath });
    expect(labels.videos[0].sourceVideo).toBeNull();
  });

  it("preserves Windows source paths matched by stem", () => {
    const cfgPath = path.join(tmp, "windows.yaml");
    const win = "D:\\\\proj\\\\videos\\\\video.mp4";
    fs.writeFileSync(
      cfgPath,
      [
        "Task: t",
        "scorer: S",
        "video_sets:",
        `  ${JSON.stringify("D:\\proj\\videos\\video.mp4")}:`,
        "    crop: '10, 60, 20, 90'",
      ].join("\n"),
    );
    void win;
    const labels = loadDlc(csv("dlc_testdata.csv"), { config: cfgPath });
    expect(labels.videos[0].sourceVideo!.filename).toBe(
      "D:\\proj\\videos\\video.mp4",
    );
  });
});

describe("parseDlcCrop", () => {
  it("reorders width-range-first to sleap rect", () => {
    expect(parseDlcCrop("10, 60, 20, 90")).toEqual([10, 20, 60, 90]);
    expect(parseDlcCrop([10, 60, 20, 90])).toEqual([10, 20, 60, 90]);
    expect(parseDlcCrop("10.0, 60.0, 20.0, 90.0")).toEqual([10, 20, 60, 90]);
  });

  it("returns null for missing/empty/wrong-arity/unparsable", () => {
    expect(parseDlcCrop(null)).toBeNull();
    expect(parseDlcCrop("")).toBeNull();
    expect(parseDlcCrop("   ")).toBeNull();
    expect(parseDlcCrop("10,60")).toBeNull();
    expect(parseDlcCrop("10,60,20")).toBeNull();
    expect(parseDlcCrop("a,b,c,d")).toBeNull();
    expect(parseDlcCrop(42)).toBeNull();
  });

  it("warns and returns null for inverted crops", () => {
    const spy = mockWarn();
    try {
      expect(parseDlcCrop("60, 10, 20, 90")).toBeNull();
      expect(spy.messages.some((m) => m.includes("inverted"))).toBe(true);
    } finally {
      spy.restore();
    }
  });

  it("returns null for identity crops at origin", () => {
    expect(parseDlcCrop("0, 384, 0, 384")).toBeNull();
    expect(parseDlcCrop("0, 100, 0, 100")).toBeNull();
  });
});

// ===========================================================================
// Routing predicates
// ===========================================================================

describe("isDlcFile / isDlcProjectPath", () => {
  it("detects DLC CSVs", () => {
    expect(isDlcFile(csv("dlc_testdata.csv"))).toBe(true);
    expect(isDlcFile(csv("madlc_testdata.csv"))).toBe(true);
    expect(isDlcFile(csv("maudlc_testdata.csv"))).toBe(true);
  });

  it("rejects non-DLC and missing files", () => {
    expect(isDlcFile("nonexistent.csv")).toBe(false);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-det-"));
    try {
      const bad = path.join(tmp, "bad.csv");
      fs.writeFileSync(bad, "col1,col2,col3\n1,2,3\n");
      expect(isDlcFile(bad)).toBe(false);
      const empty = path.join(tmp, "empty.csv");
      fs.writeFileSync(empty, "");
      expect(isDlcFile(empty)).toBe(false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("isDlcProjectPath is false for the fixture dir (config not named config.yaml)", () => {
    expect(isDlcProjectPath(dlcDir)).toBe(false);
  });

  it("isDlcProjectPath true for a synthetic project dir and its config.yaml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-proj-"));
    try {
      const cfg = makeDlcProject(tmp);
      expect(isDlcProjectPath(tmp)).toBe(true);
      expect(isDlcProjectPath(cfg)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// Project loading
// ===========================================================================

describe("loadDlcProject", () => {
  it("loads the fixture project from an explicit config file", () => {
    const labels = loadDlcProject(configPath);
    expect(labels.skeletons[0].nodeNames).toEqual(["A", "B", "C", "D", "E"]);
    expect(labels.tracks.map((t) => t.name)).toEqual([
      "Animal1",
      "Animal2",
      "single",
    ]);
    expect(labels.provenance.dlc_scorer).toBe("LM");
    expect(labels.provenance.dlc_task).toBe("maudlc_2.3.0");
    expect(typeof labels.provenance.dlc_project).toBe("string");
  });

  it("shares one skeleton/track set across folders (synthetic)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-shared-"));
    try {
      const cfg = makeDlcProject(tmp);
      const labels = loadDlcProject(cfg);
      expect(labels.skeletons.length).toBe(1);
      expect(labels.skeletons[0].nodeNames).toEqual([
        "leftear",
        "rightear",
        "snout",
      ]);
      // 5 frames total (vid1: 3, vid2: 2).
      expect(labels.labeledFrames.length).toBe(5);
      const edges = labels.skeletons[0].edges.map((e) => [
        e.source.name,
        e.destination.name,
      ]);
      expect(edges).toEqual([
        ["snout", "leftear"],
        ["snout", "rightear"],
      ]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("ignores benign loader kwargs (PR #488)", () => {
    expect(() =>
      loadDlcProject(configPath, {
        openVideos: false,
        lazy: true,
      } as Record<string, unknown>),
    ).not.toThrow();
  });

  it("throws when no annotation CSVs are found", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-nocsv-"));
    try {
      fs.mkdirSync(path.join(tmp, "labeled-data"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "config.yaml"),
        "Task: t\nscorer: S\nvideo_sets:\n  x: {}\n",
      );
      expect(() => loadDlcProject(tmp)).toThrow(/No DLC annotation CSVs/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when config is unreadable (YAML list)", () => {
    const spy = mockWarn();
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-badcfg-"));
      try {
        fs.writeFileSync(path.join(tmp, "config.yaml"), "- a\n- b\n");
        expect(() => loadDlcProject(tmp)).toThrow(/Could not read DLC config/);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } finally {
      spy.restore();
    }
  });

  it("throws when a project directory has no config.yaml", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-noconf-"));
    try {
      expect(() => loadDlcProject(tmp)).toThrow(/No config.yaml found/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// Splits
// ===========================================================================

describe("loadDlcSplits", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-split-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("maps train/test indices through merged lexicographic order", () => {
    // Merged order: 0:(vid1,img000) 1:(vid1,img001) 2:(vid1,img002)
    //               3:(vid2,img000) 4:(vid2,img001)
    const cfg = makeDlcProject(tmp, {
      trainIndices: [0, 2, 4],
      testIndices: [1, 3],
    });
    const splits = loadDlcSplits(cfg);
    expect(splits).toBeInstanceOf(LabelsSet);
    expect([...splits.keys()].sort()).toEqual(["test", "train"]);
    expect(frameKeys(splits.get("train")!)).toEqual([
      ["vid1", "img000.png"],
      ["vid1", "img002.png"],
      ["vid2", "img001.png"],
    ]);
    expect(frameKeys(splits.get("test")!)).toEqual([
      ["vid1", "img001.png"],
      ["vid2", "img000.png"],
    ]);
  });

  it("filters out -1 sentinel indices", () => {
    const cfg = makeDlcProject(tmp, {
      folders: { vid1: ["img000", "img001"] },
      trainIndices: [0, -1],
      testIndices: [1],
    });
    const splits = loadDlcSplits(cfg);
    expect(frameKeys(splits.get("train")!)).toEqual([["vid1", "img000.png"]]);
    expect(frameKeys(splits.get("test")!)).toEqual([["vid1", "img001.png"]]);
  });

  it("follows lexicographic order for non-zero-padded names and warns", () => {
    const spy = mockWarn();
    try {
      const cfg = makeDlcProject(tmp, {
        folders: { vid1: ["img2", "img10"] },
        videoSets: { [path.join(tmp, "videos", "vid1.mp4")]: {} },
        trainIndices: [0],
        testIndices: [1],
      });
      const splits = loadDlcSplits(cfg);
      // Lexicographically "img10.png" < "img2.png", so position 0 is img10.
      expect(frameKeys(splits.get("train")!)).toEqual([["vid1", "img10.png"]]);
      expect(frameKeys(splits.get("test")!)).toEqual([["vid1", "img2.png"]]);
      expect(spy.messages.some((m) => m.includes("lexicographic"))).toBe(true);
    } finally {
      spy.restore();
    }
  });

  it("throws when no Documentation pickle exists", () => {
    const cfg = makeDlcProject(tmp); // no indices -> no pickle
    expect(() => loadDlcSplits(cfg)).toThrow(/No DLC Documentation/);
  });

  it("throws on ambiguous shuffles and disambiguates with a selector", () => {
    makeDlcProject(tmp, {
      folders: { vid1: ["img000", "img001"] },
      trainIndices: [0],
      testIndices: [1],
      shuffle: 1,
    });
    const cfg = makeDlcProject(tmp, {
      folders: { vid1: ["img000", "img001"] },
      trainIndices: [1],
      testIndices: [0],
      shuffle: 2,
    });
    expect(() => loadDlcSplits(cfg)).toThrow(/Multiple DLC splits/);
    const splits = loadDlcSplits(cfg, { shuffle: 2 });
    expect(frameKeys(splits.get("train")!)).toEqual([["vid1", "img001.png"]]);
  });

  it("throws when a selector matches nothing", () => {
    const cfg = makeDlcProject(tmp, {
      folders: { vid1: ["img000", "img001"] },
      trainIndices: [0],
      testIndices: [1],
      shuffle: 1,
    });
    expect(() => loadDlcSplits(cfg, { shuffle: 99 })).toThrow(
      /No Documentation pickle matched/,
    );
  });

  it("warns and yields empty splits when images are missing (PR #492)", () => {
    const spy = mockWarn();
    try {
      const cfg = makeDlcProject(tmp, {
        trainIndices: [0, 2, 4],
        testIndices: [1, 3],
        makeImages: false,
      });
      const splits = loadDlcSplits(cfg);
      expect(frameKeys(splits.get("train")!)).toEqual([]);
      expect(frameKeys(splits.get("test")!)).toEqual([]);
      expect(
        spy.messages.some((m) => m.includes("labeled images were not found")),
      ).toBe(true);
    } finally {
      spy.restore();
    }
  });
});

// ===========================================================================
// Helper-level unit tests
// ===========================================================================

describe("helpers", () => {
  it("readPickle decodes the DLC documentation shape", () => {
    const buf = pickleBytes([0, 2, 4], [1, 3], 0.8);
    const meta = readPickle(buf) as unknown[];
    expect(meta.length).toBe(4);
    expect(meta[1]).toEqual([0, 2, 4]);
    expect(meta[2]).toEqual([1, 3]);
    expect(meta[3]).toBeCloseTo(0.8);
  });

  it("readDlcSplit filters -1 and returns int lists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-pick-"));
    try {
      const p = path.join(tmp, "doc.pickle");
      fs.writeFileSync(p, pickleBytes([0, -1, 2], [1, -1], 0.8));
      expect(readDlcSplit(p)).toEqual([[0, 2], [1]]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("readCsvScorer reads the scorer from the first row", () => {
    // Non-v2 CSV: scorer value is the second column.
    expect(readCsvScorer(csv("maudlc_testdata.csv"))).toBe("Scorer");
    // v2 (multiindex) CSV: second column is blank.
    expect(readCsvScorer(csv("CollectedData_LM.csv"))).toBe("");
  });

  it("looksLikeDlcConfig requires >=2 known keys", () => {
    expect(looksLikeDlcConfig({ scorer: "S", Task: "t" })).toBe(true);
    expect(looksLikeDlcConfig({ scorer: "S" })).toBe(false);
    expect(looksLikeDlcConfig(["a", "b"])).toBe(false);
    expect(looksLikeDlcConfig(null)).toBe(false);
  });

  it("readDlcConfig warns and returns null for a non-mapping", () => {
    const spy = mockWarn();
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-rc-"));
      try {
        const p = path.join(tmp, "config.yaml");
        fs.writeFileSync(p, "- a\n- b\n");
        expect(readDlcConfig(p)).toBeNull();
        expect(readDlcConfig(path.join(tmp, "missing.yaml"))).toBeNull();
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } finally {
      spy.restore();
    }
  });

  it("discoverConfig finds a config.yaml up the tree", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-disc-"));
    try {
      makeDlcProject(tmp);
      const someCsv = path.join(
        tmp,
        "labeled-data",
        "vid1",
        "CollectedData_LM.csv",
      );
      expect(discoverConfig(someCsv)).toBe(path.join(tmp, "config.yaml"));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dlcMergedOrder + warnIfNonlexicographic round-trip", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-merge-"));
    try {
      const cfg = makeDlcProject(tmp);
      const cfgObj = readDlcConfig(cfg)!;
      const merged = dlcMergedOrder(path.dirname(cfg), cfgObj);
      expect(merged).toEqual([
        ["vid1", "img000.png"],
        ["vid1", "img001.png"],
        ["vid1", "img002.png"],
        ["vid2", "img000.png"],
        ["vid2", "img001.png"],
      ]);
      // Zero-padded names -> no warning.
      const spy = mockWarn();
      try {
        warnIfNonlexicographic(merged);
        expect(spy.messages.some((m) => m.includes("lexicographic"))).toBe(
          false,
        );
      } finally {
        spy.restore();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("dlcMergedOrder falls back to findProjectCsvs on stem mismatch", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dlc-fb-"));
    try {
      // video_sets stems do not match any labeled-data folder.
      const cfg = makeDlcProject(tmp, {
        videoSets: { [path.join(tmp, "videos", "nomatch.mp4")]: {} },
      });
      const cfgObj = readDlcConfig(cfg)!;
      const merged = dlcMergedOrder(path.dirname(cfg), cfgObj);
      expect(merged.length).toBe(5);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// console.warn spy helper.
// ---------------------------------------------------------------------------

function mockWarn(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  return {
    messages,
    restore: () => {
      console.warn = original;
    },
  };
}
