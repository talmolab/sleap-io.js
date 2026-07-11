/**
 * Unit tests for external video path resolution (issue #213).
 *
 * Covers the pure path algebra (parse/format/join/dirname/basename), candidate
 * generation (verbatim, relative-to-labels-dir, common-suffix anchor, and
 * deepest-first trailing-tail grafts), the prefix-swap that remaps a whole image
 * sequence from one probe, and the async `resolveVideoSource` against a stubbed
 * `FsResolver` — including the cross-machine "images moved to a subfolder" repro
 * from the issue and the "confirmed missing" signal.
 */
import { describe, it, expect } from "../bun-test";
import type { FsResolver } from "../../src/model/matching.js";
import {
  parsePath,
  formatPath,
  posixDirname,
  posixBasename,
  posixJoin,
  anchorCandidate,
  videoPathCandidates,
  derivePrefixSwap,
  applyPrefixSwap,
  resolveFirstExisting,
  resolveVideoSource,
} from "../../src/video/path-resolve.js";

/** An FsResolver whose `exists` returns true only for the given set of paths. */
function stubFs(existing: string[]): FsResolver {
  const set = new Set(existing);
  return {
    async exists(p: string) {
      return set.has(p);
    },
    async sameFile() {
      return false;
    },
    async realpath(p: string) {
      return p;
    },
  };
}

describe("parsePath / formatPath", () => {
  it("round-trips POSIX absolute, relative, and Windows drive paths", () => {
    expect(parsePath("/home/u/a.jpg")).toEqual({
      absolute: true,
      drive: null,
      unc: false,
      parts: ["home", "u", "a.jpg"],
    });
    expect(parsePath("raw/a.jpg")).toEqual({
      absolute: false,
      drive: null,
      unc: false,
      parts: ["raw", "a.jpg"],
    });
    expect(parsePath("L:\\code\\a.jpg")).toEqual({
      absolute: true,
      drive: "L:",
      unc: false,
      parts: ["code", "a.jpg"],
    });
    expect(parsePath("C:relative\\a.jpg")).toEqual({
      absolute: false,
      drive: "C:",
      unc: false,
      parts: ["relative", "a.jpg"],
    });
    for (const p of [
      "/home/u/a.jpg",
      "raw/a.jpg",
      "L:/code/a.jpg",
      "C:relative/a.jpg",
    ]) {
      expect(formatPath(parsePath(p))).toBe(p.replace(/\\/g, "/"));
    }
  });

  it("normalizes backslashes and drops '.'/empty segments", () => {
    expect(formatPath(parsePath("a\\.\\b\\\\c.jpg"))).toBe("a/b/c.jpg");
  });

  it("preserves a UNC / network-share root (does not collapse `//`)", () => {
    // `\\server\share\a.jpg` and `//server/share/a.jpg` both round-trip as UNC —
    // collapsing to `/server/...` would re-root to the current drive on Windows.
    expect(parsePath("\\\\server\\share\\imgs\\a.jpg")).toEqual({
      absolute: true,
      drive: null,
      unc: true,
      parts: ["server", "share", "imgs", "a.jpg"],
    });
    expect(formatPath(parsePath("\\\\server\\share\\imgs\\a.jpg"))).toBe(
      "//server/share/imgs/a.jpg",
    );
    expect(formatPath(parsePath("//server/share/imgs/a.jpg"))).toBe(
      "//server/share/imgs/a.jpg",
    );
    expect(posixDirname("//server/share/proj/labels.slp")).toBe(
      "//server/share/proj",
    );
    // The verbatim (same-machine) candidate keeps the UNC root intact.
    expect(
      videoPathCandidates(
        "\\\\server\\share\\imgs\\a.jpg",
        "//server/share",
      )[0],
    ).toBe("//server/share/imgs/a.jpg");
  });

  it("derives dirname / basename cross-platform", () => {
    expect(posixDirname("L:\\code\\proj\\a.jpg")).toBe("L:/code/proj");
    expect(posixBasename("L:\\code\\proj\\a.jpg")).toBe("a.jpg");
    expect(posixDirname("/root")).toBe("/");
    expect(posixBasename("only.jpg")).toBe("only.jpg");
  });

  it("joins a relative tail onto a directory, ignoring the tail's root", () => {
    expect(posixJoin("L:/code/proj", "raw/a.jpg")).toBe(
      "L:/code/proj/raw/a.jpg",
    );
    expect(posixJoin("/base", "/abs/tail.jpg")).toBe("/base/abs/tail.jpg");
  });
});

describe("videoPathCandidates", () => {
  it("puts the verbatim (normalized) stored path first", () => {
    const c = videoPathCandidates("L:\\a\\b.jpg", "L:/proj");
    expect(c[0]).toBe("L:/a/b.jpg");
  });

  it("adds relative-to-labels-dir only for a relative stored path", () => {
    const rel = videoPathCandidates("raw/b.jpg", "L:/proj");
    expect(rel).toContain("L:/proj/raw/b.jpg");
    // Absolute stored path: no naive relative join of the absolute string.
    const abs = videoPathCandidates("/x/raw/b.jpg", "L:/proj");
    expect(abs).not.toContain("L:/proj//x/raw/b.jpg");
  });

  it("emits trailing-tail grafts deepest-first, ending at the basename", () => {
    const c = videoPathCandidates("/a/b/c/d.jpg", "L:/proj");
    const grafts = c.filter((x) => x.startsWith("L:/proj/"));
    expect(grafts).toEqual([
      "L:/proj/a/b/c/d.jpg",
      "L:/proj/b/c/d.jpg",
      "L:/proj/c/d.jpg",
      "L:/proj/d.jpg",
    ]);
  });

  it("caps the trailing-tail depth", () => {
    const deep = `/${Array.from({ length: 30 }, (_, i) => `d${i}`).join("/")}/f.jpg`;
    const c = videoPathCandidates(deep, "L:/proj", 3);
    const grafts = c.filter((x) => x.startsWith("L:/proj/"));
    expect(grafts.length).toBeLessThanOrEqual(3);
    // Basename graft is always the shallowest included.
    expect(grafts[grafts.length - 1]).toBe("L:/proj/f.jpg");
  });

  it("de-duplicates candidates", () => {
    const c = videoPathCandidates("b.jpg", "L:/proj");
    expect(new Set(c).size).toBe(c.length);
  });
});

describe("anchorCandidate", () => {
  it("reconstructs via the deepest shared directory anchor (issue repro)", () => {
    const stored =
      "/home/talmo/code/sleap-nn/scratch/2026-07-10-mars/raw_images_top/MARS_top_00000.jpg";
    const labelsDir = "L:/code/sleap-nn/scratch/2026-07-10-mars";
    expect(anchorCandidate(stored, labelsDir)).toBe(
      "L:/code/sleap-nn/scratch/2026-07-10-mars/raw_images_top/MARS_top_00000.jpg",
    );
  });

  it("returns null when there is no shared anchor", () => {
    expect(anchorCandidate("/x/y/z.jpg", "L:/totally/different")).toBeNull();
  });
});

describe("derivePrefixSwap / applyPrefixSwap", () => {
  it("swaps a foreign absolute prefix for a local drive prefix across a list", () => {
    const swap = derivePrefixSwap(
      "/home/u/proj/raw/f0.jpg",
      "L:/data/proj/raw/f0.jpg",
    );
    expect(applyPrefixSwap("/home/u/proj/raw/f0.jpg", swap)).toBe(
      "L:/data/proj/raw/f0.jpg",
    );
    expect(applyPrefixSwap("/home/u/proj/raw/f9.jpg", swap)).toBe(
      "L:/data/proj/raw/f9.jpg",
    );
  });

  it("leaves a path that does not share the old prefix unchanged", () => {
    const swap = derivePrefixSwap("/a/raw/f0.jpg", "L:/proj/raw/f0.jpg");
    expect(applyPrefixSwap("/other/raw/f0.jpg", swap)).toBe(
      "/other/raw/f0.jpg",
    );
  });

  it("leaves a path with a different root/drive unchanged (root-equality guard)", () => {
    // old prefix is POSIX-absolute (`/home/u`); a differently-rooted member
    // (Windows drive, or relative) must NOT be rewritten.
    const swap = derivePrefixSwap("/home/u/raw/f0.jpg", "L:/proj/raw/f0.jpg");
    expect(applyPrefixSwap("C:/other/raw/f9.jpg", swap)).toBe(
      "C:/other/raw/f9.jpg",
    );
    expect(applyPrefixSwap("relative/raw/f9.jpg", swap)).toBe(
      "relative/raw/f9.jpg",
    );
  });

  it("is the identity when stored already equals resolved", () => {
    const swap = derivePrefixSwap("L:/proj/raw/f0.jpg", "L:/proj/raw/f0.jpg");
    expect(applyPrefixSwap("L:/proj/raw/f3.jpg", swap)).toBe(
      "L:/proj/raw/f3.jpg",
    );
  });
});

describe("resolveFirstExisting", () => {
  it("returns the first candidate the resolver confirms", async () => {
    const fs = stubFs(["b", "c"]);
    expect(await resolveFirstExisting(["a", "b", "c"], fs)).toBe("b");
  });

  it("treats a throwing resolver call as 'not here' and continues", async () => {
    const fs: FsResolver = {
      async exists(p) {
        if (p === "a") throw new Error("boom");
        return p === "b";
      },
      async sameFile() {
        return false;
      },
      async realpath(p) {
        return p;
      },
    };
    expect(await resolveFirstExisting(["a", "b"], fs)).toBe("b");
  });

  it("returns null when nothing exists", async () => {
    expect(await resolveFirstExisting(["a", "b"], stubFs([]))).toBeNull();
  });
});

describe("resolveVideoSource", () => {
  const labelsDir = "L:/code/sleap-nn/scratch/2026-07-10-mars";

  it("single file: returns the source unchanged on a verbatim hit", async () => {
    const fs = stubFs(["L:/vids/a.mp4"]);
    const r = await resolveVideoSource("L:/vids/a.mp4", labelsDir, fs);
    expect(r.filename).toBe("L:/vids/a.mp4");
    expect(r.firstMissing).toBe(false);
  });

  it("single file: grafts the subfolder tail onto the labels dir", async () => {
    const fs = stubFs([`${labelsDir}/videos/clip.mp4`]);
    const r = await resolveVideoSource(
      "/foreign/box/videos/clip.mp4",
      labelsDir,
      fs,
    );
    expect(r.filename).toBe(`${labelsDir}/videos/clip.mp4`);
    expect(r.firstMissing).toBe(false);
  });

  it("single file: flags firstMissing when no candidate exists", async () => {
    const r = await resolveVideoSource(
      "/foreign/clip.mp4",
      labelsDir,
      stubFs([]),
    );
    expect(r.firstMissing).toBe(true);
    expect(r.filename).toBe("/foreign/clip.mp4");
  });

  it("image sequence: remaps the whole list from one first-frame probe", async () => {
    const stored = [
      "/home/talmo/code/sleap-nn/scratch/2026-07-10-mars/raw_images_top/MARS_top_00000.jpg",
      "/home/talmo/code/sleap-nn/scratch/2026-07-10-mars/raw_images_top/MARS_top_00001.jpg",
      "/home/talmo/code/sleap-nn/scratch/2026-07-10-mars/raw_images_top/MARS_top_00002.jpg",
    ];
    // Only the FIRST frame is present in the resolver's set — the rest must be
    // remapped by the derived prefix swap, not probed individually.
    const fs = stubFs([`${labelsDir}/raw_images_top/MARS_top_00000.jpg`]);
    const r = await resolveVideoSource(stored, labelsDir, fs);
    expect(r.firstMissing).toBe(false);
    expect(r.filename).toEqual([
      `${labelsDir}/raw_images_top/MARS_top_00000.jpg`,
      `${labelsDir}/raw_images_top/MARS_top_00001.jpg`,
      `${labelsDir}/raw_images_top/MARS_top_00002.jpg`,
    ]);
  });

  it("image sequence: returns the list unchanged on a verbatim hit", async () => {
    const stored = [`${labelsDir}/imgs/a.jpg`, `${labelsDir}/imgs/b.jpg`];
    const fs = stubFs([`${labelsDir}/imgs/a.jpg`]);
    const r = await resolveVideoSource(stored, labelsDir, fs);
    expect(r.filename).toBe(stored); // same reference — no churn
    expect(r.firstMissing).toBe(false);
  });

  it("image sequence: flags firstMissing when the first frame is unreachable", async () => {
    const stored = ["/foreign/raw/a.jpg", "/foreign/raw/b.jpg"];
    const r = await resolveVideoSource(stored, labelsDir, stubFs([]));
    expect(r.firstMissing).toBe(true);
    expect(r.filename).toBe(stored);
  });

  it("empty image list is a no-op", async () => {
    const r = await resolveVideoSource([], labelsDir, stubFs([]));
    expect(r.filename).toEqual([]);
    expect(r.firstMissing).toBe(false);
  });

  it("image sequence: only members sharing the first frame's prefix are remapped", async () => {
    // A mixed-prefix list: frame 0 resolves via a tail graft; a differently
    // rooted member does not share the swapped prefix and is left verbatim.
    const stored = ["/foreign/sub/f0.jpg", "D:/unrelated/other.jpg"];
    const fs = stubFs([`${labelsDir}/sub/f0.jpg`]);
    const r = await resolveVideoSource(stored, labelsDir, fs);
    expect(r.firstMissing).toBe(false);
    expect(r.filename).toEqual([
      `${labelsDir}/sub/f0.jpg`,
      "D:/unrelated/other.jpg",
    ]);
  });
});
