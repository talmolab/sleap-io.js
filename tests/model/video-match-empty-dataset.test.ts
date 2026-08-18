/**
 * Regression: a `MediaVideo` `.slp` backend carries `dataset: ""` (an empty
 * placeholder, not a real HDF5 dataset). `hdf5Dataset` returned that empty
 * string, so `isHdf5Video` was wrongly `true` and `matchesPath` took the HDF5
 * branch, where two such videos "match" because their empty datasets are equal
 * (`"" === ""`).
 *
 * Effect: ANY two plain-`.mp4` videos with an empty dataset matched each other,
 * regardless of filename — so sleap-app's Merge-into-Project attached donor
 * frames to the wrong video and never detected a genuinely new video.
 *
 * A real HDF5/embedded video has a NON-empty dataset and must still match by it.
 */
import { describe, it, expect } from "../bun-test";
import { Video } from "../../src/model/video.js";
import { VideoMatcher, VideoMatchMethod } from "../../src/model/matching.js";

const media = (filename: string) =>
  new Video({ filename, backendMetadata: { dataset: "" }, openBackend: false });

describe("VideoMatcher — MediaVideo with empty dataset", () => {
  it("does NOT match two different-basename videos (was wrongly true)", async () => {
    const a = media("/some/dir/centered_pair_low_quality.mp4");
    const b = media("/other/dir/clip.mp4");
    const matcher = new VideoMatcher(VideoMatchMethod.BASENAME);
    expect(await matcher.match(a, b)).toBe(false);
  });

  it("still matches same-basename videos", async () => {
    const a = media("/some/dir/clip.mp4");
    const b = media("/other/dir/clip.mp4");
    const matcher = new VideoMatcher(VideoMatchMethod.BASENAME);
    expect(await matcher.match(a, b)).toBe(true);
  });

  it("matchesPath basename compares filenames, not empty datasets", () => {
    const a = media("/a/foo.mp4");
    const different = media("/b/bar.mp4");
    const same = media("/c/foo.mp4");
    expect(a.matchesPath(different, false)).toBe(false);
    expect(a.matchesPath(same, false)).toBe(true);
  });
});
