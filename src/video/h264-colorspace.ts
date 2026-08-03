/**
 * Derive a WebCodecs `VideoColorSpaceInit` for an H.264 stream.
 *
 * When we emit a decoded frame as an untagged I420 `VideoFrame`, the browser's
 * canvas guesses the YUV→RGB matrix/range — and different engines guess
 * differently (this caused a visible color shift on WebKitGTK vs native). Tagging
 * the frame with the stream's actual colorspace makes our output match native.
 *
 * We read the color signaling from the SPS VUI when present; otherwise we apply
 * the standard resolution heuristic (BT.601 for SD, BT.709 for HD, studio range),
 * which is what a conformant decoder uses for unspecified streams — so tagging it
 * explicitly matches the native decoder's behavior.
 *
 * Pure and dependency-free → unit-tested directly.
 */

/** Reads bits + Exp-Golomb from an RBSP (emulation-prevention bytes removed). */
class BitReader {
  private pos = 0;
  constructor(private readonly buf: Uint8Array) {}

  bit(): number {
    const byte = this.buf[this.pos >> 3] ?? 0;
    const b = (byte >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return b;
  }

  bits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.bit();
    return v >>> 0;
  }

  /** Unsigned Exp-Golomb. */
  ue(): number {
    let zeros = 0;
    while (this.pos < this.buf.length * 8 && this.bit() === 0) zeros++;
    if (zeros === 0) return 0;
    return (1 << zeros) - 1 + this.bits(zeros);
  }

  /** Signed Exp-Golomb. */
  se(): number {
    const k = this.ue();
    const sign = k & 1 ? 1 : -1;
    return sign * Math.ceil(k / 2);
  }

  hasMore(): boolean {
    return this.pos < this.buf.length * 8;
  }
}

/** Strip H.264 emulation-prevention bytes (00 00 03 → 00 00) from an RBSP. */
function stripEmulation(nal: Uint8Array): Uint8Array {
  const out = new Uint8Array(nal.length);
  let o = 0;
  for (let i = 0; i < nal.length; i++) {
    if (
      i >= 2 &&
      nal[i] === 0x03 &&
      nal[i - 1] === 0x00 &&
      nal[i - 2] === 0x00 &&
      i + 1 < nal.length &&
      nal[i + 1] <= 0x03
    ) {
      continue; // drop the 0x03
    }
    out[o++] = nal[i];
  }
  return out.subarray(0, o);
}

const HIGH_PROFILES = new Set([
  100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135,
]);

function skipScalingList(br: BitReader, size: number): void {
  let lastScale = 8;
  let nextScale = 8;
  for (let j = 0; j < size; j++) {
    if (nextScale !== 0) {
      const delta = br.se();
      nextScale = (lastScale + delta + 256) % 256;
    }
    if (nextScale !== 0) lastScale = nextScale;
  }
}

export interface SpsColour {
  fullRange: boolean;
  /** H.264 enum values; undefined when colour_description absent. */
  primaries?: number;
  transfer?: number;
  matrix?: number;
}

/**
 * Parse the color signaling out of an SPS NAL (which includes its 1-byte NAL
 * header). Returns null if the bitstream can't be parsed. `fullRange` defaults to
 * false when no VUI/video-signal-type is present.
 */
export function parseSpsColour(nal: Uint8Array): SpsColour | null {
  try {
    if (nal.length < 4) return null;
    const rbsp = stripEmulation(nal.subarray(1)); // drop NAL header byte
    const br = new BitReader(rbsp);

    const profileIdc = br.bits(8);
    br.bits(8); // constraint flags + reserved
    br.bits(8); // level_idc
    br.ue(); // seq_parameter_set_id

    let chromaFormatIdc = 1;
    if (HIGH_PROFILES.has(profileIdc)) {
      chromaFormatIdc = br.ue();
      if (chromaFormatIdc === 3) br.bit(); // separate_colour_plane_flag
      br.ue(); // bit_depth_luma_minus8
      br.ue(); // bit_depth_chroma_minus8
      br.bit(); // qpprime_y_zero_transform_bypass_flag
      if (br.bit()) {
        // seq_scaling_matrix_present_flag
        const count = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < count; i++) {
          if (br.bit()) skipScalingList(br, i < 6 ? 16 : 64);
        }
      }
    }

    br.ue(); // log2_max_frame_num_minus4
    const pocType = br.ue();
    if (pocType === 0) {
      br.ue(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (pocType === 1) {
      br.bit(); // delta_pic_order_always_zero_flag
      br.se(); // offset_for_non_ref_pic
      br.se(); // offset_for_top_to_bottom_field
      const n = br.ue();
      for (let i = 0; i < n; i++) br.se();
    }

    br.ue(); // max_num_ref_frames
    br.bit(); // gaps_in_frame_num_value_allowed_flag
    br.ue(); // pic_width_in_mbs_minus1
    br.ue(); // pic_height_in_map_units_minus1
    const frameMbsOnly = br.bit();
    if (!frameMbsOnly) br.bit(); // mb_adaptive_frame_field_flag
    br.bit(); // direct_8x8_inference_flag
    if (br.bit()) {
      // frame_cropping_flag
      br.ue();
      br.ue();
      br.ue();
      br.ue();
    }

    const vuiPresent = br.bit();
    if (!vuiPresent) return { fullRange: false };

    if (br.bit()) {
      // aspect_ratio_info_present_flag
      const idc = br.bits(8);
      if (idc === 255) {
        br.bits(16); // sar_width
        br.bits(16); // sar_height
      }
    }
    if (br.bit()) br.bit(); // overscan_info_present_flag → overscan_appropriate_flag

    if (br.bit()) {
      // video_signal_type_present_flag
      br.bits(3); // video_format
      const fullRange = br.bit() === 1;
      if (br.bit()) {
        // colour_description_present_flag
        const primaries = br.bits(8);
        const transfer = br.bits(8);
        const matrix = br.bits(8);
        return { fullRange, primaries, transfer, matrix };
      }
      return { fullRange };
    }
    return { fullRange: false };
  } catch {
    return null;
  }
}

// H.264 (ITU-T H.273) enum → WebCodecs string. Undefined = leave unset.
// Only the SDR values in the WebCodecs lib typings are mapped; HDR/BT.2020
// (10-bit) values fall through to undefined → the SD/HD default. Our decoder
// emits 8-bit I420, so SDR coverage is sufficient.
function mapPrimaries(v?: number): VideoColorPrimaries | undefined {
  switch (v) {
    case 1:
      return "bt709";
    case 5:
      return "bt470bg";
    case 6:
    case 7:
      return "smpte170m";
    default:
      return undefined;
  }
}
function mapTransfer(v?: number): VideoTransferCharacteristics | undefined {
  switch (v) {
    case 1:
    case 6:
    case 14:
    case 15:
      return "bt709";
    case 13:
      return "iec61966-2-1";
    default:
      return undefined;
  }
}
function mapMatrix(v?: number): VideoMatrixCoefficients | undefined {
  switch (v) {
    case 0:
      return "rgb";
    case 1:
      return "bt709";
    case 5:
      return "bt470bg";
    case 6:
    case 7:
      return "smpte170m";
    default:
      return undefined;
  }
}

/**
 * Build a `VideoColorSpaceInit` for an SPS NAL (may be null), using the codedHeight
 * to pick the SD/HD default when the stream doesn't signal colour explicitly.
 */
export function colorSpaceFromSps(
  nal: Uint8Array | null,
  config: { codedHeight?: number },
): VideoColorSpaceInit {
  const colour = nal ? parseSpsColour(nal) : null;
  const height = config.codedHeight ?? 720;
  // Standard default for unspecified streams: BT.601 for SD, BT.709 for HD.
  const sd = height <= 576;
  const defaultName = sd ? "smpte170m" : "bt709";

  return {
    primaries: mapPrimaries(colour?.primaries) ?? defaultName,
    transfer: mapTransfer(colour?.transfer) ?? (sd ? "smpte170m" : "bt709"),
    matrix: mapMatrix(colour?.matrix) ?? defaultName,
    fullRange: colour?.fullRange ?? false,
  };
}
