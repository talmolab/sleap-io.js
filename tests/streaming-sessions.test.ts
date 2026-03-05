/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readSlp } from "../src/codecs/slp/read.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

describe("Streaming Sessions", () => {
  it("non-streaming reader loads sessions from multiview.slp", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "multiview.slp"), { openVideos: false });
    expect(labels.sessions.length).toBeGreaterThan(0);
    const session = labels.sessions[0];
    expect(session.cameraGroup.cameras.length).toBeGreaterThan(0);
  });

  it("sessions round-trip through write and read", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "multiview.slp"), { openVideos: false });
    if (labels.sessions.length === 0) return;

    const { saveSlpToBytes } = await import("../src/codecs/slp/write.js");
    const bytes = await saveSlpToBytes(labels);
    const reloaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(reloaded.sessions.length).toBe(labels.sessions.length);
    expect(reloaded.sessions[0].cameraGroup.cameras.length).toBe(labels.sessions[0].cameraGroup.cameras.length);
  });
});
