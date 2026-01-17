import { describe, it, expect } from "vitest";
import {
  getPalette,
  resolveColor,
  rgbToCSS,
  determineColorScheme,
  PALETTES,
  NAMED_COLORS,
} from "../../src/rendering/colors";

describe("colors", () => {
  describe("getPalette", () => {
    it("returns correct number of colors", () => {
      const colors = getPalette("tableau10", 5);
      expect(colors).toHaveLength(5);
    });

    it("returns all colors when n equals palette length", () => {
      const colors = getPalette("tableau10", 10);
      expect(colors).toHaveLength(10);
      expect(colors).toEqual(PALETTES.tableau10);
    });

    it("cycles when requesting more colors than palette has", () => {
      const colors = getPalette("standard", 10);
      expect(colors).toHaveLength(10);
      // Standard palette has 7 colors, so index 7 should cycle back to index 0
      expect(colors[7]).toEqual(PALETTES.standard[0]);
      expect(colors[8]).toEqual(PALETTES.standard[1]);
      expect(colors[9]).toEqual(PALETTES.standard[2]);
    });

    it("throws on unknown palette", () => {
      expect(() => getPalette("nonexistent" as "standard", 5)).toThrow("Unknown palette");
    });

    it("works with all built-in palettes", () => {
      const paletteNames = Object.keys(PALETTES);
      for (const name of paletteNames) {
        const colors = getPalette(name, 3);
        expect(colors).toHaveLength(3);
        for (const color of colors) {
          expect(color).toHaveLength(3);
          expect(color[0]).toBeGreaterThanOrEqual(0);
          expect(color[0]).toBeLessThanOrEqual(255);
        }
      }
    });
  });

  describe("resolveColor", () => {
    it("resolves RGB tuple", () => {
      expect(resolveColor([255, 128, 0])).toEqual([255, 128, 0]);
    });

    it("resolves RGBA tuple (ignores alpha)", () => {
      expect(resolveColor([255, 128, 0, 128])).toEqual([255, 128, 0]);
    });

    it("resolves named color", () => {
      expect(resolveColor("red")).toEqual([255, 0, 0]);
      expect(resolveColor("blue")).toEqual([0, 0, 255]);
      expect(resolveColor("green")).toEqual([0, 255, 0]);
    });

    it("resolves named color case-insensitively", () => {
      expect(resolveColor("RED")).toEqual([255, 0, 0]);
      expect(resolveColor("Red")).toEqual([255, 0, 0]);
    });

    it("resolves hex color (#rrggbb)", () => {
      expect(resolveColor("#ff8000")).toEqual([255, 128, 0]);
      expect(resolveColor("#FF8000")).toEqual([255, 128, 0]);
    });

    it("resolves short hex color (#rgb)", () => {
      expect(resolveColor("#f80")).toEqual([255, 136, 0]);
      expect(resolveColor("#fff")).toEqual([255, 255, 255]);
      expect(resolveColor("#000")).toEqual([0, 0, 0]);
    });

    it("resolves palette index", () => {
      expect(resolveColor("tableau10[0]")).toEqual(PALETTES.tableau10[0]);
      expect(resolveColor("tableau10[5]")).toEqual(PALETTES.tableau10[5]);
    });

    it("resolves palette index with cycling", () => {
      // tableau10 has 10 colors, so index 10 should wrap to 0
      expect(resolveColor("tableau10[10]")).toEqual(PALETTES.tableau10[0]);
    });

    it("resolves grayscale number", () => {
      expect(resolveColor(128)).toEqual([128, 128, 128]);
      expect(resolveColor(0)).toEqual([0, 0, 0]);
      expect(resolveColor(255)).toEqual([255, 255, 255]);
    });

    it("resolves rgb() format", () => {
      expect(resolveColor("rgb(255, 128, 0)")).toEqual([255, 128, 0]);
      expect(resolveColor("rgb(0,0,0)")).toEqual([0, 0, 0]);
    });

    it("throws on invalid color", () => {
      expect(() => resolveColor("notacolor")).toThrow("Cannot resolve color");
      // @ts-expect-error - testing invalid input
      expect(() => resolveColor([1, 2])).toThrow("Invalid color array");
    });

    it("handles all named colors", () => {
      for (const [name, expected] of Object.entries(NAMED_COLORS)) {
        expect(resolveColor(name)).toEqual(expected);
      }
    });
  });

  describe("rgbToCSS", () => {
    it("converts RGB to CSS rgba string", () => {
      expect(rgbToCSS([255, 128, 0])).toBe("rgba(255, 128, 0, 1)");
    });

    it("includes alpha when provided", () => {
      expect(rgbToCSS([255, 128, 0], 0.5)).toBe("rgba(255, 128, 0, 0.5)");
    });

    it("defaults to alpha 1", () => {
      expect(rgbToCSS([0, 0, 0])).toBe("rgba(0, 0, 0, 1)");
    });
  });

  describe("determineColorScheme", () => {
    it("returns specified scheme when not auto", () => {
      expect(determineColorScheme("track", false, false)).toBe("track");
      expect(determineColorScheme("instance", true, true)).toBe("instance");
      expect(determineColorScheme("node", false, false)).toBe("node");
    });

    it("returns track when auto and has tracks", () => {
      expect(determineColorScheme("auto", true, false)).toBe("track");
      expect(determineColorScheme("auto", true, true)).toBe("track");
    });

    it("returns instance when auto, no tracks, and single image", () => {
      expect(determineColorScheme("auto", false, true)).toBe("instance");
    });

    it("returns node when auto, no tracks, and not single image", () => {
      expect(determineColorScheme("auto", false, false)).toBe("node");
    });
  });
});
