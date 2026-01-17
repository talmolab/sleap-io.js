// src/rendering/colors.ts

import type { RGB, ColorSpec, PaletteName, ColorScheme } from "./types.js";

/** Named CSS colors */
export const NAMED_COLORS: Record<string, RGB> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  pink: [255, 192, 203],
  brown: [139, 69, 19],
};

/** Built-in color palettes (port from Python sleap_io/rendering/colors.py) */
export const PALETTES: Record<PaletteName, RGB[]> = {
  // MATLAB default colors
  standard: [
    [0, 114, 189],
    [217, 83, 25],
    [237, 177, 32],
    [126, 47, 142],
    [119, 172, 48],
    [77, 190, 238],
    [162, 20, 47],
  ],

  // Tableau 10
  tableau10: [
    [31, 119, 180],
    [255, 127, 14],
    [44, 160, 44],
    [214, 39, 40],
    [148, 103, 189],
    [140, 86, 75],
    [227, 119, 194],
    [127, 127, 127],
    [188, 189, 34],
    [23, 190, 207],
  ],

  // High-contrast distinct colors (Glasbey-inspired, for many instances)
  distinct: [
    [230, 25, 75],
    [60, 180, 75],
    [255, 225, 25],
    [67, 99, 216],
    [245, 130, 49],
    [145, 30, 180],
    [66, 212, 244],
    [240, 50, 230],
    [191, 239, 69],
    [250, 190, 212],
    [70, 153, 144],
    [220, 190, 255],
    [154, 99, 36],
    [255, 250, 200],
    [128, 0, 0],
    [170, 255, 195],
    [128, 128, 0],
    [255, 216, 177],
    [0, 0, 117],
    [169, 169, 169],
  ],

  // Viridis (10 samples)
  viridis: [
    [68, 1, 84],
    [72, 40, 120],
    [62, 74, 137],
    [49, 104, 142],
    [38, 130, 142],
    [31, 158, 137],
    [53, 183, 121],
    [110, 206, 88],
    [181, 222, 43],
    [253, 231, 37],
  ],

  // Rainbow for node coloring
  rainbow: [
    [255, 0, 0],
    [255, 127, 0],
    [255, 255, 0],
    [127, 255, 0],
    [0, 255, 0],
    [0, 255, 127],
    [0, 255, 255],
    [0, 127, 255],
    [0, 0, 255],
    [127, 0, 255],
    [255, 0, 255],
    [255, 0, 127],
  ],

  // Warm colors
  warm: [
    [255, 89, 94],
    [255, 146, 76],
    [255, 202, 58],
    [255, 154, 0],
    [255, 97, 56],
    [255, 50, 50],
  ],

  // Cool colors
  cool: [
    [67, 170, 139],
    [77, 144, 142],
    [87, 117, 144],
    [97, 90, 147],
    [107, 63, 149],
    [117, 36, 152],
  ],

  // Pastel colors
  pastel: [
    [255, 179, 186],
    [255, 223, 186],
    [255, 255, 186],
    [186, 255, 201],
    [186, 225, 255],
    [219, 186, 255],
  ],

  // Seaborn-inspired
  seaborn: [
    [76, 114, 176],
    [221, 132, 82],
    [85, 168, 104],
    [196, 78, 82],
    [129, 114, 179],
    [147, 120, 96],
    [218, 139, 195],
    [140, 140, 140],
    [204, 185, 116],
    [100, 181, 205],
  ],
};

/**
 * Get n colors from a named palette, cycling if needed.
 */
export function getPalette(name: PaletteName | string, n: number): RGB[] {
  const palette = PALETTES[name as PaletteName];
  if (!palette) {
    throw new Error(`Unknown palette: ${name}`);
  }

  if (n <= palette.length) {
    return palette.slice(0, n);
  }

  // Cycle through palette
  return Array.from({ length: n }, (_, i) => palette[i % palette.length]);
}

/**
 * Resolve flexible color specification to RGB tuple.
 */
export function resolveColor(color: ColorSpec): RGB {
  // RGB tuple
  if (Array.isArray(color)) {
    if (color.length >= 3) {
      return [color[0], color[1], color[2]];
    }
    throw new Error(`Invalid color array: ${color}`);
  }

  // Grayscale number
  if (typeof color === "number") {
    const v = Math.round(color);
    return [v, v, v];
  }

  // String formats
  if (typeof color === "string") {
    const s = color.trim().toLowerCase();

    // Named color
    if (s in NAMED_COLORS) {
      return NAMED_COLORS[s];
    }

    // Hex color: #rgb or #rrggbb
    if (s.startsWith("#")) {
      return hexToRgb(s);
    }

    // Palette index: "palette[index]"
    const paletteMatch = s.match(/^(\w+)\[(\d+)\]$/);
    if (paletteMatch) {
      const [, paletteName, indexStr] = paletteMatch;
      const palette = PALETTES[paletteName as PaletteName];
      if (palette) {
        const index = parseInt(indexStr, 10) % palette.length;
        return palette[index];
      }
    }

    // rgb(r, g, b) format
    const rgbMatch = s.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
    if (rgbMatch) {
      return [
        parseInt(rgbMatch[1], 10),
        parseInt(rgbMatch[2], 10),
        parseInt(rgbMatch[3], 10),
      ];
    }
  }

  throw new Error(`Cannot resolve color: ${color}`);
}

/**
 * Convert hex string to RGB.
 */
function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");

  if (h.length === 3) {
    // #rgb -> #rrggbb
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }

  if (h.length === 6) {
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  throw new Error(`Invalid hex color: ${hex}`);
}

/**
 * Convert RGB to CSS color string.
 */
export function rgbToCSS(rgb: RGB, alpha: number = 1): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Determine color scheme based on context.
 * - If tracks available: 'track'
 * - Else if single image: 'instance'
 * - Else: 'node' (prevents flicker in video)
 */
export function determineColorScheme(
  scheme: ColorScheme,
  hasTracks: boolean,
  isSingleImage: boolean
): ColorScheme {
  if (scheme !== "auto") {
    return scheme;
  }

  if (hasTracks) {
    return "track";
  }

  if (isSingleImage) {
    return "instance";
  }

  return "node";
}
