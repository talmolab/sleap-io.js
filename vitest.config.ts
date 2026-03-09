import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "scratch", "docs"],
    setupFiles: ["./src/codecs/slp/h5-node.ts"],
  },
});
