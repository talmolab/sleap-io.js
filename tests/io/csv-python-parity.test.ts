// Checks labelsToCsv against Python sleap-io's CSV for the same .slp files
// (talmolab/sleap-app#464). Fixtures and expected CSVs come from
// tests/data/csv/gen_csv_parity_fixture.py; see that file to regenerate them.

import { describe, it, expect } from "../bun-test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSlp } from "../../src/io/main.js";
import { labelsToCsv } from "../../src/io/csv.js";

const csvDir = fileURLToPath(new URL("../data/csv", import.meta.url));

// Split on \r?\n: git may check the Python fixtures out with CRLF on Windows.
function parse(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(","));
}

/**
 * Compare CSV text cell by cell: same header and row count, empty cells in the
 * same places, numbers equal by value (pandas writes `10.0`, JS writes `10`).
 */
function expectSameCsv(actual: string, expected: string): void {
  const a = parse(actual);
  const e = parse(expected);
  expect(a[0]).toEqual(e[0]);
  expect(a.length).toBe(e.length);
  for (let r = 1; r < e.length; r++) {
    expect(a[r].length).toBe(e[r].length);
    for (let c = 0; c < e[r].length; c++) {
      const ev = e[r][c];
      const av = a[r][c];
      const where = `row ${r} col ${e[0][c]}`;
      if (ev === "" || Number.isNaN(Number(ev))) {
        expect(`${where}: ${av}`).toBe(`${where}: ${ev}`);
      } else {
        expect(`${where}: ${Number(av)}`).toBe(`${where}: ${Number(ev)}`);
      }
    }
  }
}

async function load(name: string) {
  return loadSlp(path.join(csvDir, `${name}.slp`), { openVideos: false });
}

function expected(file: string): string {
  return readFileSync(path.join(csvDir, file), "utf8");
}

describe("labelsToCsv — Python sleap-io parity", () => {
  // Multi-animal project: accepted / same-track predictions dropped, others
  // kept, hidden points empty — same rows as save_csv(format="sleap").
  it("matches save_csv for a tracked multi-animal project", async () => {
    const labels = await load("multi_animal");
    expectSameCsv(labelsToCsv(labels), expected("multi_animal.sleap.csv"));
  });

  // Single-animal project: any user instance replaces the frame's prediction.
  it("matches save_csv for a single-instance project", async () => {
    const labels = await load("single_instance");
    expectSameCsv(labelsToCsv(labels), expected("single_instance.sleap.csv"));
  });

  // Opting out writes every instance, like Python's
  // to_dataframe(prefer_user_instances=False).
  it("matches prefer_user_instances=False with preferUserInstances: false", async () => {
    const labels = await load("multi_animal");
    expectSameCsv(
      labelsToCsv(labels, { preferUserInstances: false }),
      expected("multi_animal.all.csv"),
    );
  });
});
