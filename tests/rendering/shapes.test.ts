import { describe, it, expect, vi } from "vitest";
import {
  drawCircle,
  drawSquare,
  drawDiamond,
  drawTriangle,
  drawCross,
  getMarkerFunction,
  MARKER_FUNCTIONS,
} from "../../src/rendering/shapes";

// Mock CanvasRenderingContext2D
function createMockContext(): CanvasRenderingContext2D {
  return {
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
  } as unknown as CanvasRenderingContext2D;
}

describe("shapes", () => {
  describe("drawCircle", () => {
    it("draws a filled circle", () => {
      const ctx = createMockContext();
      drawCircle(ctx, 100, 100, 10, "red");

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.arc).toHaveBeenCalledWith(100, 100, 10, 0, Math.PI * 2);
      expect(ctx.fillStyle).toBe("red");
      expect(ctx.fill).toHaveBeenCalled();
    });

    it("draws edge when edgeColor provided", () => {
      const ctx = createMockContext();
      drawCircle(ctx, 100, 100, 10, "red", "blue", 2);

      expect(ctx.strokeStyle).toBe("blue");
      expect(ctx.lineWidth).toBe(2);
      expect(ctx.stroke).toHaveBeenCalled();
    });

    it("does not stroke when no edgeColor", () => {
      const ctx = createMockContext();
      drawCircle(ctx, 100, 100, 10, "red");

      expect(ctx.stroke).not.toHaveBeenCalled();
    });
  });

  describe("drawSquare", () => {
    it("draws a filled square", () => {
      const ctx = createMockContext();
      drawSquare(ctx, 100, 100, 10, "green");

      expect(ctx.fillStyle).toBe("green");
      expect(ctx.fillRect).toHaveBeenCalledWith(90, 90, 20, 20);
    });

    it("draws edge when edgeColor provided", () => {
      const ctx = createMockContext();
      drawSquare(ctx, 100, 100, 10, "green", "yellow", 3);

      expect(ctx.strokeStyle).toBe("yellow");
      expect(ctx.lineWidth).toBe(3);
      expect(ctx.strokeRect).toHaveBeenCalledWith(90, 90, 20, 20);
    });
  });

  describe("drawDiamond", () => {
    it("draws a filled diamond shape", () => {
      const ctx = createMockContext();
      drawDiamond(ctx, 100, 100, 10, "blue");

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(100, 90); // top
      expect(ctx.lineTo).toHaveBeenCalledWith(110, 100); // right
      expect(ctx.lineTo).toHaveBeenCalledWith(100, 110); // bottom
      expect(ctx.lineTo).toHaveBeenCalledWith(90, 100); // left
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fillStyle).toBe("blue");
      expect(ctx.fill).toHaveBeenCalled();
    });
  });

  describe("drawTriangle", () => {
    it("draws a filled triangle", () => {
      const ctx = createMockContext();
      drawTriangle(ctx, 100, 100, 10, "purple");

      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.moveTo).toHaveBeenCalledWith(100, 90); // top
      expect(ctx.closePath).toHaveBeenCalled();
      expect(ctx.fillStyle).toBe("purple");
      expect(ctx.fill).toHaveBeenCalled();
    });
  });

  describe("drawCross", () => {
    it("draws a cross/plus shape", () => {
      const ctx = createMockContext();
      drawCross(ctx, 100, 100, 10, "orange");

      expect(ctx.strokeStyle).toBe("orange");
      expect(ctx.lineCap).toBe("round");
      // Should draw two lines (horizontal and vertical)
      expect(ctx.beginPath).toHaveBeenCalledTimes(2);
      expect(ctx.stroke).toHaveBeenCalledTimes(2);
    });
  });

  describe("getMarkerFunction", () => {
    it("returns correct function for each shape", () => {
      expect(getMarkerFunction("circle")).toBe(drawCircle);
      expect(getMarkerFunction("square")).toBe(drawSquare);
      expect(getMarkerFunction("diamond")).toBe(drawDiamond);
      expect(getMarkerFunction("triangle")).toBe(drawTriangle);
      expect(getMarkerFunction("cross")).toBe(drawCross);
    });
  });

  describe("MARKER_FUNCTIONS", () => {
    it("contains all marker shapes", () => {
      expect(MARKER_FUNCTIONS.circle).toBe(drawCircle);
      expect(MARKER_FUNCTIONS.square).toBe(drawSquare);
      expect(MARKER_FUNCTIONS.diamond).toBe(drawDiamond);
      expect(MARKER_FUNCTIONS.triangle).toBe(drawTriangle);
      expect(MARKER_FUNCTIONS.cross).toBe(drawCross);
    });

    it("has exactly 5 marker types", () => {
      expect(Object.keys(MARKER_FUNCTIONS)).toHaveLength(5);
    });
  });
});
