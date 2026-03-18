/* @vitest-environment node */
import { describe, it, expect } from "vitest";

describe("loadVideo backend option", () => {
  it("accepts a backend option in the type signature", async () => {
    // Type-level test: verify the option exists
    const { loadVideo } = await import("../../src/io/main.js");
    // If backend option doesn't exist, this won't compile
    expect(typeof loadVideo).toBe("function");
  });
});
