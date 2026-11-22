// src/io/remote.ts
var URL_SCHEMES = /* @__PURE__ */ new Set([
  "http",
  "https",
  "s3",
  "gs",
  "gcs",
  "az",
  "abfs"
]);
var CLOUD_SCHEMES = /* @__PURE__ */ new Set(["s3", "gs", "gcs", "az", "abfs"]);
var GDRIVE_HOSTS = /* @__PURE__ */ new Set(["drive.google.com", "docs.google.com"]);
var SENSITIVE_HEADERS = /* @__PURE__ */ new Set([
  "authorization",
  "cookie",
  "proxy-authorization"
]);
var SENSITIVE_QUERY_PARAMS = /* @__PURE__ */ new Set([
  "token",
  "access_token",
  "x-amz-security-token",
  "sas",
  "sig"
]);
var RETRYABLE_STATUSES = /* @__PURE__ */ new Set([429, 500, 502, 503, 504]);
var URL_IN_TEXT_PATTERN = /(?:http|https|s3|gs|gcs|az|abfs):\/\/[^\s"'<>]+/gi;
function isUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  const colon = value.indexOf(":");
  if (colon <= 1) return false;
  const scheme = value.slice(0, colon).toLowerCase();
  return scheme.length > 1 && URL_SCHEMES.has(scheme);
}
function isGdriveUrl(value) {
  if (!isUrl(value)) return false;
  try {
    return GDRIVE_HOSTS.has(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}
function redactUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.username || parsed.password) {
    parsed.username = "***";
    parsed.password = "***";
  }
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
      parsed.searchParams.set(key, "***");
    }
  }
  return parsed.toString();
}
function redactedCauseSummary(e) {
  const typeName = e?.constructor?.name ?? "Error";
  const rawMsg = String(
    e?.message ?? e
  );
  const redactedMsg = rawMsg.replace(URL_IN_TEXT_PATTERN, (m) => redactUrl(m)).replace(/\s*\n\s*/g, " ").trim();
  return `${typeName}: ${redactedMsg}`;
}
var RemoteIOError = class extends Error {
  status;
  /** ALWAYS redacted. */
  url;
  causeSummary;
  /**
   * Delay (ms) hinted by a `Retry-After` response header, threaded to
   * {@link withRetries}. Not part of Python; a JS-side channel so the retry
   * loop can honor server backoff without re-issuing the failed request.
   */
  retryAfterMs;
  constructor(opts) {
    const redactedUrl = redactUrl(opts.url);
    const causeSummary = opts.cause !== void 0 ? redactedCauseSummary(opts.cause) : void 0;
    const parts = [
      opts.message,
      `status=${opts.status ?? "null"}`,
      `url=${redactedUrl}`
    ];
    if (causeSummary) parts.push(`cause=${causeSummary}`);
    super(parts.join("; "));
    this.name = "RemoteIOError";
    this.status = opts.status ?? null;
    this.url = redactedUrl;
    this.causeSummary = causeSummary;
    Object.setPrototypeOf(this, new.target.prototype);
  }
};
function resolveUrl(url) {
  if (!isUrl(url)) {
    throw new RemoteIOError({ message: "Not a URL", url, status: null });
  }
  if (isGdriveUrl(url)) {
    return { url, gdrive: true };
  }
  const colon = url.indexOf(":");
  const scheme = url.slice(0, colon).toLowerCase();
  if (scheme === "http" || scheme === "https") {
    return { url, gdrive: false };
  }
  if (scheme === "gs" || scheme === "gcs") {
    const rest = url.slice(url.indexOf("://") + 3);
    const slash = rest.indexOf("/");
    const bucket = slash === -1 ? rest : rest.slice(0, slash);
    const objectPath = slash === -1 ? "" : rest.slice(slash + 1);
    return {
      url: `https://storage.googleapis.com/${bucket}/${objectPath}`,
      gdrive: false
    };
  }
  throw new RemoteIOError({
    message: `Cloud scheme '${scheme}' is not supported in the browser. Pass a presigned https:// URL instead.`,
    url,
    status: null
  });
}
function statusToMessage(status) {
  switch (status) {
    case 404:
      return "file not found";
    case 416:
      return "range past end of file";
    case 412:
      return "file changed since cached (ETag mismatch)";
    default:
      return `HTTP ${status}`;
  }
}
function raiseRemote(url, e, status) {
  let message;
  if (status != null) {
    message = statusToMessage(status);
  } else if (e instanceof Error && (e.name === "AbortError" || typeof DOMException !== "undefined" && e instanceof DOMException && e.name === "AbortError")) {
    message = "timeout";
  } else if (e instanceof TypeError) {
    message = "connection error";
  } else {
    const typeName = e?.constructor?.name ?? "Error";
    message = `unexpected error: ${typeName}`;
  }
  throw new RemoteIOError({ message, url, status: status ?? null, cause: e });
}
function identityHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === "accept-encoding") continue;
    out[k] = v;
  }
  out["Accept-Encoding"] = "identity";
  return out;
}
function stripCrossOriginHeaders(headers, fromUrl, toUrl) {
  let sameOrigin = false;
  try {
    sameOrigin = new URL(toUrl).origin === new URL(fromUrl).origin;
  } catch {
    sameOrigin = false;
  }
  if (sameOrigin) return headers;
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}
async function withRetries(fn, options) {
  const retries = options?.retries ?? 3;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      const retryable = e instanceof RemoteIOError && (e.status === null || RETRYABLE_STATUSES.has(e.status ?? -1));
      if (!retryable || attempt >= retries) {
        throw e;
      }
      const retryAfterMs = e.retryAfterMs;
      const delayMs = retryAfterMs != null ? Math.min(retryAfterMs, 3e4) : Math.min(200 * 2 ** attempt, 3e4);
      attempt += 1;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
function parseRetryAfterMs(value) {
  if (!value) return void 0;
  const secs = Number.parseInt(value, 10);
  if (!Number.isFinite(secs) || String(secs) !== value.trim()) return void 0;
  return Math.min(secs * 1e3, 3e4);
}
async function fetchRetrying(url, init, options) {
  return withRetries(async () => {
    let response;
    try {
      response = await fetch(url, init);
    } catch (e) {
      raiseRemote(url, e);
    }
    if (RETRYABLE_STATUSES.has(response.status)) {
      const err = new RemoteIOError({
        message: statusToMessage(response.status),
        url,
        status: response.status
      });
      err.retryAfterMs = parseRetryAfterMs(
        response.headers?.get?.("Retry-After") ?? null
      );
      throw err;
    }
    return response;
  }, options);
}
async function headOrRangeProbe(url, options) {
  let resolved;
  try {
    resolved = resolveUrl(url);
  } catch {
    return false;
  }
  if (resolved.gdrive) {
    try {
      const { parseGdrive } = await import("./gdrive-BTCJSLQW.js");
      parseGdrive(url);
      return true;
    } catch {
      return false;
    }
  }
  const headers = options?.headers ?? {};
  try {
    const head = await fetch(resolved.url, { method: "HEAD", headers });
    if (head.ok) return true;
  } catch {
  }
  try {
    const ranged = await fetch(resolved.url, {
      method: "GET",
      headers: { ...headers, Range: "bytes=0-0" }
    });
    return ranged.ok || ranged.status === 206;
  } catch {
    return false;
  }
}

export {
  URL_SCHEMES,
  CLOUD_SCHEMES,
  GDRIVE_HOSTS,
  SENSITIVE_HEADERS,
  SENSITIVE_QUERY_PARAMS,
  RETRYABLE_STATUSES,
  isUrl,
  isGdriveUrl,
  redactUrl,
  redactedCauseSummary,
  RemoteIOError,
  resolveUrl,
  statusToMessage,
  raiseRemote,
  identityHeaders,
  stripCrossOriginHeaders,
  withRetries,
  parseRetryAfterMs,
  fetchRetrying,
  headOrRangeProbe
};
