import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSlp } from "../../src/io/main.js";
import { createVideoBackend } from "../../src/video/factory.js";
import { RemoteIOError, headOrRangeProbe } from "../../src/io/remote.js";

const FIXTURE = join(
  import.meta.dir,
  "..",
  "data",
  "slp",
  "minimal_instance.slp",
);
const SLP_BYTES = new Uint8Array(readFileSync(FIXTURE));

/** A 200 OK response delivering the fixture bytes via arrayBuffer. */
function slpOkResponse() {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    arrayBuffer: async () =>
      SLP_BYTES.buffer.slice(
        SLP_BYTES.byteOffset,
        SLP_BYTES.byteOffset + SLP_BYTES.byteLength,
      ),
  } as unknown as Response;
}

describe("SLP remote header threading", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("forwards Authorization header on the download fetch", async () => {
    const mock = vi.fn(async () => slpOkResponse());
    globalThis.fetch = mock as unknown as typeof fetch;

    const labels = await loadSlp("https://example.com/data.slp", {
      openVideos: false,
      h5: { headers: { Authorization: "Bearer T" }, stream: "download" },
    });
    expect(labels).toBeTruthy();

    const calls = (mock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const init = calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer T");
  });

  it("takes the download path (single header-bearing fetch) with stream:auto + headers", async () => {
    const mock = vi.fn(async () => slpOkResponse());
    globalThis.fetch = mock as unknown as typeof fetch;

    await loadSlp("https://example.com/data.slp", {
      openVideos: false,
      h5: { headers: { Authorization: "Bearer T" }, stream: "auto" },
    });

    const calls = (mock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    // A single header-bearing download fetch (no createLazyFile range path).
    expect(calls).toHaveLength(1);
    const init = calls[0][1] as RequestInit & {
      headers: Record<string, string>;
    };
    expect(init.headers.Authorization).toBe("Bearer T");
  });

  it("maps gs:// to storage.googleapis.com on the fetch URL", async () => {
    const mock = vi.fn(async () => slpOkResponse());
    globalThis.fetch = mock as unknown as typeof fetch;

    await loadSlp("gs://bucket/obj.slp", {
      openVideos: false,
      h5: { stream: "download" },
    });

    const calls = (mock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls[0][0]).toBe("https://storage.googleapis.com/bucket/obj.slp");
  });

  it("retries the download on a 503 (honoring Retry-After) then succeeds", async () => {
    // First call: 503 with Retry-After: 0 (instant backoff). Second: 200 bytes.
    // Proves withRetries is actually wired into the prod download path.
    let call = 0;
    const mock = vi.fn(async () => {
      call++;
      if (call === 1) {
        return {
          ok: false,
          status: 503,
          headers: new Headers({ "Retry-After": "0" }),
          arrayBuffer: async () => new ArrayBuffer(0),
        } as unknown as Response;
      }
      return slpOkResponse();
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    const labels = await loadSlp("https://example.com/data.slp?token=SECRET", {
      openVideos: false,
      h5: { headers: { Authorization: "Bearer T" }, stream: "download" },
    });
    expect(labels).toBeTruthy();

    const calls = (mock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    // Retried exactly once (2 fetches total); auth header forwarded on both.
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const init = c[1] as RequestInit & { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe("Bearer T");
    }
  });

  it("surfaces a redacted RemoteIOError after retries are exhausted on 503", async () => {
    // Always 503: withRetries exhausts and the FINAL thrown error is still the
    // redacted typed error (no raw token leak).
    const mock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 503,
          headers: new Headers({ "Retry-After": "0" }),
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    let err: unknown;
    try {
      await loadSlp("https://h/x.slp?token=SECRET", {
        openVideos: false,
        h5: { stream: "download" },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    const e = err as RemoteIOError;
    expect(e.status).toBe(503);
    expect(e.url).not.toContain("SECRET");
    expect(e.message).not.toContain("SECRET");
    expect(String(e.stack)).not.toContain("SECRET");
    // Exhausted: initial attempt + 3 retries = 4 fetches.
    const calls = (mock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls).toHaveLength(4);
  });

  it("loads a Google Drive SLP via the two-hop confirmation flow (no extra hops)", async () => {
    const FILE_ID = "ABC123";
    const form = `
      <form id="download-form" action="https://drive.usercontent.google.com/download?confirm=t">
        <input type="hidden" name="id" value="${FILE_ID}">
        <input type="hidden" name="uuid" value="u-1">
      </form>`;
    let hop = 0;
    const mock = vi.fn(async (_url: string) => {
      hop++;
      if (hop === 1) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "Content-Type": "text/html" }),
          text: async () => form,
          arrayBuffer: async () => new ArrayBuffer(0),
          body: null,
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="data.slp"',
        }),
        text: async () => "",
        arrayBuffer: async () =>
          SLP_BYTES.buffer.slice(
            SLP_BYTES.byteOffset,
            SLP_BYTES.byteOffset + SLP_BYTES.byteLength,
          ),
        body: null,
      } as unknown as Response;
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    const labels = await loadSlp(
      `https://drive.google.com/file/d/${FILE_ID}/view`,
      { openVideos: false, h5: { stream: "auto" } },
    );
    expect(labels).toBeTruthy();
    // Exactly two Drive hops; no further Drive resolution.
    const calls = (mock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls).toHaveLength(2);
  });

  it("throws a redacted RemoteIOError on 404, hiding the secret token", async () => {
    const mock = vi.fn(
      async () =>
        ({
          ok: false,
          status: 404,
          headers: new Headers(),
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    );
    globalThis.fetch = mock as unknown as typeof fetch;

    let err: unknown;
    try {
      await loadSlp("https://h/x.slp?token=SECRET", {
        openVideos: false,
        h5: { stream: "download" },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    const e = err as RemoteIOError;
    expect(e.message).toContain("file not found");
    expect(e.url).not.toContain("SECRET");
    expect(e.message).not.toContain("SECRET");
    expect(String(e.stack)).not.toContain("SECRET");
  });

  it("rejects s3:// with a redacted RemoteIOError pointing to presigned https", async () => {
    let err: unknown;
    try {
      await loadSlp("s3://bucket/obj.slp", {
        openVideos: false,
        h5: { stream: "download" },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain("presigned https");
  });

  it("headOrRangeProbe forwards Authorization on HEAD->Range fallback", async () => {
    const mock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD")
        return { ok: false, status: 405 } as Response;
      return { ok: false, status: 206 } as Response;
    });
    globalThis.fetch = mock as unknown as typeof fetch;
    const ok = await headOrRangeProbe("https://h/x.slp", {
      headers: { Authorization: "Bearer T" },
    });
    expect(ok).toBe(true);
    const calls = (mock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      const init = c[1] as RequestInit & { headers: Record<string, string> };
      expect(init.headers.Authorization).toBe("Bearer T");
    }
  });
});

describe("createVideoBackend remote URL handling", () => {
  it("rejects s3:// video URLs with a redacted RemoteIOError", async () => {
    let err: unknown;
    try {
      await createVideoBackend("s3://bucket/video.mp4");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain("presigned https");
  });

  it("rejects Google Drive video URLs as unsupported", async () => {
    let err: unknown;
    try {
      await createVideoBackend(
        "https://drive.google.com/file/d/ABC/view?ext=.mp4",
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain(
      "Google Drive videos are not supported",
    );
  });
});
