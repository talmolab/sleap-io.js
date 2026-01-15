export type H5Module = typeof import("h5wasm");
export type H5File = InstanceType<H5Module["File"]>;

export type SlpSource = string | ArrayBuffer | Uint8Array | File | FileSystemFileHandle;
export type StreamMode = "auto" | "range" | "download";

export type OpenH5Options = {
  stream?: StreamMode;
  filenameHint?: string;
};

type H5FileSystem = {
  writeFile: (path: string, data: Uint8Array) => void;
  readFile?: (path: string) => Uint8Array;
  unlink?: (path: string) => void;
  mkdir?: (path: string) => void;
  rmdir?: (path: string) => void;
  mount?: (fs: unknown, opts: unknown, mountpoint: string) => void;
  unmount?: (mountpoint: string) => void;
  createLazyFile?: (parent: string, name: string, url: string, canRead: boolean, canWrite: boolean) => void;
  filesystems?: Record<string, unknown>;
};

const isNode = typeof process !== "undefined" && !!process.versions?.node;
let modulePromise: Promise<H5Module> | null = null;

export async function getH5Module(): Promise<H5Module> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const module = isNode ? await import("h5wasm/node") : await import("h5wasm");
      await module.ready;
      return module as H5Module;
    })();
  }
  return modulePromise;
}

export async function openH5File(
  source: SlpSource,
  options?: OpenH5Options
): Promise<{ file: H5File; close: () => void }> {
  const module = await getH5Module();

  if (isNode) {
    return openH5FileNode(module, source);
  }

  return openH5FileBrowser(module, source, options);
}

function isProbablyUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isFileHandle(value: SlpSource): value is FileSystemFileHandle {
  return typeof value === "object" && value !== null && "getFile" in value;
}

async function openH5FileNode(module: H5Module, source: SlpSource): Promise<{ file: H5File; close: () => void }> {
  if (typeof source === "string") {
    const file = new module.File(source, "r");
    return { file, close: () => file.close() };
  }

  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);
    const tempPath = join(tmpdir(), `sleap-io-${Date.now()}-${Math.random().toString(16).slice(2)}.slp`);
    writeFileSync(tempPath, data);
    const file = new module.File(tempPath, "r");
    return {
      file,
      close: () => {
        file.close();
        unlinkSync(tempPath);
      },
    };
  }

  throw new Error("Node environments only support string paths or byte buffers for SLP inputs.");
}

async function openH5FileBrowser(
  module: H5Module,
  source: SlpSource,
  options?: OpenH5Options
): Promise<{ file: H5File; close: () => void }> {
  const fs = getH5FileSystem(module);

  if (typeof source === "string" && isProbablyUrl(source)) {
    return openFromUrl(module, fs, source, options);
  }

  if (isFileHandle(source)) {
    const file = await source.getFile();
    return openFromFile(module, fs, file, options);
  }

  if (typeof File !== "undefined" && source instanceof File) {
    return openFromFile(module, fs, source, options);
  }

  if (source instanceof Uint8Array || source instanceof ArrayBuffer) {
    const data = source instanceof Uint8Array ? source : new Uint8Array(source);
    const filename = "/tmp-slp.slp";
    fs.writeFile(filename, data);
    const file = new module.File(filename, "r");
    return { file, close: () => file.close() };
  }

  if (typeof source === "string") {
    return openFromUrl(module, fs, source, options);
  }

  throw new Error("Unsupported SLP source type for browser environment.");
}

async function openFromUrl(
  module: H5Module,
  fs: H5FileSystem,
  url: string,
  options?: OpenH5Options
): Promise<{ file: H5File; close: () => void }> {
  const filename = options?.filenameHint ?? url.split("/").pop()?.split("?")[0] ?? "slp-data.slp";
  const streamMode = options?.stream ?? "auto";

  if (fs.createLazyFile && (streamMode === "auto" || streamMode === "range")) {
    const mountPath = `/slp-remote-${Date.now()}`;
    fs.mkdir?.(mountPath);
    try {
      fs.createLazyFile(mountPath, filename, url, true, false);
      const file = new module.File(`${mountPath}/${filename}`, "r");
      return {
        file,
        close: () => {
          file.close();
          fs.unlink?.(`${mountPath}/${filename}`);
          fs.rmdir?.(mountPath);
        },
      };
    } catch {
      fs.rmdir?.(mountPath);
    }
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch SLP file: ${response.status} ${response.statusText}`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  const localPath = "/tmp-slp.slp";
  fs.writeFile(localPath, buffer);
  const file = new module.File(localPath, "r");
  return { file, close: () => file.close() };
}

async function openFromFile(
  module: H5Module,
  fs: H5FileSystem,
  file: File,
  options?: OpenH5Options
): Promise<{ file: H5File; close: () => void }> {
  const mountPath = `/slp-local-${Date.now()}`;
  fs.mkdir?.(mountPath);
  const filename = options?.filenameHint ?? file.name ?? "local.slp";

  if (fs.mount && fs.filesystems && fs.filesystems.WORKERFS) {
    fs.mount(fs.filesystems.WORKERFS, { files: [file] }, mountPath);
    const filePath = `${mountPath}/${filename}`;
    const h5file = new module.File(filePath, "r");
    return {
      file: h5file,
      close: () => {
        h5file.close();
        fs.unmount?.(mountPath);
        fs.rmdir?.(mountPath);
      },
    };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const localPath = "/tmp-slp.slp";
  fs.writeFile(localPath, buffer);
  const h5file = new module.File(localPath, "r");
  return { file: h5file, close: () => h5file.close() };
}

export function getH5FileSystem(module: H5Module): H5FileSystem {
  const fs = (module as unknown as { FS?: H5FileSystem }).FS;
  if (!fs) {
    throw new Error("h5wasm FS is not available.");
  }
  return fs;
}
