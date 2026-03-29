/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Identity } from "../../src/model/identity.js";

describe("Identity", () => {
  it("creates with defaults", () => {
    const id = new Identity();
    expect(id.name).toBe("");
    expect(id.color).toBeUndefined();
    expect(id.metadata).toEqual({});
  });

  it("creates with name and color", () => {
    const id = new Identity({ name: "mouse_A", color: "#e6194b" });
    expect(id.name).toBe("mouse_A");
    expect(id.color).toBe("#e6194b");
  });

  it("creates with metadata", () => {
    const id = new Identity({ name: "mouse_B", metadata: { weight: 25.3 } });
    expect(id.metadata).toEqual({ weight: 25.3 });
  });

  it("uses reference equality (not value equality)", () => {
    const a = new Identity({ name: "mouse_A" });
    const b = new Identity({ name: "mouse_A" });
    expect(a).not.toBe(b);
  });
});
