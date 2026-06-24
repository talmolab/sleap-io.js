/**
 * Port of Labels.match() (read-only) + Labels.matchVideo() Python tests.
 *
 * GROUND TRUTH: C:/Users/Talmo/code/sleap-io @ 054cce39f
 *   tests/model/test_labels.py ::
 *     test_labels_match_basic               (4601-4633)
 *     test_labels_match_unmatched_videos      (4635-4653)
 *     test_labels_match_multiple_videos        (4655-4681)
 *     test_labels_match_track_matching          (4683-4699)
 *     test_labels_match_string_method            (4701-4715)
 *     test_labels_match_custom_matchers           (4717-4736)
 *     test_labels_match_empty                      (4738-4751)
 *     test_labels_match_summary                     (4753-4768)
 *     test_labels_match_result_import                (4770-4782)
 *     test_labels_match_with_matcher_objects          (4784-4819)
 *     test_labels_match_summary_many_unmatched         (4821-4844)
 *     test_labels_match_summary_image_video             (4846-4878)
 *     test_match_video_basename_fallback                 (373-380)
 *     test_match_video_definitive_over_basename           (382-391)
 *     test_match_video_ambiguous_raises                    (393-401)
 *     test_match_video_ambiguous_definitive_raises          (403-411)
 *     test_match_video_explicit_method                       (413-426)
 *     test_match_video_explicit_method_ambiguous              (428-436)
 *     test_match_video_auto_matcher_instance                   (438-450)
 *     test_match_video_bad_type                                 (452-457)
 *     test_match_video_bad_method_type                           (459-464)
 *     test_match_video_bad_method_string                          (466-471)
 *     test_match_video_image_sequence                              (559-570, programmatic)
 *     test_match_video_foreign_instance / _by_path / _no_match
 *        (343-371, reconstructed programmatically without slp_typical)
 *
 * Notes on the port:
 * - Python `Labels.match(other, video=..., skeleton=..., track=...)` -> JS
 *   `labels.match(other, { video, skeleton, track })`, and is ASYNC (await).
 * - Map direction is keyed by OTHER's objects -> SELF's objects | null. Python
 *   `video_pred in result.video_map` -> JS `result.videoMap.has(video_pred)`.
 * - Identity (`is`) assertions -> `toBe(...)`.
 * - matchVideo() is ASYNC and RAISES on ambiguity (>1 candidate); method
 *   validation runs BEFORE the identity short-circuit; AUTO uses a 2-tier
 *   file-identity-then-basename cascade.
 * - Tests requiring real .slp / HDF5 fixtures are reconstructed programmatically
 *   where the behavior is path/basename-driven; one HDF5-dataset case is skipped.
 */
import { describe, it, expect } from "../bun-test";
import { Track } from "../../src/model/instance.js";
import { Skeleton } from "../../src/model/skeleton.js";
import { Video } from "../../src/model/video.js";
import { Labels } from "../../src/model/labels.js";
import {
  MatchResult,
  SkeletonMatcher,
  SkeletonMatchMethod,
  TrackMatcher,
  TrackMatchMethod,
  VideoMatcher,
  VideoMatchMethod,
} from "../../src/model/matching.js";

describe("Labels.match (read-only)", () => {
  // test_labels_match_basic (test_labels.py:4601-4633)
  it("matches video by basename and skeleton by structure", async () => {
    const skeletonGt = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/experiment/video.mp4",
      openBackend: false,
    });
    const gtLabels = new Labels({ videos: [videoGt], skeletons: [skeletonGt] });

    const skeletonPred = new Skeleton({ nodes: ["head", "tail"] });
    const videoPred = new Video({
      filename: "/output/model/video.mp4",
      openBackend: false,
    });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeletonPred],
    });

    const result = await gtLabels.match(predLabels);

    expect(result.videoMap.size).toBe(1);
    expect(result.videoMap.has(videoPred)).toBe(true);
    expect(result.videoMap.get(videoPred)).toBe(videoGt);

    expect(result.skeletonMap.size).toBe(1);
    expect(result.skeletonMap.has(skeletonPred)).toBe(true);
    expect(result.skeletonMap.get(skeletonPred)).toBe(skeletonGt);

    expect(result.allVideosMatched).toBe(true);
    expect(result.allSkeletonsMatched).toBe(true);
    expect(result.nVideosMatched).toBe(1);
    expect(result.nSkeletonsMatched).toBe(1);
    expect(result.unmatchedVideos.length).toBe(0);
    expect(result.unmatchedSkeletons.length).toBe(0);
  });

  // test_labels_match_unmatched_videos (test_labels.py:4635-4653)
  it("stores null in the video map on no-match (and is side-effect free)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/video_a.mp4",
      openBackend: false,
    });
    const videoPred = new Video({
      filename: "/data/video_b.mp4",
      openBackend: false,
    });

    const gtLabels = new Labels({ videos: [videoGt], skeletons: [skeleton] });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels);

    expect(result.allVideosMatched).toBe(false);
    expect(result.unmatchedVideos.length).toBe(1);
    expect(result.videoMap.get(videoPred)).toBe(null);
    expect(result.allSkeletonsMatched).toBe(true);

    // No mutation of either dataset.
    expect(gtLabels.videos).toEqual([videoGt]);
    expect(predLabels.videos).toEqual([videoPred]);
    expect(gtLabels.skeletons).toEqual([skeleton]);
    expect(predLabels.skeletons).toEqual([skeleton]);
  });

  // test_labels_match_multiple_videos (test_labels.py:4655-4681)
  it("matches multiple videos (2 match, 1 doesn't), preserving other order", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt1 = new Video({
      filename: "/data/video1.mp4",
      openBackend: false,
    });
    const videoGt2 = new Video({
      filename: "/data/video2.mp4",
      openBackend: false,
    });
    const gtLabels = new Labels({
      videos: [videoGt1, videoGt2],
      skeletons: [skeleton],
    });

    const videoPred1 = new Video({
      filename: "/output/video1.mp4",
      openBackend: false,
    });
    const videoPred2 = new Video({
      filename: "/output/video2.mp4",
      openBackend: false,
    });
    const videoPred3 = new Video({
      filename: "/output/video3.mp4",
      openBackend: false,
    });
    const predLabels = new Labels({
      videos: [videoPred1, videoPred2, videoPred3],
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels);

    expect(result.nVideosMatched).toBe(2);
    expect(result.unmatchedVideos.length).toBe(1);
    expect(result.unmatchedVideos.includes(videoPred3)).toBe(true);
    expect(result.videoMap.get(videoPred1)).toBe(videoGt1);
    expect(result.videoMap.get(videoPred2)).toBe(videoGt2);
    expect(result.videoMap.get(videoPred3)).toBe(null);
  });

  // test_labels_match_track_matching (test_labels.py:4683-4699)
  it("matches tracks by name (different object, same name)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const video = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const trackGt = new Track("animal_1");
    const trackPred = new Track("animal_1");

    const gtLabels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackGt],
    });
    const predLabels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackPred],
    });

    // Opt in to name-based matching: these are two distinct Track objects with
    // the same name, which only coalesce under track="name" (the identity
    // default would keep them as separate tracks).
    const result = await gtLabels.match(predLabels, { track: "name" });

    expect(result.allTracksMatched).toBe(true);
    expect(result.trackMap.get(trackPred)).toBe(trackGt);
  });

  // test_match_default_keeps_same_named_distinct_tracks_unmatched (PR #449)
  it("default (identity) does not match distinct same-named tracks", async () => {
    // Locks match()/merge() consistency: both resolve `track=null` to a bare
    // `TrackMatcher()` and therefore share the identity default. `track="name"`
    // is the opt-in that matches by name.
    const skeleton = new Skeleton({ nodes: ["A"] });
    const video = new Video({ filename: "v.mp4", openBackend: false });

    const trackGt = new Track("track_0");
    const trackPred = new Track("track_0"); // Same name, distinct object.

    const gtLabels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackGt],
    });
    const predLabels = new Labels({
      videos: [video],
      skeletons: [skeleton],
      tracks: [trackPred],
    });

    // Default identity: distinct objects do not match (track maps to null).
    const result = await gtLabels.match(predLabels);
    expect(result.trackMap.get(trackPred)).not.toBe(trackGt);
    expect(result.trackMap.get(trackPred)).toBe(null);

    // Opt-in name matching: they match.
    const resultNamed = await gtLabels.match(predLabels, { track: "name" });
    expect(resultNamed.trackMap.get(trackPred)).toBe(trackGt);
  });

  // test_labels_match_string_method (test_labels.py:4701-4715)
  it("accepts string method arguments", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const videoPred = new Video({
      filename: "/output/video.mp4",
      openBackend: false,
    });

    const gtLabels = new Labels({ videos: [videoGt], skeletons: [skeleton] });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels, {
      video: "basename",
      skeleton: "structure",
    });

    expect(result.allVideosMatched).toBe(true);
    expect(result.allSkeletonsMatched).toBe(true);
  });

  // test_labels_match_custom_matchers (test_labels.py:4717-4736)
  it("supports SUBSET skeleton matching (gt subset of pred)", async () => {
    // match() is called with (self_skel, other_skel) = (gt, pred); SUBSET checks
    // gt is a subset of pred, so gt nodes must be a subset of pred nodes.
    const skeletonGt = new Skeleton({ nodes: ["head", "tail"] });
    const skeletonPred = new Skeleton({ nodes: ["head", "body", "tail"] });
    const video = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });

    const gtLabels = new Labels({ videos: [video], skeletons: [skeletonGt] });
    const predLabels = new Labels({
      videos: [video],
      skeletons: [skeletonPred],
    });

    const resultStruct = await gtLabels.match(predLabels, {
      skeleton: "structure",
    });
    expect(resultStruct.allSkeletonsMatched).toBe(false);

    const resultSubset = await gtLabels.match(predLabels, {
      skeleton: "subset",
    });
    expect(resultSubset.allSkeletonsMatched).toBe(true);
  });

  // test_labels_match_empty (test_labels.py:4738-4751)
  it("empty Labels -> empty maps, vacuously all-matched", async () => {
    const gtLabels = new Labels();
    const predLabels = new Labels();

    const result = await gtLabels.match(predLabels);

    expect(result.videoMap.size).toBe(0);
    expect(result.skeletonMap.size).toBe(0);
    expect(result.trackMap.size).toBe(0);
    expect(result.allVideosMatched).toBe(true);
    expect(result.allSkeletonsMatched).toBe(true);
    expect(result.allTracksMatched).toBe(true);
  });

  // test_labels_match_summary (test_labels.py:4753-4768)
  it("summary() reports matched counts and unmatched videos", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const videoPred = new Video({
      filename: "/output/different.mp4",
      openBackend: false,
    });

    const gtLabels = new Labels({ videos: [videoGt], skeletons: [skeleton] });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels);

    const summary = result.summary();
    expect(summary).toContain("Videos: 0/1 matched");
    expect(summary).toContain("Skeletons: 1/1 matched");
    expect(summary).toContain("Unmatched videos:");
  });

  // test_labels_match_result_import (test_labels.py:4770-4782)
  it("MatchResult is constructible with dict-typed maps", () => {
    const result = new MatchResult();
    expect(result.videoMap instanceof Map).toBe(true);
    expect(result.skeletonMap instanceof Map).toBe(true);
    expect(result.trackMap instanceof Map).toBe(true);
  });

  // test_labels_match_with_matcher_objects (test_labels.py:4784-4819)
  it("accepts Matcher objects (not strings)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const videoPred = new Video({
      filename: "/output/video.mp4",
      openBackend: false,
    });
    const trackGt = new Track("animal_1");
    const trackPred = new Track("animal_1");

    const gtLabels = new Labels({
      videos: [videoGt],
      skeletons: [skeleton],
      tracks: [trackGt],
    });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeleton],
      tracks: [trackPred],
    });

    const result = await gtLabels.match(predLabels, {
      skeleton: new SkeletonMatcher(SkeletonMatchMethod.STRUCTURE),
      video: new VideoMatcher(VideoMatchMethod.BASENAME),
      track: new TrackMatcher(TrackMatchMethod.NAME),
    });

    expect(result.allVideosMatched).toBe(true);
    expect(result.allSkeletonsMatched).toBe(true);
    expect(result.allTracksMatched).toBe(true);
  });

  // test_labels_match_summary_many_unmatched (test_labels.py:4821-4844)
  it("summary() truncates unmatched videos at 5 with '... and N more'", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/video_gt.mp4",
      openBackend: false,
    });
    const gtLabels = new Labels({ videos: [videoGt], skeletons: [skeleton] });

    const predVideos = Array.from(
      { length: 7 },
      (_, i) =>
        new Video({ filename: `/output/pred_${i}.mp4`, openBackend: false }),
    );
    const predLabels = new Labels({
      videos: predVideos,
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels);

    expect(result.unmatchedVideos.length).toBe(7);
    const summary = result.summary();
    expect(summary).toContain("Videos: 0/7 matched");
    expect(summary).toContain("Unmatched videos:");
    expect(summary).toContain("... and 2 more"); // 7 - 5 = 2
  });

  // test_labels_match_summary_image_video (test_labels.py:4846-4878)
  it("summary() handles an ImageVideo (list filename)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const gtLabels = new Labels({ videos: [videoGt], skeletons: [skeleton] });

    const videoPred = new Video({
      filename: ["/output/frame001.png", "/output/frame002.png"],
      openBackend: false,
    });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels);

    expect(result.unmatchedVideos.length).toBe(1);
    const summary = result.summary();
    expect(summary).toContain("Unmatched videos:");
    expect(summary).toContain("/output/frame001.png"); // first filename in list
  });

  // Mirror of merge video-matching as read-only: AUTO uses findMatch, NOT a
  // simplified pairwise check. Same shape + different basename -> NO match
  // (shape is rejection-only). (ARCH §7.1; PY:test_matching.py:473-494.)
  it("AUTO video match is rejection-only on shape (same shape, diff basename -> null)", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt = new Video({
      filename: "/data/video_a.mp4",
      openBackend: false,
    });
    videoGt.backendMetadata = { shape: [100, 480, 640, 3] };
    const videoPred = new Video({
      filename: "/data/video_b.mp4",
      openBackend: false,
    });
    videoPred.backendMetadata = { shape: [100, 480, 640, 3] };

    const gtLabels = new Labels({ videos: [videoGt], skeletons: [skeleton] });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels);
    expect(result.videoMap.get(videoPred)).toBe(null);
  });

  // Mirror: AUTO definitive full-path match wins over a same-basename candidate.
  it("AUTO video match via findMatch resolves exact full path over basename", async () => {
    const skeleton = new Skeleton({ nodes: ["head", "tail"] });
    const videoGt1 = new Video({
      filename: "/data/recordings/video.mp4",
      openBackend: false,
    });
    const videoGt2 = new Video({
      filename: "/data/other/video.mp4",
      openBackend: false,
    });
    const gtLabels = new Labels({
      videos: [videoGt2, videoGt1],
      skeletons: [skeleton],
    });

    const videoPred = new Video({
      filename: "/data/recordings/video.mp4",
      openBackend: false,
    });
    const predLabels = new Labels({
      videos: [videoPred],
      skeletons: [skeleton],
    });

    const result = await gtLabels.match(predLabels);
    expect(result.videoMap.get(videoPred)).toBe(videoGt1);
  });
});

describe("Labels.matchVideo", () => {
  // test_match_video_foreign_instance (test_labels.py:343-354, programmatic)
  it("resolves a foreign Video with the same path to the canonical, and identity arg unchanged", async () => {
    const canonical = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const labels = new Labels({ videos: [canonical] });

    const foreign = new Video({
      filename: canonical.filename,
      openBackend: false,
    });
    expect(foreign).not.toBe(canonical);
    expect(await labels.matchVideo(foreign)).toBe(canonical);

    // An identity argument is returned unchanged.
    expect(await labels.matchVideo(canonical)).toBe(canonical);
  });

  // test_match_video_by_path (test_labels.py:357-363, programmatic)
  it("resolves a str filename to the canonical Video", async () => {
    const canonical = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const labels = new Labels({ videos: [canonical] });
    expect(await labels.matchVideo("/data/video.mp4")).toBe(canonical);
  });

  // test_match_video_no_match (test_labels.py:366-370, programmatic)
  it("returns null when no video matches", async () => {
    const canonical = new Video({
      filename: "/data/video.mp4",
      openBackend: false,
    });
    const labels = new Labels({ videos: [canonical] });
    expect(await labels.matchVideo("not_in_project.mp4")).toBe(null);
    expect(
      await labels.matchVideo(
        new Video({ filename: "not_in_project.mp4", openBackend: false }),
      ),
    ).toBe(null);
  });

  // test_match_video_basename_fallback (test_labels.py:373-380)
  it("falls back to basename matching for relocated files", async () => {
    const video = new Video({
      filename: "/original/dir/video.mp4",
      openBackend: false,
    });
    const labels = new Labels({ videos: [video] });
    expect(await labels.matchVideo("/new/location/video.mp4")).toBe(video);
  });

  // test_match_video_definitive_over_basename (test_labels.py:382-391)
  it("exact path match wins over a shared basename (no false ambiguity)", async () => {
    const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
    const v2 = new Video({ filename: "/dir2/vid.mp4", openBackend: false });
    const labels = new Labels({ videos: [v1, v2] });

    expect(await labels.matchVideo("/dir1/vid.mp4")).toBe(v1);
    expect(await labels.matchVideo("/dir2/vid.mp4")).toBe(v2);
  });

  // test_match_video_ambiguous_raises (test_labels.py:393-401)
  it("raises 'Ambiguous video match' when multiple videos match by basename", async () => {
    const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
    const v2 = new Video({ filename: "/dir2/vid.mp4", openBackend: false });
    const labels = new Labels({ videos: [v1, v2] });

    await expect(labels.matchVideo("/elsewhere/vid.mp4")).rejects.toThrow(
      /Ambiguous video match/,
    );
  });

  // test_match_video_ambiguous_definitive_raises (test_labels.py:403-411)
  it("raises 'by file identity' when multiple videos share the exact same path", async () => {
    const v1 = new Video({ filename: "/dir/vid.mp4", openBackend: false });
    const v2 = new Video({ filename: "/dir/vid.mp4", openBackend: false });
    const labels = new Labels({ videos: [v1, v2] });

    await expect(labels.matchVideo("/dir/vid.mp4")).rejects.toThrow(
      /by file identity/,
    );
  });

  // test_match_video_explicit_method (test_labels.py:413-426)
  it("accepts an explicit method string or VideoMatcher", async () => {
    const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
    const v2 = new Video({ filename: "/dir2/other.mp4", openBackend: false });
    const labels = new Labels({ videos: [v1, v2] });

    expect(await labels.matchVideo("/x/vid.mp4", "basename")).toBe(v1);
    // Path method (lenient by default) also matches by basename.
    expect(await labels.matchVideo("/x/other.mp4", "path")).toBe(v2);
    const matcher = new VideoMatcher(VideoMatchMethod.BASENAME);
    expect(await labels.matchVideo("/x/vid.mp4", matcher)).toBe(v1);
  });

  // test_match_video_explicit_method_ambiguous (test_labels.py:428-436)
  it("explicit-method matching raises on ambiguous matches", async () => {
    const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
    const v2 = new Video({ filename: "/dir2/vid.mp4", openBackend: false });
    const labels = new Labels({ videos: [v1, v2] });

    await expect(labels.matchVideo("/x/vid.mp4", "basename")).rejects.toThrow(
      /Ambiguous video match/,
    );
  });

  // test_match_video_auto_matcher_instance (test_labels.py:438-450)
  it("an AUTO VideoMatcher instance uses the same tiered cascade as method='auto'", async () => {
    const v1 = new Video({ filename: "/dir1/vid.mp4", openBackend: false });
    const v2 = new Video({ filename: "/dir2/vid.mp4", openBackend: false });
    const labels = new Labels({ videos: [v1, v2] });

    const matcher = new VideoMatcher(VideoMatchMethod.AUTO);
    expect(await labels.matchVideo("/dir1/vid.mp4", matcher)).toBe(v1);
    expect(await labels.matchVideo("/dir1/vid.mp4", "auto")).toBe(v1);
  });

  // test_match_video_bad_type (test_labels.py:452-457)
  it("raises TypeError for unsupported argument types", async () => {
    const labels = new Labels({
      videos: [new Video({ filename: "vid.mp4", openBackend: false })],
    });
    await expect(
      labels.matchVideo(42 as unknown as Video),
    ).rejects.toBeInstanceOf(TypeError);
  });

  // test_match_video_bad_method_type (test_labels.py:459-464)
  it("raises TypeError (mentioning method) for an unsupported method argument", async () => {
    const labels = new Labels({
      videos: [new Video({ filename: "vid.mp4", openBackend: false })],
    });
    await expect(
      labels.matchVideo("vid.mp4", 42 as unknown as string),
    ).rejects.toThrow(/method/);
  });

  // test_match_video_bad_method_string (test_labels.py:466-471)
  it("raises (ValueError) for an unrecognized method string", async () => {
    const labels = new Labels({
      videos: [new Video({ filename: "vid.mp4", openBackend: false })],
    });
    await expect(
      labels.matchVideo("vid.mp4", "not_a_method"),
    ).rejects.toThrow();
  });

  // Method validation runs BEFORE the identity short-circuit: passing the
  // canonical Video itself with a bad method still throws (does not short-circuit
  // to return it). (ARCH §7.2.)
  it("validates the method BEFORE the identity short-circuit", async () => {
    const canonical = new Video({ filename: "vid.mp4", openBackend: false });
    const labels = new Labels({ videos: [canonical] });
    await expect(
      labels.matchVideo(canonical, "not_a_method"),
    ).rejects.toThrow();
  });

  // test_match_video_image_sequence (test_labels.py:559-570)
  it("resolves an image-sequence video by full filename list; partial overlap is not an auto match", async () => {
    const framePaths = ["/data/frames/img0.png", "/data/frames/img1.png"];
    const video = new Video({ filename: [...framePaths], openBackend: false });
    const labels = new Labels({ videos: [video] });

    const foreign = new Video({
      filename: [...framePaths],
      openBackend: false,
    });
    expect(await labels.matchVideo(foreign)).toBe(video);

    // A partially overlapping sequence is not an "auto" match.
    const partial = new Video({
      filename: [framePaths[0]],
      openBackend: false,
    });
    expect(await labels.matchVideo(partial)).toBe(null);
  });

  // test_match_video_hdf5_pkg (test_labels.py:473-498): requires loading a real
  // .pkg.slp file and an HDF5 backend to resolve on dataset identity.
  it.skip("[fixture] resolves embedded HDF5 videos in a .pkg.slp (needs real HDF5 backend)", () => {
    // Skipped: depends on slp_minimal_pkg fixture + HDF5Video backend with a
    // .dataset attribute, which the programmatic-only port cannot construct.
  });
});
