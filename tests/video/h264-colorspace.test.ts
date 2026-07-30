/**
 * Unit tests for `src/video/h264-colorspace.ts` — deriving a WebCodecs
 * VideoColorSpaceInit from an H.264 SPS (or the SD/HD default when the stream
 * doesn't signal colour). Guards the fix for the WebKitGTK color shift (untagged
 * I420 frames get a wrong browser-default YUV→RGB conversion).
 */
import { describe, it, expect } from "../bun-test";
import {
  parseSpsColour,
  colorSpaceFromSps,
} from "../../src/video/h264-colorspace.js";

// Real High-profile SPS NAL extracted from the synthetic fixture's avcC. Includes
// emulation-prevention bytes (00 00 03) → also exercises stripEmulation.
const SPS_HIGH = new Uint8Array([
  103, 100, 0, 13, 172, 217, 65, 65, 251, 1, 16, 0, 0, 3, 0, 16, 0, 0, 3, 3, 0,
  241, 66, 153, 96,
]);

describe("colorSpaceFromSps defaults (no explicit colour)", () => {
  it("uses BT.601 (smpte170m), limited range for SD", () => {
    const cs = colorSpaceFromSps(null, { codedHeight: 480 });
    expect(cs.primaries).toBe("smpte170m");
    expect(cs.matrix).toBe("smpte170m");
    expect(cs.transfer).toBe("smpte170m");
    expect(cs.fullRange).toBe(false);
  });

  it("uses BT.709, limited range for HD", () => {
    const cs = colorSpaceFromSps(null, { codedHeight: 1080 });
    expect(cs.primaries).toBe("bt709");
    expect(cs.matrix).toBe("bt709");
    expect(cs.transfer).toBe("bt709");
    expect(cs.fullRange).toBe(false);
  });

  it("treats 576 as the SD/HD boundary", () => {
    expect(colorSpaceFromSps(null, { codedHeight: 576 }).matrix).toBe(
      "smpte170m",
    );
    expect(colorSpaceFromSps(null, { codedHeight: 577 }).matrix).toBe("bt709");
  });

  it("defaults codedHeight to HD when missing", () => {
    expect(colorSpaceFromSps(null, {}).matrix).toBe("bt709");
  });
});

describe("parseSpsColour", () => {
  it("parses a real High-profile SPS without throwing", () => {
    const c = parseSpsColour(SPS_HIGH);
    expect(c).not.toBeNull();
    expect(typeof c!.fullRange).toBe("boolean");
  });

  it("returns null for too-short input", () => {
    expect(parseSpsColour(new Uint8Array([1, 2]))).toBeNull();
    expect(parseSpsColour(new Uint8Array())).toBeNull();
  });

  it("yields a valid, fully-populated init from a real SPS", () => {
    const cs = colorSpaceFromSps(SPS_HIGH, { codedHeight: 240 });
    expect(typeof cs.fullRange).toBe("boolean");
    // Every field is set (either signalled or defaulted) so the browser never guesses.
    expect(cs.primaries).toBeDefined();
    expect(cs.transfer).toBeDefined();
    expect(cs.matrix).toBeDefined();
  });
});
