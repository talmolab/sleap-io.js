// Node-only default FS resolver for the merge/matching subsystem (DECISIONS D7).
//
// This module is imported by the Node entry point (`src/index.ts`) and by the
// bun test preload (`bunfig.toml`), but NEVER by the browser entry
// (`src/index.browser.ts`). Keeping
// the `node:fs` reference here — out of the shared `matching.ts` — ensures the
// browser-reachable module graph contains no Node-only imports (issue #70).
//
// Importing this module registers a `node:fs`-backed resolver as the DEFAULT
// (used whenever no explicit override is set via `setFsResolver`). The browser
// bundle never registers one, so its FS helpers degrade to the conservative
// "cannot verify" path.
import * as fs from "node:fs";
import * as nodePath from "node:path";
import { setDefaultFsResolver, type FsResolver } from "./matching.js";

const nodeFsResolver: FsResolver = {
  async exists(path: string): Promise<boolean> {
    try {
      await fs.promises.access(path);
      return true;
    } catch {
      return false;
    }
  },
  async sameFile(path1: string, path2: string): Promise<boolean> {
    // os.path.samefile parity: compare dev + ino. Throws (propagated) if either
    // stat fails, so the caller's try/catch falls through to path comparison.
    const s1 = await fs.promises.stat(path1);
    const s2 = await fs.promises.stat(path2);
    return s1.dev === s2.dev && s1.ino === s2.ino;
  },
  async realpath(path: string): Promise<string> {
    try {
      return await fs.promises.realpath(path);
    } catch {
      // Non-existent path: plain absolute resolution, mirroring Python
      // `Path.resolve()` on a missing file.
      return nodePath.resolve(path);
    }
  },
};

setDefaultFsResolver(nodeFsResolver);

export { nodeFsResolver };
