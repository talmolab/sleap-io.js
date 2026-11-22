/**
 * `readSlpStreaming` closes its file, and with it the worker, when the read
 * fails (issue #278).
 *
 * In a browser `loadSlp` opens videos by default, and `readSlpStreaming` keeps
 * the file open on success so the video backends can read frames from it. A
 * refused file (`SlpFormatError`) returns no Labels, so nothing can need the
 * file; leaving it open would leave one worker running per refused open.
 *
 * `readSlpStreaming` needs a Web Worker, so this file replaces the two worker
 * entry points of `h5-streaming` with a stand-in that serves the `/metadata`
 * attributes of a fixture and records whether it was closed. It is a separate
 * file because module mocks last for the whole test file.
 */
import { describe, it, expect, vi } from "./bun-test";
import { ready, File as H5File } from "h5wasm/node";
import { fileURLToPath } from "node:url";
import path from "node:path";

const slpDir = path.join(
  fileURLToPath(new URL("./data", import.meta.url)),
  "slp",
);

let closed = 0;
let attrsFor = "";

const real = await import("../src/codecs/slp/h5-streaming.js");
vi.mock("../src/codecs/slp/h5-streaming.js", () => ({
  ...real,
  isStreamingSupported: () => true,
  openH5Worker: async () => {
    await ready;
    const h5 = new H5File(path.join(slpDir, attrsFor), "r");
    const attrs: Record<string, unknown> = {};
    try {
      const raw = (h5.get("metadata") as unknown as { attrs: object }).attrs;
      for (const [key, attr] of Object.entries(raw)) {
        attrs[key] = { value: (attr as { value: unknown }).value };
      }
    } finally {
      h5.close();
    }
    return {
      getAttrs: async (p: string) => {
        if (p !== "metadata") throw new Error(`Path not found: ${p}`);
        return attrs;
      },
      close: async () => {
        closed++;
      },
    };
  },
}));

const { readSlpStreaming } = await import(
  "../src/codecs/slp/read-streaming.js"
);
const { SlpFormatError } = await import("../src/codecs/slp/format-check.js");

describe("readSlpStreaming closes the file when it refuses it", () => {
  for (const options of [
    { openVideos: true },
    { openVideos: false, lazyVideoMetadata: true },
    { openVideos: false },
    { openVideos: true, lazy: true },
  ]) {
    it(`with ${JSON.stringify(options)}`, async () => {
      closed = 0;
      attrsFor = "format4_stub.slp";
      let error: unknown;
      try {
        await readSlpStreaming("https://example.com/format4_stub.slp", options);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(SlpFormatError);
      expect((error as Error).message).toContain("SLP format 4.0");
      expect(closed).toBe(1);
    });
  }

  it("also closes it when the read fails for another reason", async () => {
    // The stand-in serves metadata only, so an old-layout file passes the
    // format check and fails at the next step.
    closed = 0;
    attrsFor = "format3_minimal.v2.slp";
    let error: unknown;
    try {
      await readSlpStreaming("https://example.com/format3_minimal.v2.slp", {
        openVideos: true,
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeDefined();
    expect(error).not.toBeInstanceOf(SlpFormatError);
    expect(closed).toBe(1);
  });
});
