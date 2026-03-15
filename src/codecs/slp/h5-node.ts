/**
 * Node.js-specific HDF5 provider.
 *
 * This module is imported as a side-effect by the Node entry point (index.ts).
 * It registers Node-specific implementations of getH5Module and openH5File
 * so that the shared h5.ts module remains free of Node-only imports
 * (h5wasm/node, node:fs, node:os, node:path).
 *
 * The browser entry point never imports this file, ensuring the browser
 * bundle contains no references to Node built-in modules.
 */
import { _registerNodeH5, type H5Module, type SlpSource, type H5File } from "./h5.js";
import { _registerFileWriter } from "./write.js";

let modulePromise: Promise<H5Module> | null = null;

async function getH5ModuleNode(): Promise<H5Module> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const module = await import("h5wasm/node");
      await module.ready;
      return module as H5Module;
    })();
  }
  return modulePromise;
}

async function openH5FileNode(
  module: H5Module,
  source: SlpSource
): Promise<{ file: H5File; close: () => void }> {
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

// Register Node providers on import (side-effect)
_registerNodeH5(getH5ModuleNode, openH5FileNode);

_registerFileWriter(async (filename: string, bytes: Uint8Array) => {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(filename, bytes);
});
