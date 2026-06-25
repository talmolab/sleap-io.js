import { describe, it, expect } from "../bun-test";
import { StreamingH5File } from "../../src/codecs/slp/h5-streaming.js";
import { RemoteIOError } from "../../src/io/remote.js";

/**
 * The streaming worker path resolves the URL scheme on the MAIN thread before
 * the worker fetch (the worker can't import the scheme gate). These tests
 * stub the worker transport so nothing hits the network: a fake `send` records
 * the `openUrl` payload and `worker` is replaced with a no-op so construction +
 * close never spin up a real Web Worker.
 */
function stubbedStreamingFile(): {
  file: StreamingH5File;
  openUrlPayloads: Array<Record<string, unknown>>;
} {
  const file = new StreamingH5File();
  const openUrlPayloads: Array<Record<string, unknown>> = [];
  // Replace the real worker (created in the ctor) so terminate() is a no-op and
  // no CDN import ever runs.
  (file as unknown as { worker: { terminate: () => void } }).worker = {
    terminate: () => {},
  };
  // Stub the private message transport: resolve init/openUrl without a worker.
  (
    file as unknown as {
      send: (
        type: string,
        payload?: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    }
  ).send = async (type, payload) => {
    if (type === "openUrl" && payload) openUrlPayloads.push(payload);
    return { success: true, keys: [] };
  };
  return { file, openUrlPayloads };
}

describe("StreamingH5File.open scheme resolution", () => {
  it("resolves gs:// to storage.googleapis.com before the worker fetch", async () => {
    const { file, openUrlPayloads } = stubbedStreamingFile();
    await file.open("gs://bucket/path/to/obj.slp");
    expect(openUrlPayloads).toHaveLength(1);
    expect(openUrlPayloads[0].url).toBe(
      "https://storage.googleapis.com/bucket/path/to/obj.slp",
    );
  });

  it("passes an http(s) URL through unchanged", async () => {
    const { file, openUrlPayloads } = stubbedStreamingFile();
    await file.open("https://example.com/data.slp");
    expect(openUrlPayloads[0].url).toBe("https://example.com/data.slp");
  });

  it("fails fast with a redacted RemoteIOError for s3:// (no worker fetch)", async () => {
    const { file, openUrlPayloads } = stubbedStreamingFile();
    let err: unknown;
    try {
      await file.open("s3://bucket/obj.slp");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain("presigned https");
    // The worker was never asked to open anything.
    expect(openUrlPayloads).toHaveLength(0);
  });

  it("fails fast with a redacted RemoteIOError for Google Drive URLs", async () => {
    const { file, openUrlPayloads } = stubbedStreamingFile();
    let err: unknown;
    try {
      await file.open("https://drive.google.com/file/d/ABC/view?token=SECRET");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain("not supported");
    expect((err as RemoteIOError).url).not.toContain("SECRET");
    expect(openUrlPayloads).toHaveLength(0);
  });
});
