/**
 * Tests for issue #70: Browser entry must not contain Node-only imports.
 *
 * Verifies that the built browser entry point and its shared chunks
 * are free of Node-specific module references (h5wasm/node, node:fs,
 * node:os, node:path, fs, createRequire).
 */
/* @vitest-environment node */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const distDir = resolve(import.meta.dirname, "../dist");

// Node-only patterns that must NOT appear in browser-reachable bundles.
const NODE_ONLY_PATTERNS = [
  /\bimport\(\s*["']h5wasm\/node["']\s*\)/,
  /\bcreateRequire\b/,
  /\bimport\(\s*["']node:fs["']\s*\)/,
  /\bimport\(\s*["']node:os["']\s*\)/,
  /\bimport\(\s*["']node:path["']\s*\)/,
  /\bimport\(\s*["']fs["']\s*\)/,
  /\bfrom\s+["']fs["']/,
  /\bfrom\s+["']node:fs["']/,
];

/**
 * Collect all chunk files that index.browser.js depends on (transitively).
 */
function collectBrowserChunks(): string[] {
  const browserEntry = join(distDir, "index.browser.js");
  if (!existsSync(browserEntry)) return [];

  const seen = new Set<string>();
  const queue = [browserEntry];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const content = readFileSync(file, "utf-8");
    // Match: from "./chunk-XXXX.js" or import("./chunk-XXXX.js")
    const chunkRefs = content.matchAll(/["']\.\/(chunk-[A-Za-z0-9]+\.js)["']/g);
    for (const match of chunkRefs) {
      queue.push(join(distDir, match[1]));
    }
  }

  return Array.from(seen);
}

describe("Browser bundle isolation (issue #70)", () => {
  let browserFiles: string[];

  beforeAll(() => {
    // Ensure dist is built
    if (!existsSync(join(distDir, "index.browser.js"))) {
      execSync("npm run build", { cwd: resolve(distDir, ".."), stdio: "pipe" });
    }
    browserFiles = collectBrowserChunks();
  });

  it("dist/index.browser.js exists", () => {
    expect(existsSync(join(distDir, "index.browser.js"))).toBe(true);
  });

  it("browser entry and shared chunks contain no Node-only imports", () => {
    expect(browserFiles.length).toBeGreaterThan(0);

    for (const filePath of browserFiles) {
      const content = readFileSync(filePath, "utf-8");
      const fileName = filePath.split("/").pop();

      for (const pattern of NODE_ONLY_PATTERNS) {
        const match = content.match(pattern);
        expect(match, `${fileName} contains Node-only import: ${match?.[0]}`).toBeNull();
      }
    }
  });

  it("Node entry (index.js) still contains Node-specific imports", () => {
    const nodeEntry = join(distDir, "index.js");
    const content = readFileSync(nodeEntry, "utf-8");

    // The Node entry should contain h5wasm/node and fs imports
    expect(content).toMatch(/import\(\s*["']h5wasm\/node["']\s*\)/);
    expect(content).toMatch(/import\(\s*["']fs["']\s*\)/);
  });

  it("browser entry does not import h5-node chunk", () => {
    const browserEntry = join(distDir, "index.browser.js");
    const content = readFileSync(browserEntry, "utf-8");

    // The browser entry should NOT reference any h5-node module
    expect(content).not.toMatch(/h5-node/i);
  });
});
