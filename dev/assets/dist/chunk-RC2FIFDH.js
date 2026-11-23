import {
  RemoteIOError,
  SENSITIVE_HEADERS,
  fetchRetrying,
  raiseRemote,
  redactUrl
} from "./chunk-3UBNQTMV.js";

// src/io/gdrive.ts
var UC_URL_TEMPLATE = (id) => `https://drive.google.com/uc?id=${id}`;
var BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
var MAX_HOPS = 4;
var DEFAULT_MAX_BYTES = 8 * 1024 ** 3;
var READ_CHUNK = 1024 ** 2;
var DOWNLOAD_HOSTS = /* @__PURE__ */ new Set([
  "drive.google.com",
  "docs.google.com",
  "drive.usercontent.google.com"
]);
var DOWNLOAD_HOST_SUFFIX = ".googleusercontent.com";
var FOLDER_RE = /(?:drive\/)?folders\//;
var FILE_PATH_RE = /^\/file\/(?:u\/[0-9]+\/)?d\/([^/]+)(?:\/(?:edit|view|preview))?\/?$/;
var HREF_RE = /href="(\/uc\?export=download[^"]+)"/;
var DOWNLOAD_URL_JSON_RE = /"downloadUrl":"([^"]+)"/;
var ERROR_CAPTION_RE = /<p class="uc-error-subcaption">([\s\S]*?)<\/p>/;
function isNode() {
  return typeof process !== "undefined" && !!process?.versions?.node;
}
function parseGdrive(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(
      `Could not parse a Google Drive file ID from URL: ${redactUrl(url)}`
    );
  }
  if (FOLDER_RE.test(u.pathname)) {
    throw new Error(
      `Google Drive folder URLs are not supported: ${redactUrl(url)}`
    );
  }
  const idParam = u.searchParams.get("id");
  if (idParam) return idParam;
  const m = FILE_PATH_RE.exec(u.pathname);
  if (m) return m[1];
  throw new Error(
    `Could not parse a Google Drive file ID from URL: ${redactUrl(url)}`
  );
}
function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
function parseDownloadForm(html) {
  if (typeof DOMParser !== "undefined") {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const form = doc.querySelector(
        'form#download-form, form[id="download-form"]'
      );
      if (form) {
        const action = form.getAttribute("action") ?? "";
        if (action) {
          const target2 = new URL(action);
          const inputs = form.querySelectorAll("input");
          inputs.forEach((input) => {
            const name = input.getAttribute("name");
            if (!name) return;
            target2.searchParams.set(name, input.getAttribute("value") ?? "");
          });
          return target2.toString();
        }
      }
    } catch {
    }
  }
  const formMatch = /<form[^>]*id="download-form"[^>]*>([\s\S]*?)<\/form>/i.exec(html) ?? /<form[^>]*\bid='download-form'[^>]*>([\s\S]*?)<\/form>/i.exec(html);
  if (!formMatch) return null;
  const formTag = /<form[^>]*id=["']download-form["'][^>]*>/i.exec(html)?.[0];
  const actionMatch = formTag ? /action=["']([^"']+)["']/i.exec(formTag) : null;
  if (!actionMatch) return null;
  let target;
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
function urlFromConfirmation(html, url = "") {
  const href = HREF_RE.exec(html);
  if (href) {
    return "https://docs.google.com" + href[1].replace(/&amp;/g, "&");
  }
  const form = parseDownloadForm(html);
  if (form) return form;
  const json = DOWNLOAD_URL_JSON_RE.exec(html);
  if (json) {
    return json[1].replace(/\\u003d/g, "=").replace(/\\u0026/g, "&");
  }
  const err = ERROR_CAPTION_RE.exec(html);
  if (err) {
    const caption = stripTags(err[1]);
    throw new RemoteIOError({
      message: `Google Drive refused the download: ${caption} (if quota, retry later; if permission, set sharing to 'Anyone with the link')`,
      url,
      status: null
    });
  }
  throw new Error(
    "Could not find a Google Drive download link in the confirmation page"
  );
}
function checkDownloadHost(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new RemoteIOError({
      message: `Refusing to follow a Google Drive redirect to an unexpected host: ${redactUrl(url)}`,
      url,
      status: null
    });
  }
  const scheme = u.protocol.replace(/:$/, "").toLowerCase();
  const host = u.hostname.toLowerCase();
  const allowed = (scheme === "http" || scheme === "https") && (DOWNLOAD_HOSTS.has(host) || host.endsWith(DOWNLOAD_HOST_SUFFIX));
  if (!allowed) {
    throw new RemoteIOError({
      message: `Refusing to follow a Google Drive redirect to an unexpected host: ${redactUrl(url)}`,
      url,
      status: null
    });
  }
}
async function readBodyCapped(response, cap, url) {
  const len = response.headers.get("Content-Length");
  if (len && Number(len) > cap) {
    throw new RemoteIOError({
      message: `Google Drive file exceeds the maximum in-memory download size (cap=${cap}, Content-Length=${len})`,
      url,
      status: null
    });
  }
  const chunks = [];
  let total = 0;
  const overflow = () => {
    chunks.length = 0;
    throw new RemoteIOError({
      message: `Google Drive file exceeds the maximum in-memory download size (cap=${cap})`,
      url,
      status: null
    });
  };
  const body = response.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > cap) overflow();
        chunks.push(value);
      }
    }
  } else {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > cap) overflow();
    return buf;
  }
  void READ_CHUNK;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
function extractCookie(response) {
  const getSetCookie = response.headers.getSetCookie;
  let raw = null;
  if (typeof getSetCookie === "function") {
    const all = getSetCookie.call(response.headers);
    if (all?.length) raw = all.join(", ");
  }
  if (!raw) raw = response.headers.get("set-cookie");
  if (!raw) return null;
  const pairs = raw.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0].trim()).filter(Boolean);
  return pairs.length ? pairs.join("; ") : null;
}
async function openGdrive(url, options) {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const fileId = parseGdrive(url);
  let current = UC_URL_TEMPLATE(fileId);
  const baseHeaders = {};
  for (const [k, v] of Object.entries(options?.headers ?? {})) {
    if (SENSITIVE_HEADERS.has(k.toLowerCase())) continue;
    baseHeaders[k] = v;
  }
  baseHeaders["User-Agent"] = BROWSER_UA;
  const node = isNode();
  let cookie = null;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    checkDownloadHost(current);
    const headers = { ...baseHeaders };
    if (node && cookie) headers["Cookie"] = cookie;
    let response = await fetchRetrying(
      current,
      node ? { headers, redirect: "manual" } : { headers }
    );
    if (node) {
      let redirects = 0;
      while (response.status >= 300 && response.status < 400 && redirects < MAX_HOPS) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, current).toString();
        checkDownloadHost(next);
        const setCookie2 = extractCookie(response);
        if (setCookie2) cookie = cookie ? `${cookie}; ${setCookie2}` : setCookie2;
        const hopHeaders = { ...baseHeaders };
        if (cookie) hopHeaders["Cookie"] = cookie;
        current = next;
        response = await fetchRetrying(current, {
          headers: hopHeaders,
          redirect: "manual"
        });
        redirects++;
      }
      const setCookie = extractCookie(response);
      if (setCookie) cookie = cookie ? `${cookie}; ${setCookie}` : setCookie;
    }
    if (!response.ok) {
      raiseRemote(current, void 0, response.status);
    }
    const contentDisposition = response.headers.get("Content-Disposition");
    const contentType = response.headers.get("Content-Type") ?? "";
    if (contentDisposition || !contentType.startsWith("text/html")) {
      return readBodyCapped(response, maxBytes, current);
    }
    const html = await response.text();
    current = urlFromConfirmation(html, current);
  }
  throw new RemoteIOError({
    message: `Google Drive download did not converge within ${MAX_HOPS} hops`,
    url,
    status: null
  });
}

export {
  DEFAULT_MAX_BYTES,
  parseGdrive,
  urlFromConfirmation,
  checkDownloadHost,
  openGdrive
};
