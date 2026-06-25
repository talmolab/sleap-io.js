/**
 * Google Drive share-link resolver (browser + Node portable).
 *
 * Ports the realistic subset of Python sleap-io's `_gdrive.py` (PRs #441/#445):
 * parse a Drive file id from any share-link shape, scrape the virus-scan
 * interstitial to a real download URL, enforce a host allowlist (SSRF guard),
 * and buffer-download the file capped at a maximum in-memory size. Credentials
 * are stripped before any request and never sent to Google hosts.
 *
 * @module
 */

import {
  RemoteIOError,
  SENSITIVE_HEADERS,
  raiseRemote,
  redactUrl,
} from "./remote.js";

const UC_URL_TEMPLATE = (id: string): string =>
  `https://drive.google.com/uc?id=${id}`;
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const MAX_HOPS = 4;
/** Default cap for a buffered Drive download: 8 GiB. */
export const DEFAULT_MAX_BYTES = 8 * 1024 ** 3;
const READ_CHUNK = 1024 ** 2; // 1 MiB

/** Hosts Drive download requests may target (exact match). */
const DOWNLOAD_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com",
  "drive.usercontent.google.com",
]);
const DOWNLOAD_HOST_SUFFIX = ".googleusercontent.com";

const FOLDER_RE = /(?:drive\/)?folders\//;
const FILE_PATH_RE =
  /^\/file\/(?:u\/[0-9]+\/)?d\/([^/]+)(?:\/(?:edit|view|preview))?\/?$/;
const HREF_RE = /href="(\/uc\?export=download[^"]+)"/;
const DOWNLOAD_URL_JSON_RE = /"downloadUrl":"([^"]+)"/;
const ERROR_CAPTION_RE = /<p class="uc-error-subcaption">([\s\S]*?)<\/p>/;

function isNode(): boolean {
  return typeof process !== "undefined" && !!process?.versions?.node;
}

/**
 * Extract a Google Drive file id from any share-link shape.
 *
 * Order matters: folders are rejected first, then an `id=` query param, then the
 * `/file/d/<ID>/...` path form. Throws (with a redacted url) for folder URLs,
 * trailing-segment URLs, and anything else unparsable. Port of `_parse_gdrive`.
 */
export function parseGdrive(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(
      `Could not parse a Google Drive file ID from URL: ${redactUrl(url)}`,
    );
  }
  // Folder reject FIRST (covers /drive/folders/<ID> and /folders/<ID>).
  if (FOLDER_RE.test(u.pathname)) {
    throw new Error(
      `Google Drive folder URLs are not supported: ${redactUrl(url)}`,
    );
  }
  // `id=` query param wins next (covers /open?id=, /uc?id=&export=download).
  const idParam = u.searchParams.get("id");
  if (idParam) return idParam;
  // Path form: /file/d/<ID>/{view,edit,preview}, bare, trailing slash, /u/0/.
  const m = FILE_PATH_RE.exec(u.pathname);
  if (m) return m[1];
  throw new Error(
    `Could not parse a Google Drive file ID from URL: ${redactUrl(url)}`,
  );
}

/** Strip HTML tags and unescape the common entities from a caption fragment. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Parse the `<form id="download-form">` out of an interstitial page: return its
 * action URL with the hidden inputs merged in (hidden inputs win). Prefers the
 * DOM parser when available, falling back to regex in Node.
 */
function parseDownloadForm(html: string): string | null {
  // Prefer DOMParser (browser) for robustness; fall back to regex (Node).
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const form = doc.querySelector(
        'form#download-form, form[id="download-form"]',
      ) as HTMLFormElement | null;
      if (form) {
        const action = form.getAttribute("action") ?? "";
        if (action) {
          const target = new URL(action);
          const inputs = form.querySelectorAll("input");
          inputs.forEach((input) => {
            const name = input.getAttribute("name");
            if (!name) return;
            target.searchParams.set(name, input.getAttribute("value") ?? "");
          });
          return target.toString();
        }
      }
    } catch {
      // Fall through to regex.
    }
  }
  // Regex fallback.
  const formMatch =
    /<form[^>]*id="download-form"[^>]*>([\s\S]*?)<\/form>/i.exec(html) ??
    /<form[^>]*\bid='download-form'[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!formMatch) return null;
  const formTag = /<form[^>]*id=["']download-form["'][^>]*>/i.exec(html)?.[0];
  const actionMatch = formTag ? /action=["']([^"']+)["']/i.exec(formTag) : null;
  if (!actionMatch) return null;
  let target: URL;
  try {
    target = new URL(actionMatch[1].replace(/&amp;/g, "&"));
  } catch {
    return null;
  }
  const body = formMatch[1];
  const inputRe = /<input\b[^>]*>/gi;
  for (const match of body.matchAll(inputRe)) {
    const tag = match[0];
    const name = /name=["']([^"']*)["']/i.exec(tag)?.[1];
    if (!name) continue;
    const value = /value=["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    target.searchParams.set(name, value);
  }
  return target.toString();
}

/**
 * Scrape the next download URL out of a Drive confirmation page. Tries, in EXACT
 * precedence order: small-file href, large-file `#download-form`, JSON
 * `downloadUrl`, then an error caption (→ throws). Port of `_url_from_confirmation`.
 *
 * @param html The interstitial HTML.
 * @param url The originating URL (for redacted error context).
 */
export function urlFromConfirmation(html: string, url = ""): string {
  // 1. Small-file href.
  const href = HREF_RE.exec(html);
  if (href) {
    return "https://docs.google.com" + href[1].replace(/&amp;/g, "&");
  }
  // 2. Large-file #download-form (dominant path).
  const form = parseDownloadForm(html);
  if (form) return form;
  // 3. JSON variant.
  const json = DOWNLOAD_URL_JSON_RE.exec(html);
  if (json) {
    return json[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
  }
  // 4. Quota/permission error page.
  const err = ERROR_CAPTION_RE.exec(html);
  if (err) {
    const caption = stripTags(err[1]);
    throw new RemoteIOError({
      message: `Google Drive refused the download: ${caption} (if quota, retry later; if permission, set sharing to 'Anyone with the link')`,
      url,
      status: null,
    });
  }
  // 5. Nothing matched.
  throw new Error(
    "Could not find a Google Drive download link in the confirmation page",
  );
}

/**
 * SSRF guard: allow only http(s) URLs whose host is in the Drive allowlist or
 * ends with `.googleusercontent.com`. Throws a redacted {@link RemoteIOError}
 * otherwise. Call before EVERY cookie-carrying GET. Port of `_check_download_host`.
 */
export function checkDownloadHost(url: string): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new RemoteIOError({
      message: `Refusing to follow a Google Drive redirect to an unexpected host: ${redactUrl(url)}`,
      url,
      status: null,
    });
  }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  const host = u.hostname.toLowerCase();
  const allowed =
    (scheme === "http" || scheme === "https") &&
    (DOWNLOAD_HOSTS.has(host) || host.endsWith(DOWNLOAD_HOST_SUFFIX));
  if (!allowed) {
    throw new RemoteIOError({
      message: `Refusing to follow a Google Drive redirect to an unexpected host: ${redactUrl(url)}`,
      url,
      status: null,
    });
  }
}

/**
 * Read a response body into a Uint8Array, capped at `cap` bytes. Enforces both a
 * `Content-Length` pre-check and a running total (Drive often omits the length
 * and streams chunked). On overflow, throws and discards the partial buffer.
 * Port of `_read_body_capped`.
 */
async function readBodyCapped(
  response: Response,
  cap: number,
  url: string,
): Promise<Uint8Array> {
  const len = response.headers.get("Content-Length");
  if (len && Number(len) > cap) {
    throw new RemoteIOError({
      message: `Google Drive file exceeds the maximum in-memory download size (cap=${cap}, Content-Length=${len})`,
      url,
      status: null,
    });
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const overflow = (): never => {
    // Discard partial buffer on overflow.
    chunks.length = 0;
    throw new RemoteIOError({
      message: `Google Drive file exceeds the maximum in-memory download size (cap=${cap})`,
      url,
      status: null,
    });
  };

  const body = response.body;
  if (body && typeof (body as ReadableStream).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        // Slice into READ_CHUNK increments only matters for the running check
        // granularity; accumulate directly and check the running total.
        total += value.byteLength;
        if (total > cap) overflow();
        chunks.push(value);
      }
    }
  } else {
    // No streaming body (test stubs): fall back to arrayBuffer, still capped.
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > cap) overflow();
    return buf;
  }

  // Concatenate (READ_CHUNK referenced for parity with the Python chunk size).
  void READ_CHUNK;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Extract a minimal `Cookie` header value from a response's `set-cookie`. */
function extractCookie(response: Response): string | null {
  // Node fetch exposes set-cookie via headers.get (joined) or getSetCookie.
  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  let raw: string | null = null;
  if (typeof getSetCookie === "function") {
    const all = getSetCookie.call(response.headers);
    if (all?.length) raw = all.join(", ");
  }
  if (!raw) raw = response.headers.get("set-cookie");
  if (!raw) return null;
  // Keep only name=value pairs (drop attributes like Path/Expires/HttpOnly).
  const pairs = raw
    .split(/,(?=[^;]+=)/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean);
  return pairs.length ? pairs.join("; ") : null;
}

/**
 * Resolve a Google Drive share link and buffer-download the file.
 *
 * Strips sensitive headers, sends a browser User-Agent, follows the virus-scan
 * interstitial through up to {@link MAX_HOPS} hops (enforcing the host
 * allowlist on each), and caps the in-memory download at `maxBytes`. Port of
 * `_resolve_and_fetch`.
 *
 * Drive is always download-mode; `streamMode`/range options do not apply. Drive
 * VIDEO is unsupported (the SLP caller rejects it before reaching here).
 *
 * @returns The downloaded file bytes.
 */
export async function openGdrive(
  url: string,
  options?: { headers?: Record<string, string>; maxBytes?: number },
): Promise<Uint8Array> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const fileId = parseGdrive(url);
  let current = UC_URL_TEMPLATE(fileId);

  // Strip sensitive headers; never send Authorization/Cookie to Google hosts.
  const baseHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(options?.headers ?? {})) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) continue;
    baseHeaders[k] = v;
  }
  baseHeaders["User-Agent"] = BROWSER_UA;

  const node = isNode();
  let cookie: string | null = null;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    checkDownloadHost(current);
    const headers = { ...baseHeaders };
    if (node && cookie) headers["Cookie"] = cookie;

    let response: Response;
    try {
      response = await fetch(
        current,
        node ? { headers, redirect: "manual" } : { headers },
      );
    } catch (e) {
      raiseRemote(current, e);
    }

    // Node manual-redirect: follow within the Drive allowlist, carrying cookies.
    if (node) {
      let redirects = 0;
      while (
        response.status >= 300 &&
        response.status < 400 &&
        redirects < MAX_HOPS
      ) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, current).toString();
        checkDownloadHost(next);
        const setCookie = extractCookie(response);
        if (setCookie) cookie = cookie ? `${cookie}; ${setCookie}` : setCookie;
        const hopHeaders = { ...baseHeaders };
        if (cookie) hopHeaders["Cookie"] = cookie;
        current = next;
        try {
          response = await fetch(current, {
            headers: hopHeaders,
            redirect: "manual",
          });
        } catch (e) {
          raiseRemote(current, e);
        }
        redirects++;
      }
      const setCookie = extractCookie(response);
      if (setCookie) cookie = cookie ? `${cookie}; ${setCookie}` : setCookie;
    }

    if (!response.ok) {
      raiseRemote(current, undefined, response.status);
    }

    const contentDisposition = response.headers.get("Content-Disposition");
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentDisposition || !contentType.startsWith("text/html")) {
      // This is the file.
      return readBodyCapped(response, maxBytes, current);
    }

    // Otherwise it is an interstitial — scrape the next URL.
    const html = await response.text();
    current = urlFromConfirmation(html, current);
  }

  throw new RemoteIOError({
    message: `Google Drive download did not converge within ${MAX_HOPS} hops`,
    url,
    status: null,
  });
}
