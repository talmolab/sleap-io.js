/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../../src/model/labels.js";
import { Identity } from "../../src/model/identity.js";

describe("Labels.identities", () => {
  it("defaults to empty array", () => {
    const labels = new Labels();
    expect(labels.identities).toEqual([]);
  });

  it("accepts identities in constructor", () => {
    const ids = [new Identity({ name: "A" }), new Identity({ name: "B" })];
    const labels = new Labels({ identities: ids });
    expect(labels.identities).toHaveLength(2);
    expect(labels.identities[0].name).toBe("A");
  });
});
