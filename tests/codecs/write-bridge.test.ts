/**
 * RangeSink / B-seam write bridge (write-B-seam spike, Task 3).
 *
 * Mirrors `tests/codecs/h5-range-source.test.ts` for the read-side
 * `serviceRangeBridge`. The full writable-Emscripten-device path (Worker +
 * `Atomics.wait`) is browser/Worker-gated and unreachable in the headless test
 * runner — these tests cover the main-thread halves that ARE reachable
 * without a Worker: `serviceWriteBridge` and `serviceTruncateBridge`, driven
 * over a real `SharedArrayBuffer`.
 */
import { describe, it, expect } from "../bun-test";
import {
  serviceWriteBridge,
  serviceTruncateBridge,
  type RangeSink,
} from "../../src/codecs/slp/h5-streaming.js";

describe("RangeSink write bridge (write-B-seam spike)", () => {
  // Control layout: Int32[0] = STATE (1 = REQUEST pending, 2 = READY),
  // Int32[1] = RESULT (0 = ok, -1 = error). A data area follows the control
  // slots (mirrors serviceRangeBridge's RETLEN slot, repurposed as RESULT).
  const CONTROL_SLOTS = 8;
  const DATA_BYTES = 64;
  function makeBridge() {
    const sab = new SharedArrayBuffer(CONTROL_SLOTS * 4 + DATA_BYTES);
    return {
      control: new Int32Array(sab, 0, CONTROL_SLOTS),
      dataArea: new Uint8Array(sab, CONTROL_SLOTS * 4),
    };
  }

  function makeFakeSink() {
    const writes: Array<{ offset: number; bytes: Uint8Array }> = [];
    const truncations: number[] = [];
    const sink: RangeSink = {
      writeAt: async (offset, bytes) => {
        // Byte-copy: `bytes` is a live subarray view into the shared data
        // area, which callers may reuse/overwrite on the next request.
        writes.push({ offset, bytes: Uint8Array.from(bytes) });
      },
      readAt: async () => new Uint8Array(),
      truncate: async (length) => {
        truncations.push(length);
      },
      close: async () => {},
    };
    return { sink, writes, truncations };
  }

  describe("serviceWriteBridge", () => {
    it("copies bytes to the sink and publishes RESULT=0 then READY", async () => {
      const { control, dataArea } = makeBridge();
      const { sink, writes } = makeFakeSink();
      control[0] = 1; // REQUEST pending
      dataArea.set([1, 2, 3, 4, 5], 0);

      await serviceWriteBridge(control, dataArea, sink, 100, 5);

      expect(writes.length).toBe(1);
      expect(writes[0].offset).toBe(100);
      expect(Array.from(writes[0].bytes)).toEqual([1, 2, 3, 4, 5]);
      expect(control[1]).toBe(0); // RESULT = ok
      expect(control[0]).toBe(2); // READY
    });

    it("records a byte-exact copy, not a live view into the shared data area", async () => {
      const { control, dataArea } = makeBridge();
      const { sink, writes } = makeFakeSink();
      dataArea.set([9, 9, 9, 9], 0);

      await serviceWriteBridge(control, dataArea, sink, 0, 4);
      // Mutate the shared data area after the call returns. If the sink had
      // kept a live view (e.g. via `subarray` without copying), this would
      // corrupt the recorded write.
      dataArea.set([0, 0, 0, 0], 0);

      expect(Array.from(writes[0].bytes)).toEqual([9, 9, 9, 9]);
    });

    it("reads exactly `length` bytes from the data area starting at 0", async () => {
      const { control, dataArea } = makeBridge();
      const { sink, writes } = makeFakeSink();
      // Known pattern spanning more than the requested partial length.
      dataArea.set([10, 20, 30, 40, 50, 60], 0);

      await serviceWriteBridge(control, dataArea, sink, 0, 3);

      expect(Array.from(writes[0].bytes)).toEqual([10, 20, 30]);
    });

    it("signals RESULT=-1 + READY on sink write failure (worker unblocks, no hang)", async () => {
      const { control, dataArea } = makeBridge();
      control[0] = 1;
      const failingSink: RangeSink = {
        writeAt: async () => {
          throw new Error("disk write failed");
        },
        readAt: async () => new Uint8Array(),
        truncate: async () => {},
        close: async () => {},
      };
      const origError = console.error;
      console.error = () => {}; // silence the expected error log
      try {
        await serviceWriteBridge(control, dataArea, failingSink, 0, 8);
      } finally {
        console.error = origError;
      }

      expect(control[1]).toBe(-1); // RESULT = error
      expect(control[0]).toBe(2); // READY — the blocked Worker is woken
    });
  });

  describe("serviceTruncateBridge", () => {
    it("calls sink.truncate(length) and publishes RESULT=0 then READY", async () => {
      const { control } = makeBridge();
      const { sink, truncations } = makeFakeSink();
      control[0] = 1;

      await serviceTruncateBridge(control, sink, 42);

      expect(truncations).toEqual([42]);
      expect(control[1]).toBe(0); // RESULT = ok
      expect(control[0]).toBe(2); // READY
    });

    it("signals RESULT=-1 + READY on truncate failure (worker unblocks, no hang)", async () => {
      const { control } = makeBridge();
      const failingSink: RangeSink = {
        writeAt: async () => {},
        readAt: async () => new Uint8Array(),
        truncate: async () => {
          throw new Error("truncate failed");
        },
        close: async () => {},
      };
      const origError = console.error;
      console.error = () => {}; // silence the expected error log
      try {
        await serviceTruncateBridge(control, failingSink, 42);
      } finally {
        console.error = origError;
      }

      expect(control[1]).toBe(-1); // RESULT = error
      expect(control[0]).toBe(2); // READY — the blocked Worker is woken
    });
  });
});
