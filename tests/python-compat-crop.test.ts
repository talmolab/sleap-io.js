/**
 * JS -> Python cross-compatibility for virtual crops (SLP format 2.3).
 *
 * Builds a cropped Labels in JS, writes a real `.slp`, and shells to a
 * crop-capable Python sleap-io to confirm:
 *   1. `read_video_crops(path)` parses the JS-written `/video_crops` (a length-1
 *      vlen string array) into the exact `{video, crop, fill}` entry, and
 *   2. a full `sio.load_slp(path)` reconstructs a `Video` whose `crop_rect`,
 *      `crop_fill`, and cropped `(H, W, C)` equal the JS crop.
 *
 * The crop feature shipped in sleap-io 0.8.0. PyPI currently resolves
 * `uv run --with sleap-io` to 0.7.1 (NO crop), so this test PROBES candidate
 * interpreters for crop capability and runs against the first capable one:
 *   - SLEAP_IO_PY env var (explicit override),
 *   - the repo-local dev venv `/home/talmo/code/sleap-io/.venv/bin/python` (0.8.0),
 *   - `uv run --with sleap-io python` (only if that resolves a crop build).
 * If none is crop-capable (e.g. CI without a local 0.8.0), the test documents the
 * gating and returns — same degradation policy as the other Python-compat tests.
 *
 * The closed-style cropped video (crop in backendMetadata, no sourceVideo) lets
 * Python's `make_video` reconstruct the source backend from videos_json without
 * needing the (absent) media file — load_slp then reports the cropped H/W/C and
 * crop/fill exactly (frame count may be 0 since the media file is not present).
 */
import { describe, it, expect, setDefaultTimeout } from "./bun-test";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { Labels } from "../src/model/labels.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Instance } from "../src/model/instance.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A cold uv cache can download sleap-io + deps on the first probe.
setDefaultTimeout(120_000);

function tmpFile(ext: string): string {
  return join(
    tmpdir(),
    `sleap-io-js-crop-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`,
  );
}

/**
 * A Python invocation spec: argv prefix (the interpreter, possibly via `uv run`).
 * The probe appends `["python", scriptPath]` or `[scriptPath]` as appropriate.
 */
interface PyRunner {
  label: string;
  run: (scriptPath: string) => string;
}

/** Probe a runner for crop capability (read_video_crops + Video.crop present). */
function isCropCapable(runner: PyRunner): boolean {
  const probe = tmpFile(".py");
  writeFileSync(
    probe,
    [
      "try:",
      "    from sleap_io.io.slp import read_video_crops",
      "    from sleap_io.model.video import Video",
      "    assert hasattr(Video, 'crop')",
      "    print('CROP_CAPABLE')",
      "except Exception as e:",
      "    print('NOT_CAPABLE', type(e).__name__)",
    ].join("\n"),
  );
  try {
    const out = runner.run(probe);
    return out.includes("CROP_CAPABLE");
  } catch {
    return false;
  } finally {
    try {
      unlinkSync(probe);
    } catch {
      /* ignore */
    }
  }
}

/** Build the ordered list of candidate Python runners. */
function candidateRunners(): PyRunner[] {
  const runners: PyRunner[] = [];
  const envPy = process.env.SLEAP_IO_PY;
  if (envPy) {
    runners.push({
      label: `$SLEAP_IO_PY (${envPy})`,
      run: (s) =>
        execFileSync(envPy, [s], { encoding: "utf-8", timeout: 60_000 }),
    });
  }
  const devVenv = "/home/talmo/code/sleap-io/.venv/bin/python";
  if (existsSync(devVenv)) {
    runners.push({
      label: `dev venv (${devVenv})`,
      run: (s) =>
        execFileSync(devVenv, [s], { encoding: "utf-8", timeout: 60_000 }),
    });
  }
  runners.push({
    label: "uv run --with sleap-io",
    run: (s) =>
      execFileSync("uv", ["run", "--with", "sleap-io", "python", s], {
        encoding: "utf-8",
        timeout: 120_000,
      }),
  });
  return runners;
}

/** First crop-capable runner, or null if none. */
function findCropRunner(): PyRunner | null {
  for (const runner of candidateRunners()) {
    try {
      if (isCropCapable(runner)) return runner;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

describe("JS -> Python cross-compat: virtual crop (SLP 2.3)", () => {
  it("Python read_video_crops + load_slp reconstruct the JS crop", async () => {
    const runner = findCropRunner();
    if (!runner) {
      // No crop-capable Python available (e.g. CI with only PyPI 0.7.1). The
      // JS->JS and Python->JS round-trips cover the format elsewhere; document
      // and skip rather than fail.
      // eslint-disable-next-line no-console
      console.warn(
        "[crop-compat] no crop-capable Python found (need sleap-io >= 0.8.0); " +
          "skipping JS->Python crop assertion. Set SLEAP_IO_PY to a 0.8.0+ interpreter.",
      );
      return;
    }

    // Closed-style cropped video: crop rides backendMetadata (no sourceVideo),
    // so Python can rebuild the source backend from videos_json alone.
    const skel = new Skeleton({ name: "s", nodes: ["a", "b"] });
    const video = new Video({
      filename: "/data/big.mp4",
      backend: null,
      backendMetadata: {
        type: "MediaVideo",
        shape: [1, 200, 200, 1],
        source_shape: [1, 480, 640, 1],
        crop: [100, 50, 300, 250],
        crop_fill: 7,
        dataset: null,
        fps: 30,
        grayscale: true,
      },
    });
    const inst = Instance.fromArray(
      [
        [10, 20],
        [30, 40],
      ],
      skel,
    );
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const labels = new Labels({
      skeletons: [skel],
      videos: [video],
      labeledFrames: [lf],
    });

    const bytes = await saveSlpToBytes(labels);
    const slpPath = tmpFile(".slp");
    const pyPath = tmpFile(".py");

    try {
      writeFileSync(slpPath, Buffer.from(bytes));
      const pyScript = `
import sleap_io as sio
from sleap_io.io.slp import read_video_crops

slp_path = ${JSON.stringify(slpPath)}

# 1. read_video_crops accepts the JS-written /video_crops (length-1 vlen array).
crops = read_video_crops(slp_path)
assert 0 in crops, f"missing video 0: {crops}"
entry = crops[0]
assert entry["crop"] == [100, 50, 300, 250], entry["crop"]
assert entry["fill"] == 7, entry["fill"]
assert entry["video"] == 0, entry["video"]

# 2. full load_slp reconstructs the crop on the Video.
v = sio.load_slp(slp_path).videos[0]
assert tuple(v.crop_rect) == (100, 50, 300, 250), v.crop_rect
assert v.crop_fill == 7, v.crop_fill
# Cropped H, W, C exactly preserved (frame count may be 0: media file absent).
assert tuple(v.shape[1:]) == (200, 200, 1), v.shape

print("PYTHON_CROP_COMPAT_OK")
`;
      writeFileSync(pyPath, pyScript);
      const result = runner.run(pyPath);
      expect(result).toContain("PYTHON_CROP_COMPAT_OK");
    } finally {
      try {
        unlinkSync(slpPath);
      } catch {
        /* ignore */
      }
      try {
        unlinkSync(pyPath);
      } catch {
        /* ignore */
      }
    }
  });
});
