/* @vitest-environment node */
/**
 * Ports of test_matching.py::TestTrackMatcher (GROUP 3): NAME vs IDENTITY.
 *
 * Ground truth: C:/Users/Talmo/code/sleap-io/tests/model/test_matching.py
 * (pinned @ 054cce39f), lines 179-197.
 *
 * Key parity point: TrackMatchMethod.IDENTITY uses object identity (Python `is`
 * -> JS `===`), so two distinct Track objects with the SAME name do NOT match
 * under IDENTITY, but DO match under NAME. The direct Track.matches coverage and
 * the "Unknown matching method" throw back instance.py:340-356.
 */
import { describe, it, expect } from "vitest";
import { Track } from "../../src/model/instance.js";
import { TrackMatcher, TrackMatchMethod } from "../../src/model/matching.js";

describe("TrackMatcher", () => {
  // test_matching.py:179-187 (test_name_match).
  it("name: same name (different object) matches; different name does not", () => {
    const track1 = new Track("mouse1");
    const track2 = new Track("mouse1"); // Same name, different object.
    const track3 = new Track("mouse2");

    const matcher = new TrackMatcher(TrackMatchMethod.NAME);
    expect(matcher.match(track1, track2)).toBe(true); // Same name.
    expect(matcher.match(track1, track3)).toBe(false); // Different names.
  });

  // test_matching.py:189-197 (test_identity_match).
  it("identity: same name (different object) does NOT match; same object does", () => {
    const track1 = new Track("mouse1");
    const track2 = new Track("mouse1"); // Same name, different object.
    const track3 = track1; // Same object (alias).

    const matcher = new TrackMatcher(TrackMatchMethod.IDENTITY);
    // Different objects despite same name -> no match (Python `is`).
    expect(matcher.match(track1, track2)).toBe(false);
    // Same object -> match.
    expect(matcher.match(track1, track3)).toBe(true);
  });
});

describe("Track.matches (direct)", () => {
  // instance.py:340-356 — value vs identity branches and the default.
  it('"name" matches by name value, ignoring object identity', () => {
    const a = new Track("mouse1");
    const b = new Track("mouse1");
    const c = new Track("mouse2");
    expect(a.matches(b, "name")).toBe(true);
    expect(a.matches(c, "name")).toBe(false);
    // Default method is "name".
    expect(a.matches(b)).toBe(true);
  });

  it('"identity" matches only on object identity', () => {
    const a = new Track("mouse1");
    const b = new Track("mouse1");
    expect(a.matches(b, "identity")).toBe(false);
    expect(a.matches(a, "identity")).toBe(true);
  });

  it("throws on an unknown matching method", () => {
    const a = new Track("mouse1");
    const b = new Track("mouse1");
    expect(() => a.matches(b, "bogus")).toThrow(/Unknown matching method/);
  });

  it('default Track name is "" and "" === "" matches under NAME', () => {
    // Track constructor default name is "" (instance.py:330-ish / TS Track).
    const a = new Track();
    const b = new Track();
    expect(a.name).toBe("");
    const matcher = new TrackMatcher(TrackMatchMethod.NAME);
    expect(matcher.match(a, b)).toBe(true);
  });
});
