/**
 * Identity catalog interop (SLP 2.5, PR-B I2).
 *
 * The JS writer now emits the Python-compatible `/identity` group (native vlen
 * `name` catalog + optional EAV metadata, with color folded into
 * metadata["color"]) ALONGSIDE the legacy typed `identities_json`. The reader
 * prefers `identities_json` (JS-native, typed) and falls back to `/identity` (on
 * Python-written files). Fixes the pre-existing break where JS and Python did not
 * interoperate on identities at all.
 */
import { describe, it, expect } from "./bun-test";
import { readSlp } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { openH5File } from "../src/codecs/slp/h5.js";
import {
  Camera,
  CameraGroup,
  InstanceGroup,
  FrameGroup,
  RecordingSession,
} from "../src/model/camera.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Identity } from "../src/model/identity.js";

const SK = new Skeleton({ nodes: ["A", "B"], edges: [] });

function labelsWithIdentities(identities: Identity[]): Labels {
  const v1 = new Video({ filename: "c1.mp4" });
  const v2 = new Video({ filename: "c2.mp4" });
  const c1 = new Camera({ name: "c1", rvec: [0, 0, 0], tvec: [0, 0, 0] });
  const c2 = new Camera({ name: "c2", rvec: [0, 0, 0], tvec: [1, 0, 0] });
  const i1 = Instance.fromArray(
    [
      [1, 2],
      [3, 4],
    ],
    SK,
  );
  const i2 = Instance.fromArray(
    [
      [5, 6],
      [7, 8],
    ],
    SK,
  );
  const lf1 = new LabeledFrame({ video: v1, frameIdx: 0, instances: [i1] });
  const lf2 = new LabeledFrame({ video: v2, frameIdx: 0, instances: [i2] });
  const ig = new InstanceGroup({
    instanceByCamera: new Map([
      [c1, i1],
      [c2, i2],
    ]),
    identity: identities[0],
  });
  const fg = new FrameGroup({
    frameIdx: 0,
    instanceGroups: [ig],
    labeledFrameByCamera: new Map([
      [c1, lf1],
      [c2, lf2],
    ]),
  });
  const s = new RecordingSession({
    cameraGroup: new CameraGroup({ cameras: [c1, c2] }),
  });
  s.addVideo(v1, c1);
  s.addVideo(v2, c2);
  s.frameGroups.set(0, fg);
  return new Labels({
    labeledFrames: [lf1, lf2],
    videos: [v1, v2],
    skeletons: [SK],
    sessions: [s],
    identities,
  });
}

describe("Identity catalog (SLP 2.5)", () => {
  it("round-trips the catalog (name + color + metadata) via identities_json", async () => {
    const identities = [
      new Identity({
        name: "mouse_A",
        color: "#ff0000",
        metadata: { sex: "F" },
      }),
      new Identity({ name: "mouse_B", color: "#00ff00" }),
    ];
    const bytes = new Uint8Array(
      await saveSlpToBytes(labelsWithIdentities(identities)),
    );
    const loaded = await readSlp(bytes.buffer as ArrayBuffer, {
      openVideos: false,
    });
    expect(loaded.identities).toHaveLength(2);
    expect(loaded.identities[0].name).toBe("mouse_A");
    expect(loaded.identities[0].color).toBe("#ff0000");
    expect(loaded.identities[0].metadata).toEqual({ sex: "F" });
    expect(loaded.identities[1].name).toBe("mouse_B");
    // InstanceGroup identity still resolves against the catalog.
    const ig = loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0];
    expect(ig.identity).toBe(loaded.identities[0]);
  });

  it("also writes a Python-compatible /identity group (name + EAV metadata)", async () => {
    const identities = [
      new Identity({ name: "A", color: "#abc", metadata: { role: "focal" } }),
    ];
    const bytes = new Uint8Array(
      await saveSlpToBytes(labelsWithIdentities(identities)),
    );
    const { file, close } = await openH5File(bytes.buffer as ArrayBuffer);
    try {
      const nameDs = file.get("identity/name") as any;
      expect(nameDs).toBeTruthy();
      const names = Array.from(nameDs.value as ArrayLike<unknown>).map((n) =>
        typeof n === "string" ? n : new TextDecoder().decode(n as Uint8Array),
      );
      expect(names).toEqual(["A"]);
      // EAV metadata carries role + color (folded in).
      const keys = Array.from(
        (file.get("identity/meta_key") as any).value as ArrayLike<unknown>,
      ).map((k) =>
        typeof k === "string" ? k : new TextDecoder().decode(k as Uint8Array),
      );
      expect(keys).toContain("role");
      expect(keys).toContain("color");
    } finally {
      close();
    }
  });

  it("reads a /identity-only catalog (Python-style, no identities_json)", async () => {
    // Simulate a Python-written file: build a JS file, then drop identities_json so
    // only the /identity group remains, and confirm the reader falls back to it.
    const identities = [
      new Identity({ name: "pyA", color: "#111", metadata: { k: "v" } }),
      new Identity({ name: "pyB" }),
    ];
    const bytes = new Uint8Array(
      await saveSlpToBytes(labelsWithIdentities(identities)),
    );
    const { getH5Module, getH5FileSystem, openH5File } = await import(
      "../src/codecs/slp/h5.js"
    );
    // Rebuild a copy WITHOUT identities_json (keep /identity + everything else).
    const module = await getH5Module();
    const tmp = `/tmp/id_only_${Date.now()}.slp`;
    const dst = new module.File(tmp, "w");
    const { file: src, close: closeSrc } = await openH5File(
      bytes.buffer as ArrayBuffer,
    );
    const enc = new TextEncoder();
    try {
      const copyDs = (name: string) => {
        const d = src.get(name) as any;
        if (!d?.value) return;
        // The pose tables (`instances`/`points`/`pred_points`) are now HDF5
        // COMPOUND datasets (#218). h5wasm's create_dataset takes compound data
        // as a per-member column Map, not the array-of-rows that `.value`
        // returns — pass columns for compound, raw value otherwise.
        const members = d.metadata?.compound_type?.members as
          | { name: string }[]
          | undefined;
        if (members?.length) {
          const rows = d.value as ArrayLike<ArrayLike<unknown>>;
          const columns = new Map<string, unknown[]>();
          members.forEach((m, j) => {
            const col = new Array<unknown>(rows.length);
            for (let i = 0; i < rows.length; i++) col[i] = rows[i][j];
            columns.set(m.name, col);
          });
          dst.create_dataset({
            name,
            data: columns,
            shape: d.shape,
            dtype: d.dtype,
          });
        } else {
          dst.create_dataset({
            name,
            data: d.value,
            shape: d.shape,
            dtype: d.dtype,
          });
        }
        const fn = d.attrs?.field_names;
        if (fn) {
          const s =
            typeof (fn.value ?? fn) === "string"
              ? (fn.value ?? fn)
              : new TextDecoder().decode((fn.value ?? fn) as Uint8Array);
          dst
            .get(name)
            .create_attribute(
              "field_names",
              s,
              null,
              `S${enc.encode(s).length}`,
            );
        }
      };
      // metadata group
      const meta = src.get("metadata") as any;
      dst.create_group("metadata");
      const fmt = meta.attrs?.format_id?.value ?? meta.attrs?.format_id ?? 1.4;
      dst.get("metadata").create_attribute("format_id", Number(fmt));
      const jsonVal = meta.attrs?.json?.value ?? meta.attrs?.json;
      const jsonStr =
        typeof jsonVal === "string"
          ? jsonVal
          : new TextDecoder().decode(jsonVal as Uint8Array);
      dst
        .get("metadata")
        .create_attribute(
          "json",
          jsonStr,
          null,
          `S${enc.encode(jsonStr).length}`,
        );
      for (const n of [
        "videos_json",
        "tracks_json",
        "frames",
        "instances",
        "points",
        "pred_points",
        "sessions_json",
        "identity/name",
        "identity/meta_owner",
        "identity/meta_key",
        "identity/meta_val",
      ]) {
        if (n.startsWith("identity/") && !dst.get("identity"))
          dst.create_group("identity");
        copyDs(n);
      }
      // session_data group (so sessions load)
      const sd = src.get("session_data") as any;
      if (sd) {
        dst.create_group("session_data");
        for (const k of sd.keys() as string[]) copyDs(`session_data/${k}`);
      }
    } finally {
      closeSrc();
    }
    dst.close();
    const fs = getH5FileSystem(module);
    const patched = fs.readFile!(tmp);
    fs.unlink!(tmp);

    const loaded = await readSlp(new Uint8Array(patched).buffer, {
      openVideos: false,
    });
    expect(loaded.identities).toHaveLength(2);
    expect(loaded.identities[0].name).toBe("pyA");
    expect(loaded.identities[0].color).toBe("#111"); // recovered from metadata["color"]
    expect(loaded.identities[0].metadata).toEqual({ k: "v" });
    expect(loaded.identities[1].name).toBe("pyB");
  });
});
