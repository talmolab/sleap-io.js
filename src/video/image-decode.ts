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
