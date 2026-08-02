// src/video/image-decode.ts
//
// Shared image decode/rasterize helpers, used by both `CropVideoBackend` (to
// rasterize/decode inner frames before cropping) and `ImageVideoBackend` (to
// decode each image-sequence frame).
//
// Browser-safe: this module never statically imports a Node-only decoder.
// Decoding/rasterizing uses `createImageBitmap` + `OffscreenCanvas` when
// available (browser) else a lazy dynamic `import("skia-canvas")` (Node),
// exactly like `seq-video.ts`. Bundlers must keep `skia-canvas` external.

/** Rasterize an opaque `ImageBitmap` to RGBA `ImageData` (OffscreenCanvas / skia). */
export async function rasterizeBitmap(bitmap: ImageBitmap): Promise<ImageData> {
  // Browser: OffscreenCanvas.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context to rasterize a frame");
    }
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  }
  // Node: skia-canvas (lazy dynamic import; never statically bundled).
  try {
    const sc = await import("skia-canvas");
    const Canvas = (
      sc as unknown as { Canvas: new (w: number, h: number) => unknown }
    ).Canvas;
    const canvas = new Canvas(bitmap.width, bitmap.height) as {
      getContext: (t: string) => {
        drawImage: (i: unknown, x: number, y: number) => void;
        getImageData: (x: number, y: number, w: number, h: number) => ImageData;
      };
    };
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch (err) {
    throw new Error(
      "Rasterizing a frame returned as an ImageBitmap requires an image " +
        "rasterizer (a browser with OffscreenCanvas, or the optional " +
        "`skia-canvas` package on Node). " +
        `Original error: ${(err as Error).message}`,
    );
  }
}

/**
 * Detect an opaque `ImageBitmap` (its pixels are not synchronously readable
 * here). Duck-typed so it works cross-realm / on Node (where a browser-produced
 * bitmap is not an `instanceof` the local `ImageBitmap`). Mirrors the detector
 * in `crop-backend.ts`.
 */
export function isImageBitmapLike(value: unknown): boolean {
  if (
    typeof ImageBitmap !== "undefined" &&
    value instanceof (ImageBitmap as unknown as { new (): object })
  ) {
    return true;
  }
  const v = value as {
    width?: unknown;
    height?: unknown;
    close?: unknown;
    data?: unknown;
  };
  return (
    v != null &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    typeof v.close === "function" &&
    v.data === undefined
  );
}

/** Detect an `ImageData`-shaped object (RGBA buffer with width/height). */
export function isImageDataLike(
  value: unknown,
): value is { data: Uint8ClampedArray; width: number; height: number } {
  const v = value as { data?: unknown; width?: unknown; height?: unknown };
  return (
    v != null &&
    typeof v.width === "number" &&
    typeof v.height === "number" &&
    (v.data instanceof Uint8ClampedArray || v.data instanceof Uint8Array)
  );
}

/**
 * Encode RGBA `ImageData` to PNG bytes (`OffscreenCanvas` in browser, lazy
 * `skia-canvas` on Node). Browser-safe: never statically imports `skia-canvas`.
 * Used when embedding a frame that a backend returns as raw pixels rather than
 * pre-encoded bytes — the stored `format` for such frames MUST be "png".
 */
export async function encodeImageDataToPng(
  img:
    | ImageData
    | { data: Uint8ClampedArray | Uint8Array; width: number; height: number },
): Promise<Uint8Array> {
  // Browser: OffscreenCanvas + putImageData + convertToBlob.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context to encode a frame to PNG");
    }
    ctx.putImageData(img as unknown as ImageData, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
  // Node: skia-canvas (lazy dynamic import; never statically bundled). skia's
  // `putImageData` requires a real skia `ImageData` (a plain object throws), so
  // wrap the raw bytes in one (mirrors `makeImageData` in seq-video.ts).
  // `toBuffer` returns a Buffer (a Uint8Array subclass).
  try {
    const sc = await import("skia-canvas");
    const scMod = sc as unknown as {
      Canvas: new (
        w: number,
        h: number,
      ) => {
        getContext: (t: string) => {
          putImageData: (i: unknown, x: number, y: number) => void;
        };
        toBuffer: (fmt: string) => Promise<Uint8Array> | Uint8Array;
      };
      ImageData: new (d: Uint8ClampedArray, w: number, h: number) => ImageData;
    };
    const rgba =
      img.data instanceof Uint8ClampedArray
        ? img.data
        : new Uint8ClampedArray(
            img.data.buffer,
            img.data.byteOffset,
            img.data.byteLength,
          );
    const skiaImg = new scMod.ImageData(rgba, img.width, img.height);
    const canvas = new scMod.Canvas(img.width, img.height);
    const ctx = canvas.getContext("2d");
    ctx.putImageData(skiaImg, 0, 0);
    return new Uint8Array(await canvas.toBuffer("png"));
  } catch (err) {
    throw new Error(
      "Encoding a raw frame to PNG requires an image encoder (a browser with " +
        "OffscreenCanvas, or the optional `skia-canvas` package on Node). " +
        `Original error: ${(err as Error).message}`,
    );
  }
}

/**
 * Encode an opaque `ImageBitmap` to PNG bytes. Browser: draw straight to an
 * `OffscreenCanvas` and `convertToBlob`. Node: rasterize via {@link
 * rasterizeBitmap} (skia) then {@link encodeImageDataToPng}. Browser-safe.
 */
export async function encodeBitmapToPng(
  bitmap: ImageBitmap,
): Promise<Uint8Array> {
  // Browser: single OffscreenCanvas — draw the bitmap, then convertToBlob.
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Failed to get 2D context to encode a frame to PNG");
    }
    ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  }
  // Node: rasterize (skia drawImage) to ImageData, then PNG-encode it.
  const img = await rasterizeBitmap(bitmap);
  return encodeImageDataToPng(img);
}

/** Decode encoded (PNG/JPEG/…) image bytes to RGBA `ImageData` (browser / skia). */
export async function decodeEncoded(bytes: Uint8Array): Promise<ImageData> {
  // Browser: createImageBitmap + OffscreenCanvas.
  if (
    typeof createImageBitmap !== "undefined" &&
    typeof OffscreenCanvas !== "undefined"
  ) {
    const safe = new Uint8Array(bytes);
    const bitmap = await createImageBitmap(new Blob([safe.buffer]));
    return rasterizeBitmap(bitmap);
  }
  // Node: skia-canvas loadImage. Wrap bytes in a Buffer so skia does not misread
  // a bare Uint8Array as a path.
  try {
    const sc = await import("skia-canvas");
    const src =
      typeof Buffer !== "undefined" ? Buffer.from(bytes) : (bytes as unknown);
    const img = await (
      sc as unknown as {
        loadImage: (b: unknown) => Promise<{ width: number; height: number }>;
      }
    ).loadImage(src);
    const Canvas = (
      sc as unknown as { Canvas: new (w: number, h: number) => unknown }
    ).Canvas;
    const canvas = new Canvas(img.width, img.height) as {
      getContext: (t: string) => {
        drawImage: (i: unknown, x: number, y: number) => void;
        getImageData: (x: number, y: number, w: number, h: number) => ImageData;
      };
    };
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height);
  } catch (err) {
    throw new Error(
      "Decoding undecoded JPEG/PNG image bytes requires an image decoder " +
        "(a browser, or the optional `skia-canvas` package on Node). " +
        `Original error: ${(err as Error).message}`,
    );
  }
}
