# sleap-io.js 3D Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the Python sleap-io `eric/3d-standardization` branch's Identity, Instance3D, and serialization changes to sleap-io.js, achieving full format parity for SLP files with 3D data and identity support.

**Architecture:** Add three new model classes (Identity, Instance3D, PredictedInstance3D), extend InstanceGroup and Labels with identity/3D fields, and update the SLP codec (read.ts, write.ts) to serialize/deserialize `identities_json`, `identity_idx`, and Instance3D data. Format version bumps to 1.9 when identities are present.

**Tech Stack:** TypeScript, vitest, h5wasm (HDF5), tsup (bundler)

**Repository:** `/root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js` (branch: create `eric/3d-standardization` from `main`)

---

### Task 1: Create branch and add Identity class

**Files:**
- Create: `src/model/identity.ts`
- Test: `tests/model/identity.test.ts`

- [ ] **Step 1: Create the feature branch**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git checkout -b eric/3d-standardization
```

- [ ] **Step 2: Write the Identity test**

```typescript
// tests/model/identity.test.ts
/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Identity } from "../src/model/identity.js";

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/identity.test.ts`
Expected: FAIL — cannot resolve `../src/model/identity.js`

- [ ] **Step 4: Implement Identity class**

```typescript
// src/model/identity.ts
export class Identity {
  name: string;
  color?: string;
  metadata: Record<string, unknown>;

  constructor(options?: { name?: string; color?: string; metadata?: Record<string, unknown> }) {
    this.name = options?.name ?? "";
    this.color = options?.color;
    this.metadata = options?.metadata ?? {};
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/identity.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/model/identity.ts tests/model/identity.test.ts
git commit -m "feat: add Identity class for ground-truth animal identity"
```

---

### Task 2: Add Instance3D and PredictedInstance3D classes

**Files:**
- Create: `src/model/instance3d.ts`
- Test: `tests/model/instance3d.test.ts`

- [ ] **Step 1: Write the Instance3D tests**

```typescript
// tests/model/instance3d.test.ts
/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Instance3D, PredictedInstance3D } from "../src/model/instance3d.js";
import { Skeleton } from "../src/model/skeleton.js";

const skeleton = new Skeleton({ nodes: ["nose", "ear", "tail"], edges: [["nose", "ear"], ["ear", "tail"]] });

describe("Instance3D", () => {
  it("creates with 3D points", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.points).toEqual(pts);
    expect(inst.skeleton).toBe(skeleton);
    expect(inst.score).toBeUndefined();
    expect(inst.metadata).toEqual({});
  });

  it("nVisible counts non-NaN points", () => {
    const pts = [[1, 2, 3], [NaN, NaN, NaN], [7, 8, 9]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.nVisible).toBe(2);
  });

  it("isEmpty is true when all NaN", () => {
    const pts = [[NaN, NaN, NaN], [NaN, NaN, NaN], [NaN, NaN, NaN]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.isEmpty).toBe(true);
  });

  it("isEmpty is false when any point is valid", () => {
    const pts = [[NaN, NaN, NaN], [1, 2, 3], [NaN, NaN, NaN]];
    const inst = new Instance3D({ points: pts, skeleton });
    expect(inst.isEmpty).toBe(false);
  });

  it("nVisible is 0 when points is null", () => {
    const inst = new Instance3D({ points: null, skeleton });
    expect(inst.nVisible).toBe(0);
    expect(inst.isEmpty).toBe(true);
  });

  it("creates with optional score", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const inst = new Instance3D({ points: pts, skeleton, score: 0.95 });
    expect(inst.score).toBe(0.95);
  });
});

describe("PredictedInstance3D", () => {
  it("extends Instance3D with pointScores", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const scores = [0.9, 0.8, 0.7];
    const inst = new PredictedInstance3D({ points: pts, skeleton, score: 0.85, pointScores: scores });
    expect(inst.points).toEqual(pts);
    expect(inst.score).toBe(0.85);
    expect(inst.pointScores).toEqual(scores);
    expect(inst).toBeInstanceOf(Instance3D);
  });

  it("pointScores defaults to undefined", () => {
    const pts = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const inst = new PredictedInstance3D({ points: pts, skeleton });
    expect(inst.pointScores).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/instance3d.test.ts`
Expected: FAIL — cannot resolve `../src/model/instance3d.js`

- [ ] **Step 3: Implement Instance3D and PredictedInstance3D**

```typescript
// src/model/instance3d.ts
import { Skeleton } from "./skeleton.js";

export class Instance3D {
  points: number[][] | null;
  skeleton: Skeleton;
  score?: number;
  metadata: Record<string, unknown>;

  constructor(options: {
    points: number[][] | null;
    skeleton: Skeleton;
    score?: number;
    metadata?: Record<string, unknown>;
  }) {
    this.points = options.points;
    this.skeleton = options.skeleton;
    this.score = options.score;
    this.metadata = options?.metadata ?? {};
  }

  get nVisible(): number {
    if (!this.points) return 0;
    return this.points.filter((p) => !p.some(Number.isNaN)).length;
  }

  get isEmpty(): boolean {
    return this.nVisible === 0;
  }
}

export class PredictedInstance3D extends Instance3D {
  pointScores?: number[];

  constructor(options: {
    points: number[][] | null;
    skeleton: Skeleton;
    score?: number;
    pointScores?: number[];
    metadata?: Record<string, unknown>;
  }) {
    super(options);
    this.pointScores = options.pointScores;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/instance3d.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/model/instance3d.ts tests/model/instance3d.test.ts
git commit -m "feat: add Instance3D and PredictedInstance3D classes"
```

---

### Task 3: Add identity and instance3d fields to InstanceGroup

**Files:**
- Modify: `src/model/camera.ts:84-111` (InstanceGroup class)
- Test: `tests/model/camera-3d.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/model/camera-3d.test.ts
/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } from "../src/model/camera.js";
import { Identity } from "../src/model/identity.js";
import { Instance3D, PredictedInstance3D } from "../src/model/instance3d.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";

const skeleton = new Skeleton({ nodes: ["A", "B"], edges: [["A", "B"]] });

describe("InstanceGroup with identity and instance3d", () => {
  it("identity defaults to undefined", () => {
    const group = new InstanceGroup({ instanceByCamera: new Map() });
    expect(group.identity).toBeUndefined();
  });

  it("accepts identity in constructor", () => {
    const identity = new Identity({ name: "mouse_A", color: "#ff0000" });
    const group = new InstanceGroup({ instanceByCamera: new Map(), identity });
    expect(group.identity).toBe(identity);
  });

  it("instance3d defaults to undefined", () => {
    const group = new InstanceGroup({ instanceByCamera: new Map() });
    expect(group.instance3d).toBeUndefined();
  });

  it("accepts Instance3D in constructor", () => {
    const inst3d = new Instance3D({ points: [[1, 2, 3], [4, 5, 6]], skeleton });
    const group = new InstanceGroup({ instanceByCamera: new Map(), instance3d: inst3d });
    expect(group.instance3d).toBe(inst3d);
    expect(group.points).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it("points getter delegates to instance3d when present", () => {
    const inst3d = new Instance3D({ points: [[10, 20, 30]], skeleton: new Skeleton({ nodes: ["A"] }) });
    const group = new InstanceGroup({ instanceByCamera: new Map(), instance3d: inst3d });
    expect(group.points).toEqual([[10, 20, 30]]);
  });

  it("points getter returns raw points when no instance3d", () => {
    const group = new InstanceGroup({ instanceByCamera: new Map(), points: [[1, 2, 3]] });
    expect(group.points).toEqual([[1, 2, 3]]);
    expect(group.instance3d).toBeUndefined();
  });

  it("accepts PredictedInstance3D", () => {
    const inst3d = new PredictedInstance3D({
      points: [[1, 2, 3], [4, 5, 6]],
      skeleton,
      score: 0.9,
      pointScores: [0.95, 0.85],
    });
    const group = new InstanceGroup({ instanceByCamera: new Map(), instance3d: inst3d });
    expect(group.instance3d).toBeInstanceOf(PredictedInstance3D);
    expect((group.instance3d as PredictedInstance3D).pointScores).toEqual([0.95, 0.85]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/camera-3d.test.ts`
Expected: FAIL — `identity` and `instance3d` not recognized

- [ ] **Step 3: Update InstanceGroup in camera.ts**

In `src/model/camera.ts`, add imports at line 1 and update the InstanceGroup class:

Add to the top of the file:
```typescript
import { Identity } from "./identity.js";
import { Instance3D } from "./instance3d.js";
```

Replace the entire InstanceGroup class (lines 84-111) with:

```typescript
export class InstanceGroup {
  instanceByCamera: Map<Camera, Instance>;
  score?: number;
  identity?: Identity;
  instance3d?: Instance3D;
  metadata: Record<string, unknown>;
  private _points?: number[][];

  constructor(options: {
    instanceByCamera: Map<Camera, Instance> | Record<string, Instance>;
    score?: number;
    points?: number[][];
    identity?: Identity;
    instance3d?: Instance3D;
    metadata?: Record<string, unknown>;
  }) {
    this.instanceByCamera = options.instanceByCamera instanceof Map ? options.instanceByCamera : new Map();
    if (!(options.instanceByCamera instanceof Map)) {
      for (const [key, value] of Object.entries(options.instanceByCamera)) {
        const camera = key as unknown as Camera;
        this.instanceByCamera.set(camera, value);
      }
    }
    this.score = options.score;
    this.identity = options.identity;
    this.instance3d = options.instance3d;
    this._points = options.points;
    this.metadata = options.metadata ?? {};
  }

  get points(): number[][] | undefined {
    if (this.instance3d?.points) return this.instance3d.points;
    return this._points;
  }

  set points(value: number[][] | undefined) {
    this._points = value;
  }

  get instances(): Instance[] {
    return Array.from(this.instanceByCamera.values());
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/camera-3d.test.ts`
Expected: PASS

- [ ] **Step 5: Run all existing tests to verify no regressions**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run`
Expected: All existing tests PASS (the `points` field is now a getter/setter but behaves identically for existing code)

- [ ] **Step 6: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/model/camera.ts tests/model/camera-3d.test.ts
git commit -m "feat: add identity and instance3d fields to InstanceGroup"
```

---

### Task 4: Add identities field to Labels

**Files:**
- Modify: `src/model/labels.ts:1-53` (imports and constructor)
- Test: `tests/model/labels-identities.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/model/labels-identities.test.ts
/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import { Identity } from "../src/model/identity.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/labels-identities.test.ts`
Expected: FAIL — `identities` not a recognized property

- [ ] **Step 3: Add identities to Labels**

In `src/model/labels.ts`:

Add import at line 2 (after existing imports):
```typescript
import { Identity } from "./identity.js";
```

Add field declaration after line 24 (`bboxes: BoundingBox[];`):
```typescript
  identities: Identity[];
```

Add to constructor options type (after `bboxes?` line):
```typescript
    identities?: Identity[];
```

Add initialization in constructor body (after `this.bboxes` line):
```typescript
    this.identities = options?.identities ?? [];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/model/labels-identities.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/model/labels.ts tests/model/labels-identities.test.ts
git commit -m "feat: add identities field to Labels"
```

---

### Task 5: Update exports

**Files:**
- Modify: `src/index.ts:13` (add export line)
- Modify: `src/index.browser.ts:13` (add export line)

- [ ] **Step 1: Add exports to both entry points**

In `src/index.ts`, add after line 13 (`export * from "./model/camera.js";`):
```typescript
export * from "./model/identity.js";
export * from "./model/instance3d.js";
```

In `src/index.browser.ts`, add after line 13 (`export * from "./model/camera.js";`):
```typescript
export * from "./model/identity.js";
export * from "./model/instance3d.js";
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx tsup src/index.ts src/index.browser.ts src/lite.ts --format esm --dts --external skia-canvas`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/index.ts src/index.browser.ts
git commit -m "feat: export Identity, Instance3D, PredictedInstance3D from entry points"
```

---

### Task 6: Update SLP writer — identities and instance3d serialization

**Files:**
- Modify: `src/codecs/slp/write.ts:1-11` (imports)
- Modify: `src/codecs/slp/write.ts:59-77` (writeSlpToFile)
- Modify: `src/codecs/slp/write.ts:161-187` (writeMetadata format version)
- Modify: `src/codecs/slp/write.ts:299-305` (writeSessions signature)
- Modify: `src/codecs/slp/write.ts:307-345` (serializeSession)
- Modify: `src/codecs/slp/write.ts:347-368` (serializeFrameGroup)
- Modify: `src/codecs/slp/write.ts:370-384` (serializeInstanceGroup)
- Add new function: `writeIdentities`
- Test: `tests/slp-write-3d.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/slp-write-3d.test.ts
/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } from "../src/model/camera.js";
import { Identity } from "../src/model/identity.js";
import { Instance3D, PredictedInstance3D } from "../src/model/instance3d.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { readSlp } from "../src/codecs/slp/read.js";

function makeTestLabels(options?: { withIdentity?: boolean; withInstance3d?: boolean; withPredicted3d?: boolean }): Labels {
  const skeleton = new Skeleton({ nodes: ["nose", "tail"], edges: [["nose", "tail"]] });
  const video1 = new Video({ filename: "cam1.mp4" });
  const video2 = new Video({ filename: "cam2.mp4" });
  const cam1 = new Camera({ name: "cam1", rvec: [0, 0, 0], tvec: [0, 0, 0] });
  const cam2 = new Camera({ name: "cam2", rvec: [0.1, 0, 0], tvec: [100, 0, 0] });

  const inst1 = Instance.fromArray([[100, 200], [300, 400]], skeleton);
  const inst2 = Instance.fromArray([[150, 250], [350, 450]], skeleton);

  const lf1 = new LabeledFrame({ video: video1, frameIdx: 0, instances: [inst1] });
  const lf2 = new LabeledFrame({ video: video2, frameIdx: 0, instances: [inst2] });

  const identity = options?.withIdentity ? new Identity({ name: "mouse_A", color: "#ff0000" }) : undefined;
  const identities = identity ? [identity] : [];

  let instance3d: Instance3D | undefined;
  if (options?.withPredicted3d) {
    instance3d = new PredictedInstance3D({
      points: [[50, 100, 200], [150, 300, 400]],
      skeleton,
      score: 0.92,
      pointScores: [0.95, 0.88],
    });
  } else if (options?.withInstance3d) {
    instance3d = new Instance3D({
      points: [[50, 100, 200], [150, 300, 400]],
      skeleton,
      score: 0.92,
    });
  }

  const instanceByCamera = new Map<Camera, Instance>();
  instanceByCamera.set(cam1, inst1);
  instanceByCamera.set(cam2, inst2);
  const group = new InstanceGroup({ instanceByCamera, identity, instance3d });

  const labeledFrameByCamera = new Map<Camera, LabeledFrame>();
  labeledFrameByCamera.set(cam1, lf1);
  labeledFrameByCamera.set(cam2, lf2);
  const frameGroup = new FrameGroup({ frameIdx: 0, instanceGroups: [group], labeledFrameByCamera });

  const cameraGroup = new CameraGroup({ cameras: [cam1, cam2] });
  const session = new RecordingSession({ cameraGroup });
  session.addVideo(video1, cam1);
  session.addVideo(video2, cam2);
  session.frameGroups.set(0, frameGroup);

  return new Labels({
    labeledFrames: [lf1, lf2],
    videos: [video1, video2],
    skeletons: [skeleton],
    sessions: [session],
    identities,
  });
}

describe("SLP write with identity and 3D data", () => {
  it("round-trips identity through write and read", async () => {
    const labels = makeTestLabels({ withIdentity: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.identities).toHaveLength(1);
    expect(loaded.identities[0].name).toBe("mouse_A");
    expect(loaded.identities[0].color).toBe("#ff0000");

    expect(loaded.sessions).toHaveLength(1);
    const session = loaded.sessions[0];
    const frameGroup = session.frameGroups.get(0);
    expect(frameGroup).toBeDefined();
    expect(frameGroup!.instanceGroups).toHaveLength(1);
    expect(frameGroup!.instanceGroups[0].identity).toBe(loaded.identities[0]);
  });

  it("round-trips Instance3D through write and read", async () => {
    const labels = makeTestLabels({ withInstance3d: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    const session = loaded.sessions[0];
    const frameGroup = session.frameGroups.get(0)!;
    const group = frameGroup.instanceGroups[0];
    expect(group.instance3d).toBeDefined();
    expect(group.instance3d).toBeInstanceOf(Instance3D);
    expect(group.instance3d!.points).toEqual([[50, 100, 200], [150, 300, 400]]);
    expect(group.instance3d!.score).toBe(0.92);
  });

  it("round-trips PredictedInstance3D through write and read", async () => {
    const labels = makeTestLabels({ withPredicted3d: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    const group = loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0];
    expect(group.instance3d).toBeInstanceOf(PredictedInstance3D);
    const pred = group.instance3d as PredictedInstance3D;
    expect(pred.score).toBe(0.92);
    expect(pred.pointScores).toEqual([0.95, 0.88]);
  });

  it("sets format version to 1.9 when identities are present", async () => {
    const labels = makeTestLabels({ withIdentity: true });
    const bytes = await saveSlpToBytes(labels);
    // Read back and check format_id in metadata
    const { openH5File } = await import("../src/codecs/slp/h5.js");
    const { file, close } = await openH5File(new Uint8Array(bytes).buffer);
    try {
      const metadataGroup = file.get("metadata");
      const attrs = (metadataGroup as any).attrs ?? {};
      const formatId = Number(attrs["format_id"]?.value ?? attrs["format_id"]);
      expect(formatId).toBeCloseTo(1.9);
    } finally {
      close();
    }
  });

  it("writes no identities_json dataset when no identities", async () => {
    const labels = makeTestLabels();
    const bytes = await saveSlpToBytes(labels);
    const { openH5File } = await import("../src/codecs/slp/h5.js");
    const { file, close } = await openH5File(new Uint8Array(bytes).buffer);
    try {
      const ds = file.get("identities_json");
      expect(ds).toBeNull();
    } finally {
      close();
    }
  });

  it("round-trips identity + instance3d together", async () => {
    const labels = makeTestLabels({ withIdentity: true, withInstance3d: true });
    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.identities).toHaveLength(1);
    const group = loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0];
    expect(group.identity).toBe(loaded.identities[0]);
    expect(group.instance3d).toBeDefined();
    expect(group.instance3d!.points).toEqual([[50, 100, 200], [150, 300, 400]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/slp-write-3d.test.ts`
Expected: FAIL — identities not written/read

- [ ] **Step 3: Update write.ts imports**

At the top of `src/codecs/slp/write.ts`, add:
```typescript
import { Identity } from "../../model/identity.js";
import { Instance3D, PredictedInstance3D } from "../../model/instance3d.js";
```

- [ ] **Step 4: Add writeIdentities function**

Add after the `writeSessions` function (after line 305):

```typescript
function writeIdentities(file: any, identities: Identity[]): void {
  if (!identities.length) return;
  const payload = identities.map((identity) => {
    const d: Record<string, unknown> = { name: identity.name };
    if (identity.color != null) d.color = identity.color;
    Object.assign(d, identity.metadata);
    return JSON.stringify(d);
  });
  file.create_dataset({ name: "identities_json", data: payload });
}
```

- [ ] **Step 5: Fix source-mode Labels copy to include identities**

In `saveSlpToBytes` (around line 107), the `source` embed mode creates a copy of Labels but omits `identities`. Add it:

In the `new Labels({...})` call inside the `if (embedMode === "source")` block, add after `provenance: labels.provenance,`:
```typescript
      identities: labels.identities,
```

- [ ] **Step 6: Update writeSlpToFile**

In `writeSlpToFile` (line 59), add the `writeIdentities` call and update `writeSessions`:

Replace:
```typescript
  writeTracks(file, labels.tracks);
  writeSuggestions(file, labels.suggestions, labels.videos);
  writeSessions(file, labels.sessions, labels.videos, labels.labeledFrames);
```

With:
```typescript
  writeTracks(file, labels.tracks);
  writeSuggestions(file, labels.suggestions, labels.videos);
  writeIdentities(file, labels.identities);
  writeSessions(file, labels.sessions, labels.videos, labels.labeledFrames, labels.identities);
```

- [ ] **Step 7: Update writeMetadata format version logic**

In `writeMetadata` (line 161), replace the format version block (lines 174-181):

Replace:
```typescript
  const hasRoiInstance = labels.rois.some((roi) => roi.instance !== null);
  const formatId = (labels.bboxes?.length ?? 0) > 0
    ? 1.7
    : hasRoiInstance
      ? 1.6
      : (labels.rois.length > 0 || labels.masks.length > 0)
        ? 1.5
        : FORMAT_ID;
```

With:
```typescript
  const hasRoiInstance = labels.rois.some((roi) => roi.instance !== null);
  const hasIdentities = (labels.identities?.length ?? 0) > 0;
  let formatId = (labels.bboxes?.length ?? 0) > 0
    ? 1.7
    : hasRoiInstance
      ? 1.6
      : (labels.rois.length > 0 || labels.masks.length > 0)
        ? 1.5
        : FORMAT_ID;
  if (hasIdentities) {
    formatId = Math.max(formatId, 1.9);
  }
```

- [ ] **Step 8: Update writeSessions signature to accept identities**

Replace `writeSessions` (line 299):

```typescript
function writeSessions(file: any, sessions: RecordingSession[], videos: Video[], labeledFrames: LabeledFrame[], identities?: Identity[]): void {
  const labeledFrameIndex = new Map<LabeledFrame, number>();
  labeledFrames.forEach((lf, idx) => labeledFrameIndex.set(lf, idx));

  const payload = sessions.map((session) => JSON.stringify(serializeSession(session, videos, labeledFrameIndex, identities)));
  file.create_dataset({ name: "sessions_json", data: payload });
}
```

- [ ] **Step 9: Update serializeSession to pass identities through**

Replace `serializeSession` signature (line 307):

```typescript
function serializeSession(
  session: RecordingSession,
  videos: Video[],
  labeledFrameIndex: Map<LabeledFrame, number>,
  identities?: Identity[]
): Record<string, unknown> {
```

And update the `frame_group_dicts` loop (around line 336):

Replace:
```typescript
    frame_group_dicts.push(serializeFrameGroup(frameGroup, session, labeledFrameIndex));
```

With:
```typescript
    frame_group_dicts.push(serializeFrameGroup(frameGroup, session, labeledFrameIndex, identities));
```

- [ ] **Step 10: Update serializeFrameGroup to pass identities through**

Replace `serializeFrameGroup` signature (line 347):

```typescript
function serializeFrameGroup(
  frameGroup: FrameGroup,
  session: RecordingSession,
  labeledFrameIndex: Map<LabeledFrame, number>,
  identities?: Identity[]
): Record<string, unknown> {
```

And update the instance_groups mapping (line 352):

Replace:
```typescript
  const instance_groups = frameGroup.instanceGroups.map((group) => serializeInstanceGroup(group, session));
```

With:
```typescript
  const instance_groups = frameGroup.instanceGroups.map((group) => serializeInstanceGroup(group, session, identities));
```

- [ ] **Step 11: Update serializeInstanceGroup to write identity_idx and instance3d fields**

Replace `serializeInstanceGroup` (line 370):

```typescript
function serializeInstanceGroup(group: InstanceGroup, session: RecordingSession, identities?: Identity[]): Record<string, unknown> {
  const instances: Record<string, Record<string, number[]>> = {};
  for (const [camera, instance] of group.instanceByCamera.entries()) {
    const cameraKey = cameraKeyForSession(camera, session);
    instances[cameraKey] = pointsToDict(instance);
  }

  const payload: Record<string, unknown> = {
    instances,
  };
  if (group.score != null) payload.score = group.score;

  // 3D points — serialize from Instance3D if present, otherwise raw points
  if (group.instance3d) {
    if (group.instance3d.points) {
      payload.points = group.instance3d.points;
    }
    if (group.instance3d.score != null) {
      payload.instance_3d_score = group.instance3d.score;
    }
    if (group.instance3d instanceof PredictedInstance3D && group.instance3d.pointScores) {
      payload.instance_3d_point_scores = group.instance3d.pointScores;
    }
  } else if (group.points != null) {
    payload.points = group.points;
  }

  // Identity — serialize as index into Labels.identities
  if (group.identity && identities) {
    const identityIdx = identities.indexOf(group.identity);
    if (identityIdx >= 0) {
      payload.identity_idx = identityIdx;
    }
  }

  if (group.metadata && Object.keys(group.metadata).length) payload.metadata = group.metadata;
  return payload;
}
```

- [ ] **Step 12: Run all tests**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run`
Expected: The write tests will still fail (read side not updated yet), but no regressions in existing tests. The write-only tests should pass.

- [ ] **Step 13: Commit the write changes**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/codecs/slp/write.ts
git commit -m "feat: serialize identities and Instance3D to SLP format"
```

---

### Task 7: Update SLP reader — identities and instance3d deserialization

**Files:**
- Modify: `src/codecs/slp/read.ts:1-14` (imports)
- Modify: `src/codecs/slp/read.ts:18-94` (readSlp — pass identities)
- Modify: `src/codecs/slp/read.ts:360-444` (readSessions — reconstruct identity + Instance3D)

- [ ] **Step 1: Update read.ts imports**

At the top of `src/codecs/slp/read.ts`, add:
```typescript
import { Identity } from "../../model/identity.js";
import { Instance3D, PredictedInstance3D } from "../../model/instance3d.js";
```

- [ ] **Step 2: Add readIdentities function**

Add before the `readSessions` function:

```typescript
function readIdentities(dataset: any): Identity[] {
  if (!dataset) return [];
  const values = dataset.value ?? [];
  const identities: Identity[] = [];
  for (const entry of values) {
    const parsed = typeof entry === "string" ? JSON.parse(entry) : JSON.parse(textDecoder.decode(entry));
    const { name, color, ...rest } = parsed;
    identities.push(new Identity({
      name: name ?? "",
      color: color ?? undefined,
      metadata: rest,
    }));
  }
  return identities;
}
```

- [ ] **Step 3: Update readSlp to read identities and pass them to readSessions**

In `readSlp` (line 18), replace line 74:

Replace:
```typescript
    const sessions = readSessions(file.get("sessions_json"), videos, skeletons, labeledFrames);
```

With:
```typescript
    const identities = readIdentities(file.get("identities_json"));
    const sessions = readSessions(file.get("sessions_json"), videos, skeletons, labeledFrames, identities);
```

And in the Labels constructor call (line 79), add identities:

Replace:
```typescript
    return new Labels({
      labeledFrames,
      videos,
      skeletons,
      tracks,
      suggestions,
      sessions,
      provenance: (metadataJson?.provenance as Record<string, unknown>) ?? {},
      rois,
      masks,
      bboxes,
    });
```

With:
```typescript
    return new Labels({
      labeledFrames,
      videos,
      skeletons,
      tracks,
      suggestions,
      sessions,
      identities,
      provenance: (metadataJson?.provenance as Record<string, unknown>) ?? {},
      rois,
      masks,
      bboxes,
    });
```

- [ ] **Step 4: Update readSessions to accept identities and reconstruct Instance3D + identity**

Replace `readSessions` signature (line 360):

```typescript
function readSessions(dataset: any, videos: Video[], skeletons: Skeleton[], labeledFrames: LabeledFrame[], identities?: Identity[]): RecordingSession[] {
```

In the instance group reconstruction loop (around lines 399-418), replace the InstanceGroup creation:

Replace:
```typescript
        const rawPoints = instanceGroupRecord.points;
        const pointsValue = Array.isArray(rawPoints) ? (rawPoints as number[][]) : undefined;
        instanceGroups.push(
          new InstanceGroup({
            instanceByCamera,
            score: instanceGroupRecord.score as number | undefined,
            points: pointsValue,
            metadata: (instanceGroupRecord.metadata as Record<string, unknown> | undefined) ?? {},
          })
        );
```

With:
```typescript
        // Reconstruct Instance3D if 3D points are present
        let instance3d: Instance3D | undefined;
        const rawPoints = instanceGroupRecord.points;
        const pointsValue = Array.isArray(rawPoints) ? (rawPoints as number[][]) : undefined;
        if (pointsValue) {
          const skeleton = skeletons[0] ?? new Skeleton({ nodes: [] });
          const inst3dScore = instanceGroupRecord.instance_3d_score as number | undefined;
          const pointScores = instanceGroupRecord.instance_3d_point_scores as number[] | undefined;
          if (pointScores) {
            instance3d = new PredictedInstance3D({
              points: pointsValue,
              skeleton,
              score: inst3dScore,
              pointScores,
            });
          } else {
            instance3d = new Instance3D({
              points: pointsValue,
              skeleton,
              score: inst3dScore,
            });
          }
        }

        // Resolve identity from identity_idx
        let identity: Identity | undefined;
        const identityIdx = instanceGroupRecord.identity_idx;
        if (identityIdx != null && identities) {
          identity = identities[Number(identityIdx)];
        }

        instanceGroups.push(
          new InstanceGroup({
            instanceByCamera,
            score: instanceGroupRecord.score as number | undefined,
            instance3d,
            identity,
            metadata: (instanceGroupRecord.metadata as Record<string, unknown> | undefined) ?? {},
          })
        );
```

- [ ] **Step 5: Also update readSlpLazy to pass identities**

Find the `readSlpLazy` function and apply the same pattern — read identities and pass to readSessions and Labels constructor. The exact changes mirror readSlp: add `readIdentities` call, pass to `readSessions`, add `identities` to the Labels constructor.

- [ ] **Step 6: Run the round-trip tests**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/slp-write-3d.test.ts`
Expected: All PASS

- [ ] **Step 7: Run all tests**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/codecs/slp/read.ts
git commit -m "feat: deserialize identities and Instance3D from SLP format"
```

---

### Task 8: Backward compatibility — old SLP files without identities

**Files:**
- Test: `tests/slp-read-compat.test.ts`

- [ ] **Step 1: Write backward compatibility test**

```typescript
// tests/slp-read-compat.test.ts
/* @vitest-environment node */
import { describe, it, expect } from "vitest";
import { readSlp } from "../src/codecs/slp/read.js";
import { saveSlpToBytes } from "../src/codecs/slp/write.js";
import { Labels } from "../src/model/labels.js";
import { LabeledFrame } from "../src/model/labeled-frame.js";
import { Instance } from "../src/model/instance.js";
import { Skeleton } from "../src/model/skeleton.js";
import { Video } from "../src/model/video.js";
import { Camera, CameraGroup, InstanceGroup, FrameGroup, RecordingSession } from "../src/model/camera.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const fixtureRoot = fileURLToPath(new URL("./data", import.meta.url));

describe("Backward compatibility", () => {
  it("loads multiview.slp fixture (no identities) without errors", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "multiview.slp"), { openVideos: false });
    expect(labels.identities).toEqual([]);
    if (labels.sessions.length > 0) {
      for (const fg of labels.sessions[0].frameGroups.values()) {
        for (const ig of fg.instanceGroups) {
          expect(ig.identity).toBeUndefined();
        }
      }
    }
  });

  it("loads typical.slp fixture (no sessions) without errors", async () => {
    const labels = await readSlp(path.join(fixtureRoot, "slp", "typical.slp"), { openVideos: false });
    expect(labels.identities).toEqual([]);
    expect(labels.sessions).toEqual([]);
  });

  it("round-trips a session without identities (no identities_json dataset)", async () => {
    const skeleton = new Skeleton({ nodes: ["A"], edges: [] });
    const video = new Video({ filename: "test.mp4" });
    const cam = new Camera({ name: "cam", rvec: [0, 0, 0], tvec: [0, 0, 0] });
    const inst = Instance.fromArray([[10, 20]], skeleton);
    const lf = new LabeledFrame({ video, frameIdx: 0, instances: [inst] });
    const instanceByCamera = new Map<Camera, Instance>();
    instanceByCamera.set(cam, inst);
    const group = new InstanceGroup({ instanceByCamera });
    const lfByCamera = new Map<Camera, LabeledFrame>();
    lfByCamera.set(cam, lf);
    const fg = new FrameGroup({ frameIdx: 0, instanceGroups: [group], labeledFrameByCamera: lfByCamera });
    const session = new RecordingSession({ cameraGroup: new CameraGroup({ cameras: [cam] }) });
    session.addVideo(video, cam);
    session.frameGroups.set(0, fg);
    const labels = new Labels({ labeledFrames: [lf], videos: [video], skeletons: [skeleton], sessions: [session] });

    const bytes = await saveSlpToBytes(labels);
    const loaded = await readSlp(new Uint8Array(bytes).buffer, { openVideos: false });

    expect(loaded.identities).toEqual([]);
    expect(loaded.sessions).toHaveLength(1);
    expect(loaded.sessions[0].frameGroups.get(0)!.instanceGroups[0].identity).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run backward compatibility tests**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/slp-read-compat.test.ts`
Expected: All PASS (if they fail, it means the backward compatibility handling is broken — fix before proceeding)

- [ ] **Step 3: Run full test suite**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add tests/slp-read-compat.test.ts
git commit -m "test: backward compatibility for SLP files without identities"
```

---

### Task 9: Update streaming reader (readSlpLazy) and parsers

**Files:**
- Modify: `src/codecs/slp/read.ts` (readSlpLazy function)
- Modify: `src/codecs/slp/parsers.ts` (parseSessionsMetadata — no changes needed if not used for identity)
- Test: already covered by existing lazy tests + backward compat tests

- [ ] **Step 1: Update readSlpLazy**

Find the `readSlpLazy` function in `src/codecs/slp/read.ts`. Apply the same identity reading pattern as in readSlp:

After the line that reads `sessions_json` (should be similar to line 157), add identity reading:

```typescript
    const identities = readIdentities(file.get("identities_json"));
    const sessions = readSessions(file.get("sessions_json"), videos, skeletons, [], identities);
```

And add `identities` to the Labels constructor in readSlpLazy.

- [ ] **Step 2: Run lazy loading tests**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run tests/lazy.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run`
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git add src/codecs/slp/read.ts
git commit -m "feat: identity support in lazy SLP reader"
```

---

### Task 10: Build and verify distribution

**Files:**
- No new files

- [ ] **Step 1: Run full test suite one final time**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx vitest run`
Expected: All PASS

- [ ] **Step 2: Run TypeScript type checking**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx tsc -p tsconfig.json --noEmit`
Expected: No errors

- [ ] **Step 3: Build the distribution**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && npx tsup src/index.ts src/index.browser.ts src/lite.ts --format esm --dts --external skia-canvas`
Expected: Build succeeds, outputs to `dist/`

- [ ] **Step 4: Verify exports include new classes**

Run: `cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js && node -e "import('./dist/index.js').then(m => { console.log('Identity:', typeof m.Identity); console.log('Instance3D:', typeof m.Instance3D); console.log('PredictedInstance3D:', typeof m.PredictedInstance3D); })"`
Expected: All print `function`

- [ ] **Step 5: Commit build artifacts if needed, tag version**

Do NOT commit dist/ — it's built on demand. Just verify it works.

```bash
cd /root/vast/eric/sleap-3d-gui/scratch/repos/sleap-io.js
git log --oneline eric/3d-standardization ^main
```

Expected: Shows all commits from this plan in order.
