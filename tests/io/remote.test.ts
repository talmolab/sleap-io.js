import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";
import {
  isUrl,
  isGdriveUrl,
  resolveUrl,
  redactUrl,
  redactedCauseSummary,
  RemoteIOError,
  statusToMessage,
  identityHeaders,
  stripCrossOriginHeaders,
  withRetries,
  headOrRangeProbe,
} from "../../src/io/remote.js";

describe("isUrl", () => {
  it("recognizes remote schemes", () => {
    expect(isUrl("http://h/x")).toBe(true);
    expect(isUrl("https://h/x")).toBe(true);
    expect(isUrl("gs://b/o")).toBe(true);
    expect(isUrl("s3://b/o")).toBe(true);
    expect(isUrl("gcs://b/o")).toBe(true);
    expect(isUrl("az://b/o")).toBe(true);
    expect(isUrl("abfs://b/o")).toBe(true);
  });

  it("rejects non-URLs (drive-letter guard etc.)", () => {
    expect(isUrl("")).toBe(false);
    expect(isUrl(123 as unknown as string)).toBe(false);
    expect(isUrl(null as unknown as string)).toBe(false);
    // Single-letter scheme (Windows drive letter) must NOT be a URL.
    expect(isUrl("C:\\path\\file.slp")).toBe(false);
    expect(isUrl("relative/path.slp")).toBe(false);
    expect(isUrl("/abs/path.slp")).toBe(false);
    // Unknown scheme.
    expect(isUrl("ftp://h/x")).toBe(false);
  });
});

describe("isGdriveUrl", () => {
  it("matches Drive hosts case-insensitively", () => {
    expect(isGdriveUrl("https://drive.google.com/file/d/ABC/view")).toBe(true);
    expect(isGdriveUrl("https://DOCS.GOOGLE.COM/uc?id=ABC")).toBe(true);
  });

  it("rejects other hosts and non-URLs", () => {
    expect(isGdriveUrl("https://example.com/x")).toBe(false);
    expect(isGdriveUrl("not a url")).toBe(false);
    expect(isGdriveUrl("C:\\path")).toBe(false);
  });
});

describe("resolveUrl", () => {
  it("maps gs:// to storage.googleapis.com preserving nested path + query", () => {
    expect(resolveUrl("gs://my-bucket/path/to/obj.slp")).toEqual({
      url: "https://storage.googleapis.com/my-bucket/path/to/obj.slp",
      gdrive: false,
    });
    expect(resolveUrl("gs://b/a/b/c.slp?x=1")).toEqual({
      url: "https://storage.googleapis.com/b/a/b/c.slp?x=1",
      gdrive: false,
    });
  });

  it("maps gcs:// to storage.googleapis.com", () => {
    expect(resolveUrl("gcs://b/o")).toEqual({
      url: "https://storage.googleapis.com/b/o",
      gdrive: false,
    });
  });

  it("passes through http(s) and flags Drive", () => {
    expect(resolveUrl("https://h/x.slp")).toEqual({
      url: "https://h/x.slp",
      gdrive: false,
    });
    expect(resolveUrl("https://drive.google.com/file/d/ABC/view")).toEqual({
      url: "https://drive.google.com/file/d/ABC/view",
      gdrive: true,
    });
  });

  it("throws RemoteIOError pointing to presigned https for cloud schemes", () => {
    for (const u of ["s3://b/o", "az://b/o", "abfs://c@a.dfs/x"]) {
      let err: unknown;
      try {
        resolveUrl(u);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(RemoteIOError);
      expect((err as Error).message).toContain("presigned https");
    }
  });

  it("throws for non-URL input", () => {
    expect(() => resolveUrl("/local/path.slp")).toThrow(RemoteIOError);
  });
});

// The redacted value of a sensitive param is either `***` or its percent-encoded
// form `%2A%2A%2A` depending on the URL implementation; assert it is masked
// (some form present) and the original secret is gone.
function maskedTokenPresent(out: string, param: string): boolean {
  return out.includes(`${param}=%2A%2A%2A`) || out.includes(`${param}=***`);
}

describe("redactUrl", () => {
  it("masks userinfo and sensitive query values, keeps others", () => {
    const out = redactUrl("https://u:p@host/x?token=secret&keep=1");
    expect(out).toContain("***:***@host");
    expect(maskedTokenPresent(out, "token")).toBe(true);
    expect(out).toContain("keep=1");
    expect(out).not.toContain("secret");
  });

  it("masks sensitive params case-insensitively", () => {
    const out = redactUrl("https://h/x?Access_Token=abc");
    expect(maskedTokenPresent(out, "Access_Token")).toBe(true);
    expect(out).not.toContain("abc");
  });

  it("masks each known sensitive param", () => {
    for (const p of [
      "token",
      "access_token",
      "x-amz-security-token",
      "sas",
      "sig",
    ]) {
      const out = redactUrl(`https://h/x?${p}=zzz`);
      expect(out).not.toContain("zzz");
    }
  });

  it("returns malformed URLs unchanged", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });

  it("leaves non-sensitive params untouched", () => {
    expect(redactUrl("https://h/x?a=1&b=2")).toBe("https://h/x?a=1&b=2");
  });
});

describe("redactedCauseSummary", () => {
  it("scrubs URL tokens out of error text", () => {
    const out = redactedCauseSummary(
      new Error("fetch failed for https://h/x?token=abc"),
    );
    expect(out.startsWith("Error:")).toBe(true);
    expect(out.includes("token=***") || out.includes("token=%2A%2A%2A")).toBe(
      true,
    );
    expect(out).not.toContain("abc");
  });
});

describe("RemoteIOError", () => {
  it("redacts url, sets status, and does NOT chain the raw cause", () => {
    const raw = new Error("boom https://h/x?token=SECRET");
    const err = new RemoteIOError({
      message: "file not found",
      url: "https://u:p@h/x?token=SECRET",
      status: 404,
      cause: raw,
    });
    expect(err.status).toBe(404);
    expect(err.url).toContain("***:***@h");
    expect(maskedTokenPresent(err.url, "token")).toBe(true);
    expect(err.message).toContain("status=404");
    expect(err.message).toContain("url=");
    // The raw transport error must NOT be chained.
    expect((err as { cause?: unknown }).cause).toBeUndefined();
    // No secret anywhere.
    expect(err.message).not.toContain("SECRET");
    expect(err.url).not.toContain("SECRET");
  });
});

describe("statusToMessage", () => {
  it("maps known statuses", () => {
    expect(statusToMessage(404)).toBe("file not found");
    expect(statusToMessage(416)).toBe("range past end of file");
    expect(statusToMessage(412)).toBe(
      "file changed since cached (ETag mismatch)",
    );
    expect(statusToMessage(503)).toBe("HTTP 503");
  });
});

describe("identityHeaders", () => {
  it("forces Accept-Encoding: identity and drops any case", () => {
    const out = identityHeaders({
      "accept-encoding": "gzip",
      Authorization: "Bearer T",
    });
    expect(out["Accept-Encoding"]).toBe("identity");
    expect(out["accept-encoding"]).toBeUndefined();
    expect(out.Authorization).toBe("Bearer T");
  });
});

describe("stripCrossOriginHeaders", () => {
  it("keeps headers same-origin", () => {
    const h = { Authorization: "Bearer T", "X-Other": "1" };
    expect(stripCrossOriginHeaders(h, "https://a/x", "https://a/y")).toEqual(h);
  });

  it("drops sensitive headers cross-origin (any case)", () => {
    const out = stripCrossOriginHeaders(
      { authorization: "Bearer T", Cookie: "c", "X-Other": "1" },
      "https://a/x",
      "https://b/y",
    );
    expect(out.authorization).toBeUndefined();
    expect(out.Cookie).toBeUndefined();
    expect(out["X-Other"]).toBe("1");
  });
});

describe("withRetries", () => {
  it("retries retryable 503 then succeeds", async () => {
    let calls = 0;
    const result = await withRetries(
      async () => {
        calls++;
        if (calls < 3) {
          throw new RemoteIOError({
            message: "HTTP 503",
            url: "https://h/x",
            status: 503,
          });
        }
        return "ok";
      },
      { retries: 3 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("does not retry a non-retryable 404", async () => {
    let calls = 0;
    let err: unknown;
    try {
      await withRetries(
        async () => {
          calls++;
          throw new RemoteIOError({
            message: "file not found",
            url: "https://h/x",
            status: 404,
          });
        },
        { retries: 3 },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect(calls).toBe(1);
  });
});

describe("headOrRangeProbe", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("falls back to Range GET on 405 and forwards Authorization on both", async () => {
    const mock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return { ok: false, status: 405 } as Response;
      }
      return { ok: false, status: 206 } as Response;
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    const ok = await headOrRangeProbe("https://h/x", {
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

  it("returns false (never throws) on a thrown TypeError", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    expect(await headOrRangeProbe("https://h/x")).toBe(false);
  });

  it("returns false for unsupported cloud scheme", async () => {
    expect(await headOrRangeProbe("s3://b/o")).toBe(false);
  });
});
