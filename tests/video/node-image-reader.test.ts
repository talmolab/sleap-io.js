/**
 * The Node-only default image-bytes reader (`src/video/node-image-reader.ts`)
 * registers a `node:fs`-backed reader as the default for `getImageBytesReader()`,
 * mirroring `node-fs-resolver.ts` / `seq-node.ts`. Importing the module is what
 * performs the registration.
 */
import { describe, it, expect } from "../bun-test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import "../../src/video/node-image-reader.js"; // side-effect: registers default
import { getImageBytesReader } from "../../src/video/image-source.js";

describe("node default image-bytes reader", () => {
  it("reads a file path to its raw bytes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "imgvid-"));
    const p = path.join(dir, "x.bin");
    fs.writeFileSync(p, new Uint8Array([1, 2, 3, 4, 5]));
    const reader = getImageBytesReader();
    expect(reader).not.toBeNull();
    const got = await reader!(p);
    expect(Array.from(got)).toEqual([1, 2, 3, 4, 5]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
