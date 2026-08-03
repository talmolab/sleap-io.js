/**
 * Unit tests for the libav H.264 fallback decoder's gate + configuration
 * (`src/video/libav-h264-decoder.ts`). The actual WASM decode is browser-only and
 * was validated byte-exact vs native in the spike; here we lock down the
 * zero-regression gate and the config seam.
 */
import { describe, it, expect } from "../bun-test";
import {
  shouldUseLibavH264,
  configureLibavDecoder,
  isLibavDecoderConfigured,
  ensureNativeH264Probe,
  nativeH264DecodableSync,
  overrideNativeH264Decodable,
} from "../../src/video/libav-h264-decoder.js";

describe("shouldUseLibavH264 gate (anti-regression)", () => {
  it("engages only for H.264 when configured AND native cannot decode", () => {
    expect(shouldUseLibavH264("avc", true, false)).toBe(true);
  });

  it("does NOT engage when native CAN decode — no macOS/Windows regression", () => {
    expect(shouldUseLibavH264("avc", true, true)).toBe(false);
  });

  it("does NOT engage before the probe resolves (null) — never preempt native", () => {
    expect(shouldUseLibavH264("avc", true, null)).toBe(false);
  });

  it("does NOT engage when unconfigured", () => {
    expect(shouldUseLibavH264("avc", false, false)).toBe(false);
  });

  it("does NOT engage for non-H.264 codecs", () => {
    expect(shouldUseLibavH264("vp8", true, false)).toBe(false);
    expect(shouldUseLibavH264("hevc", true, false)).toBe(false);
    expect(shouldUseLibavH264("av1", true, false)).toBe(false);
  });
});

describe("configuration seam", () => {
  it("starts unconfigured", () => {
    expect(isLibavDecoderConfigured()).toBe(false);
  });

  it("becomes configured after configureLibavDecoder", () => {
    configureLibavDecoder({ wasmBaseUrl: "/decoders/libav-h264/" });
    expect(isLibavDecoderConfigured()).toBe(true);
  });
});

describe("native-capability probe", () => {
  it("reports native H.264 unavailable when WebCodecs is absent (bun/node env)", async () => {
    expect(typeof (globalThis as { VideoDecoder?: unknown }).VideoDecoder).toBe(
      "undefined",
    );
    const ok = await ensureNativeH264Probe();
    expect(ok).toBe(false);
    expect(nativeH264DecodableSync()).toBe(false);
  });
});

describe("native override (force fallback for testing)", () => {
  it("forces native-unavailable (fallback engages) then clears back to the probe", () => {
    overrideNativeH264Decodable(true); // pretend native works
    expect(nativeH264DecodableSync()).toBe(true);
    overrideNativeH264Decodable(false); // force fallback
    expect(nativeH264DecodableSync()).toBe(false);
    overrideNativeH264Decodable(undefined); // clear → real probe value
    expect(nativeH264DecodableSync()).toBe(false);
  });
});
