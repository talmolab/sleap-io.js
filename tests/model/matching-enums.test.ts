/**
 * Port of test_matching.py GROUP 6 (TestEnums, lines 297-324) plus the
 * "unknown enum string at construction throws" behavior implied by the
 * invalid-method tests / ARCH §3.1.
 *
 * Python uses `class X(str, Enum)`, so each member compares equal to its
 * lowercase string value (`SkeletonMatchMethod.EXACT == "exact"`). The TS port
 * models each enum as a `const` object whose values ARE those strings, so the
 * faithful assertion is `Member === "string"`.
 *
 * Python ref: C:/Users/Talmo/code/sleap-io/tests/model/test_matching.py
 */
import { describe, it, expect } from "../bun-test";
import {
  SkeletonMatchMethod,
  InstanceMatchMethod,
  TrackMatchMethod,
  VideoMatchMethod,
  FrameStrategy,
  ErrorMode,
  toSkeletonMatchMethod,
  toInstanceMatchMethod,
  toTrackMatchMethod,
  toVideoMatchMethod,
  toErrorMode,
} from "../../src/model/matching.js";

describe("Enums string-equality (TestEnums)", () => {
  // test_skeleton_match_method (test_matching.py:300-305)
  it("SkeletonMatchMethod members equal their string values", () => {
    expect(SkeletonMatchMethod.EXACT).toBe("exact");
    expect(SkeletonMatchMethod.STRUCTURE).toBe("structure");
    expect(SkeletonMatchMethod.OVERLAP).toBe("overlap");
    expect(SkeletonMatchMethod.SUBSET).toBe("subset");
  });

  // test_instance_match_method (test_matching.py:307-311)
  it("InstanceMatchMethod members equal their string values", () => {
    expect(InstanceMatchMethod.SPATIAL).toBe("spatial");
    expect(InstanceMatchMethod.IDENTITY).toBe("identity");
    expect(InstanceMatchMethod.IOU).toBe("iou");
  });

  // test_frame_strategy (test_matching.py:313-318)
  it("FrameStrategy members equal their string values", () => {
    expect(FrameStrategy.AUTO).toBe("auto");
    expect(FrameStrategy.KEEP_ORIGINAL).toBe("keep_original");
    expect(FrameStrategy.KEEP_NEW).toBe("keep_new");
    expect(FrameStrategy.KEEP_BOTH).toBe("keep_both");
  });

  // test_error_mode (test_matching.py:320-324)
  it("ErrorMode members equal their string values", () => {
    expect(ErrorMode.CONTINUE).toBe("continue");
    expect(ErrorMode.STRICT).toBe("strict");
    expect(ErrorMode.WARN).toBe("warn");
  });

  // Additional enum values exercised elsewhere (finding-13 note after GROUP 6;
  // ARCH §3.1). TrackMatchMethod NAME/IDENTITY and VideoMatchMethod values.
  it("TrackMatchMethod members equal their string values", () => {
    expect(TrackMatchMethod.NAME).toBe("name");
    expect(TrackMatchMethod.IDENTITY).toBe("identity");
  });

  it("VideoMatchMethod members equal their string values", () => {
    expect(VideoMatchMethod.PATH).toBe("path");
    expect(VideoMatchMethod.BASENAME).toBe("basename");
    expect(VideoMatchMethod.CONTENT).toBe("content");
    expect(VideoMatchMethod.AUTO).toBe("auto");
    expect(VideoMatchMethod.SHAPE).toBe("shape");
  });
});

describe("Enum coercion (string -> enum) throws on unknown", () => {
  // ARCH §3.1 / matching.py attrs converter `X(x)` raises ValueError on bad
  // strings. The TS coerce* helpers mirror this by throwing.
  it("coerces valid strings to the enum member", () => {
    expect(toSkeletonMatchMethod("structure")).toBe(
      SkeletonMatchMethod.STRUCTURE,
    );
    expect(toInstanceMatchMethod("iou")).toBe(InstanceMatchMethod.IOU);
    expect(toTrackMatchMethod("name")).toBe(TrackMatchMethod.NAME);
    expect(toVideoMatchMethod("auto")).toBe(VideoMatchMethod.AUTO);
    expect(toErrorMode("strict")).toBe(ErrorMode.STRICT);
  });

  it("throws on an unknown enum string", () => {
    expect(() => toSkeletonMatchMethod("INVALID_METHOD")).toThrow();
    expect(() => toInstanceMatchMethod("nope")).toThrow();
    expect(() => toTrackMatchMethod("nope")).toThrow();
    expect(() => toVideoMatchMethod("nope")).toThrow();
    expect(() => toErrorMode("nope")).toThrow();
  });
});
