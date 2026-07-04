/**
 * RangeSource / B-seam range bridge (#193).
 *
 * The full lazy `RangeSource` path (Emscripten custom device + Worker +
 * `Atomics.wait`) is browser/Worker-gated and unreachable in the headless test
 * runner — it is verified end-to-end in the app. These tests cover the two
 * pieces that ARE reachable without a Worker: the `isRangeSource` type guard
 * and the main-thread `serviceRangeBridge` protocol (byte copy, RETLEN/READY
 * publication order, data-area clamping, EOF short reads, and error → 0 bytes),
 * driven over a real `SharedArrayBuffer`.
 */
import { describe, it, expect } from "../bun-test";
import {
  isRangeSource,
  serviceRangeBridge,
  type RangeSource,
} from "../../src/codecs/slp/h5-streaming.js";

describe("RangeSource (#193 B-seam range reader)", () => {
  describe("isRangeSource", () => {
    it("accepts a well-formed RangeSource", () => {
      const src: RangeSource = {
        size: 10,
        readRange: async () => new Uint8Array(),
      };
      expect(isRangeSource(src)).toBe(true);
    });

    it("rejects other source types and malformed shapes", () => {
      expect(isRangeSource("https://example.com/f.slp")).toBe(false);
      expect(isRangeSource(new Uint8Array(4))).toBe(false);
      expect(isRangeSource(new ArrayBuffer(4))).toBe(false);
      expect(isRangeSource(null)).toBe(false);
      expect(isRangeSource(undefined)).toBe(false);
      expect(isRangeSource({ size: 10 })).toBe(false); // no readRange
      expect(isRangeSource({ readRange: async () => new Uint8Array() })).toBe(
        false,
      ); // no size
      expect(isRangeSource({ size: "10", readRange: () => {} })).toBe(false); // wrong types
    });
  });

  describe("serviceRangeBridge protocol", () => {
    // Control layout: Int32[0] = STATE (1 = REQUEST pending, 2 = READY),
    // Int32[1] = RETLEN. A data area follows the control slots.
    const CONTROL_SLOTS = 8;
    const DATA_BYTES = 64;
    function makeBridge() {
      const sab = new SharedArrayBuffer(CONTROL_SLOTS * 4 + DATA_BYTES);
      return {
        control: new Int32Array(sab, 0, CONTROL_SLOTS),
        dataArea: new Uint8Array(sab, CONTROL_SLOTS * 4),
      };
    }

    it("copies bytes, publishes RETLEN then READY, and reads back correctly", async () => {
      const { control, dataArea } = makeBridge();
      control[0] = 1; // REQUEST pending
      const payload = Uint8Array.from([1, 2, 3, 4, 5]);
      let seenOffset = -1;
      let seenLength = -1;
      await serviceRangeBridge(
        control,
        dataArea,
        async (offset, length) => {
          seenOffset = offset;
          seenLength = length;
          return payload;
        },
        100,
        5,
      );
      expect(seenOffset).toBe(100);
      expect(seenLength).toBe(5);
      expect(control[0]).toBe(2); // READY
      expect(control[1]).toBe(5); // RETLEN
      // Worker-side read is dataArea.subarray(0, RETLEN).
      expect(Array.from(dataArea.subarray(0, control[1]))).toEqual([
        1, 2, 3, 4, 5,
      ]);
    });

    it("clamps the returned length to the data-area size", async () => {
      const { control, dataArea } = makeBridge();
      const oversized = new Uint8Array(DATA_BYTES + 100).fill(7);
      await serviceRangeBridge(
        control,
        dataArea,
        async () => oversized,
        0,
        DATA_BYTES + 100,
      );
      expect(control[1]).toBe(DATA_BYTES); // capped to the data area
      expect(Array.from(dataArea.subarray(0, control[1]))).toEqual(
        Array(DATA_BYTES).fill(7),
      );
    });

    it("reports a short read at EOF (fewer bytes than requested)", async () => {
      const { control, dataArea } = makeBridge();
      await serviceRangeBridge(
        control,
        dataArea,
        async () => Uint8Array.from([9, 9]),
        0,
        16,
      );
      expect(control[0]).toBe(2);
      expect(control[1]).toBe(2); // actual bytes returned, not the requested 16
    });

    it("signals 0 bytes + READY on reader error (worker unblocks, no hang)", async () => {
      const { control, dataArea } = makeBridge();
      control[0] = 1;
      const origError = console.error;
      console.error = () => {}; // silence the expected error log
      try {
        await serviceRangeBridge(
          control,
          dataArea,
          async () => {
            throw new Error("native read failed");
          },
          0,
          8,
        );
      } finally {
        console.error = origError;
      }
      expect(control[0]).toBe(2); // READY — the blocked Worker is woken
      expect(control[1]).toBe(0); // 0 bytes -> clean EOF / short read
    });
  });
});
