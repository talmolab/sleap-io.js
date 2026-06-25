import { describe, it, expect, beforeEach, afterEach, vi } from "../bun-test";
import {
  parseGdrive,
  urlFromConfirmation,
  checkDownloadHost,
  openGdrive,
} from "../../src/io/gdrive.js";
import { RemoteIOError } from "../../src/io/remote.js";

const FILE_ID = "1A2B3C4D5E6F";

describe("parseGdrive", () => {
  it("parses every supported share-link shape", () => {
    const cases: [string, string][] = [
      [`https://drive.google.com/file/d/${FILE_ID}/view`, FILE_ID],
      [`https://drive.google.com/file/d/${FILE_ID}/edit`, FILE_ID],
      [`https://drive.google.com/file/d/${FILE_ID}/preview`, FILE_ID],
      [`https://drive.google.com/file/d/${FILE_ID}`, FILE_ID],
      [`https://drive.google.com/file/d/${FILE_ID}/`, FILE_ID],
      [`https://drive.google.com/file/u/0/d/${FILE_ID}/view`, FILE_ID],
      [`https://drive.google.com/open?id=${FILE_ID}`, FILE_ID],
      [`https://drive.google.com/uc?id=${FILE_ID}&export=download`, FILE_ID],
      [`https://drive.google.com/uc?export=download&id=${FILE_ID}`, FILE_ID],
    ];
    for (const [url, expected] of cases) {
      expect(parseGdrive(url)).toBe(expected);
    }
  });

  it("rejects folders and trailing-segment URLs", () => {
    const bad = [
      `https://drive.google.com/drive/folders/${FILE_ID}`,
      `https://drive.google.com/folders/${FILE_ID}`,
      `https://drive.google.com/file/d/${FILE_ID}/view/extra`,
      "https://drive.google.com/",
    ];
    for (const url of bad) {
      expect(() => parseGdrive(url)).toThrow();
    }
  });

  it("redacts tokens in thrown messages", () => {
    let err: unknown;
    try {
      parseGdrive("https://drive.google.com/?token=SECRET");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain("SECRET");
  });
});

describe("urlFromConfirmation", () => {
  it("returns the small-file href with &amp; decoded", () => {
    const html = `<a href="/uc?export=download&amp;id=${FILE_ID}&amp;confirm=t">Download</a>`;
    const out = urlFromConfirmation(html);
    expect(out).toBe(
      `https://docs.google.com/uc?export=download&id=${FILE_ID}&confirm=t`,
    );
  });

  it("parses the #download-form, hidden inputs winning", () => {
    const html = `
      <form id="download-form" action="https://drive.usercontent.google.com/download?foo=bar">
        <input type="hidden" name="id" value="${FILE_ID}">
        <input type="hidden" name="export" value="download">
        <input type="hidden" name="confirm" value="abc123">
        <input type="hidden" name="uuid" value="u-9999">
        <input type="submit" value="Download">
      </form>`;
    const out = urlFromConfirmation(html);
    expect(out).toContain("drive.usercontent.google.com/download");
    expect(out).toContain(`id=${FILE_ID}`);
    expect(out).toContain("confirm=abc123");
    expect(out).toContain("uuid=u-9999");
    expect(out).toContain("export=download");
  });

  it("decodes the JSON downloadUrl variant", () => {
    const html = `{"downloadUrl":"https://x/y?a\\u003d1\\u0026b\\u003d2"}`;
    const out = urlFromConfirmation(html);
    expect(out).toBe("https://x/y?a=1&b=2");
  });

  it("throws RemoteIOError with the caption on an error page", () => {
    const html =
      '<p class="uc-error-subcaption">Too many users have viewed or downloaded this file recently.</p>';
    let err: unknown;
    try {
      urlFromConfirmation(html, "https://drive.google.com/uc?id=X");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain("refused the download");
    expect((err as Error).message).toContain("Too many users");
  });

  it("throws when nothing matches", () => {
    expect(() => urlFromConfirmation("<html>nope</html>")).toThrow(
      /Could not find/,
    );
  });
});

describe("checkDownloadHost", () => {
  it("allows the Drive download hosts", () => {
    for (const u of [
      "https://drive.google.com/uc?id=X",
      "https://docs.google.com/uc?id=X",
      "https://drive.usercontent.google.com/download",
      "https://abc.googleusercontent.com/x",
    ]) {
      expect(() => checkDownloadHost(u)).not.toThrow();
    }
  });

  it("rejects unexpected hosts and schemes", () => {
    for (const u of [
      "https://evil.com/x",
      "http://localhost/x",
      "ftp://drive.google.com/x",
    ]) {
      expect(() => checkDownloadHost(u)).toThrow(RemoteIOError);
    }
  });
});

// --- openGdrive (stubbed fetch only) ---

type StubResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array> | null;
};

function htmlResponse(html: string): StubResponse {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ "Content-Type": "text/html; charset=utf-8" }),
    text: async () => html,
    arrayBuffer: async () => new ArrayBuffer(0),
    body: null,
  };
}

function fileResponse(
  bytes: Uint8Array,
  extraHeaders: Record<string, string> = {},
): StubResponse {
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="data.slp"',
      ...extraHeaders,
    }),
    text: async () => "",
    arrayBuffer: async () =>
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    body: null,
  };
}

describe("openGdrive", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("two-hop: interstitial -> file, strips Authorization/Cookie, sends browser UA", async () => {
    const fileBytes = new Uint8Array([1, 2, 3, 4]);
    const form = `
      <form id="download-form" action="https://drive.usercontent.google.com/download?confirm=t">
        <input type="hidden" name="id" value="${FILE_ID}">
        <input type="hidden" name="uuid" value="u-1">
      </form>`;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) return htmlResponse(form) as unknown as Response;
      return fileResponse(fileBytes) as unknown as Response;
    });
    globalThis.fetch = mock as unknown as typeof fetch;

    const out = await openGdrive(
      `https://drive.google.com/file/d/${FILE_ID}/view`,
      { headers: { Authorization: "Bearer T", Cookie: "c=1" } },
    );
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain("drive.usercontent.google.com/download");
    for (const c of calls) {
      const headers = (c.init?.headers ?? {}) as Record<string, string>;
      // Browser UA sent; Authorization/Cookie NEVER sent to Google hosts.
      expect(headers["User-Agent"]).toContain("Mozilla/5.0");
      expect(headers.Authorization).toBeUndefined();
      expect(headers.Cookie).toBeUndefined();
    }
  });

  it("cap pre-check throws when Content-Length exceeds maxBytes", async () => {
    const mock = vi.fn(
      async () =>
        fileResponse(new Uint8Array(4), {
          "Content-Length": "1000000",
        }) as unknown as Response,
    );
    globalThis.fetch = mock as unknown as typeof fetch;
    let err: unknown;
    try {
      await openGdrive(`https://drive.google.com/uc?id=${FILE_ID}`, {
        maxBytes: 10,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain(
      "exceeds the maximum in-memory download size",
    );
  });

  it("running-check throws (no Content-Length) and discards the buffer", async () => {
    // Chunked body with no Content-Length, exceeding a small cap.
    const chunk = new Uint8Array(8).fill(7);
    const makeBody = (): ReadableStream<Uint8Array> => {
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent < 4) {
            sent++;
            controller.enqueue(chunk);
          } else {
            controller.close();
          }
        },
      });
    };
    const mock = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          "Content-Type": "application/octet-stream",
          "Content-Disposition": 'attachment; filename="data.slp"',
        }),
        text: async () => "",
        arrayBuffer: async () => new ArrayBuffer(0),
        body: makeBody(),
      } as unknown as Response;
    });
    globalThis.fetch = mock as unknown as typeof fetch;
    let err: unknown;
    try {
      await openGdrive(`https://drive.google.com/uc?id=${FILE_ID}`, {
        maxBytes: 10,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain(
      "exceeds the maximum in-memory download size",
    );
  });

  it("throws after MAX_HOPS interstitials without converging", async () => {
    const form = `
      <form id="download-form" action="https://drive.usercontent.google.com/download?confirm=t">
        <input type="hidden" name="id" value="${FILE_ID}">
      </form>`;
    const mock = vi.fn(async () => htmlResponse(form) as unknown as Response);
    globalThis.fetch = mock as unknown as typeof fetch;
    let err: unknown;
    try {
      await openGdrive(`https://drive.google.com/uc?id=${FILE_ID}`);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain("did not converge within 4 hops");
  });

  it("SSRF: refuses to follow a form action to an unexpected host", async () => {
    const form = `
      <form id="download-form" action="https://evil.com/download">
        <input type="hidden" name="id" value="${FILE_ID}">
      </form>`;
    let secondCalled = false;
    const mock = vi.fn(async (_url: string) => {
      if (!secondCalled) {
        secondCalled = true;
        return htmlResponse(form) as unknown as Response;
      }
      // Should never be reached — the host check throws first.
      return fileResponse(new Uint8Array(1)) as unknown as Response;
    });
    globalThis.fetch = mock as unknown as typeof fetch;
    let err: unknown;
    try {
      await openGdrive(`https://drive.google.com/uc?id=${FILE_ID}`);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RemoteIOError);
    expect((err as Error).message).toContain("unexpected host");
  });
});
