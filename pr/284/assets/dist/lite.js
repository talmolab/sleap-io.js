import {
  Edge,
  FORMAT3_TABLES,
  LOSSLESS_FORMAT3_ASKS,
  METADATA_SUBGROUP,
  Node,
  PARTLY_READ_GROUPS,
  SLP_FORMAT_ID_LIMIT,
  SLP_SUPPORTED_FEATURES,
  Skeleton,
  SlpFormat3ChoiceError,
  SlpFormatError,
  SlpTableError,
  SlpViewOnlyError,
  Symmetry,
  TABLE_SPECS,
  Track,
  buildFormat3Summary,
  checkSlpFormat,
  countUnlabeledPoints,
  isKnownTableColumn,
  parseJsonAttr,
  parseSessionsMetadata,
  parseSkeletons,
  parseSuggestions,
  parseTracks,
  parseVideosMetadata,
  reportTableProblems,
  sessionProblems,
  tableFromColumns,
  unknownColumns,
  unknownTableColumns,
  unknownTableGroups,
  unreadMembers
} from "./chunk-YX2YBCUQ.js";
import "./chunk-3UBNQTMV.js";

// src/codecs/slp/jsfive.ts
import * as hdf5 from "jsfive";
function openJsfiveFile(source, filename) {
  let buffer;
  if (source instanceof Uint8Array) {
    const slice = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength
    );
    buffer = slice;
  } else {
    buffer = source;
  }
  const file = new hdf5.File(buffer, filename ?? "data.slp");
  return {
    get: (path) => {
      try {
        const item = file.get(path);
        if (!item) return null;
        return item;
      } catch {
        return null;
      }
    },
    keys: file.keys,
    close: () => {
    }
  };
}
function isDataset(item) {
  if (!item) return false;
  return "value" in item || "shape" in item;
}
function isGroup(item) {
  if (!item) return false;
  return "keys" in item && !("value" in item);
}
function getAttrs(item) {
  if (!item) return {};
  return item.attrs ?? {};
}
function getShape(item) {
  if (!item || !isDataset(item)) return [];
  return item.shape ?? [];
}
function getValue(item) {
  if (!item || !isDataset(item)) return null;
  try {
    return item.value;
  } catch {
    return null;
  }
}

// src/lite.ts
function isGroupPath(file, path) {
  let prefix = "";
  for (const part of path.split("/")) {
    prefix = prefix ? `${prefix}/${part}` : part;
    if (!isGroup(file.get(prefix))) return false;
  }
  return true;
}
function groupDatasets(file, path) {
  if (!isGroupPath(file, path)) return [];
  const node = file.get(path);
  return node.keys.filter((name) => isDataset(file.get(`${path}/${name}`)));
}
function readColumnTableJsfive(file, table, labelsPath) {
  if (!isGroupPath(file, table)) return null;
  const columns = {};
  const unknownLengths = {};
  for (const name of groupDatasets(file, table)) {
    const dataset = file.get(`${table}/${name}`);
    if (!isKnownTableColumn(table, name)) {
      const shape = getShape(dataset);
      if (name !== TABLE_SPECS[table].buffer && shape.length) {
        unknownLengths[name] = shape[0];
      }
      continue;
    }
    const value = getValue(dataset);
    if (value && typeof value === "object" && "length" in value) {
      columns[name] = value;
    }
  }
  return tableFromColumns(table, columns, labelsPath, unknownLengths);
}
function isMetadataDtype(dtype) {
  if (Array.isArray(dtype)) return dtype[0] === "VLEN_STRING";
  if (typeof dtype !== "string") return false;
  return /^[<>|=]?[biuf]\d+$/.test(dtype) || /^\|?S\d+$/.test(dtype);
}
function format3SummaryJsfive(file, formatId, provenanceInMetadata) {
  const members = (path) => {
    const node = file.get(path);
    return isGroup(node) ? node.keys : [];
  };
  const datasets = (path) => members(path).filter((name) => isDataset(file.get(`${path}/${name}`)));
  const column = (path) => {
    const value = getValue(file.get(path));
    return value && typeof value === "object" && "length" in value ? value : void 0;
  };
  const unlabeled = (table) => isGroup(file.get(table)) ? countUnlabeledPoints({
    labeled: column(`${table}/labeled`),
    visible: column(`${table}/visible`)
  }) : 0;
  const keys = (table) => {
    const base = `${table}/${METADATA_SUBGROUP}`;
    return members(base).filter((key) => {
      const values = file.get(`${base}/${key}/values`);
      return isGroup(file.get(`${base}/${key}`)) && isDataset(values) && getShape(values).length === 1 && isMetadataDtype(values.dtype);
    });
  };
  const poseTables = [
    "frames",
    "instances",
    "points",
    "pred_points"
  ];
  return buildFormat3Summary({
    formatId,
    unreadTables: [
      ...unreadMembers({
        root: file.keys,
        groups: Object.fromEntries(
          PARTLY_READ_GROUPS.filter((g) => isGroup(file.get(g))).map((g) => [
            g,
            members(g)
          ])
        ),
        provenanceInMetadata
      }),
      ...FORMAT3_TABLES.flatMap(
        (table) => isGroupPath(file, table) ? unknownTableGroups(
          table,
          members(table).filter((n) => isGroup(file.get(`${table}/${n}`)))
        ) : []
      )
    ],
    unlabeledUserPoints: unlabeled("points"),
    unlabeledPredictedPoints: unlabeled("pred_points"),
    metadataKeys: {
      instances: keys("instances"),
      frames: keys("frames"),
      bboxes: keys("bboxes")
    },
    unknownColumns: [
      ...poseTables.flatMap((table) => unknownColumns(table, datasets(table))),
      ...unknownColumns("bboxes", datasets("bboxes")),
      ...FORMAT3_TABLES.flatMap(
        (table) => unknownTableColumns(table, groupDatasets(file, table))
      )
    ]
  });
}
function readSessionDataJsfive(file, labelsPath) {
  const grp = file.get("session_data");
  if (!grp || !isGroup(grp)) return null;
  const columnar = ["frame_groups", "instance_groups", "instance_group_members"].some((name) => isGroupPath(file, `session_data/${name}`));
  const struct = (name) => {
    if (columnar) {
      const table = `session_data/${name}`;
      return readColumnTableJsfive(file, table, labelsPath) ?? tableFromColumns(
        table,
        Object.fromEntries(TABLE_SPECS[table].numbers.map((c) => [c, []])),
        labelsPath
      );
    }
    const ds = file.get(`session_data/${name}`);
    if (!ds || !isDataset(ds)) return null;
    const flat = getValue(ds);
    const shape = getShape(ds);
    const fnRaw = getAttrs(ds)?.field_names;
    let fields = [];
    if (typeof fnRaw === "string") {
      try {
        fields = JSON.parse(fnRaw);
      } catch {
      }
    } else if (Array.isArray(fnRaw)) {
      fields = fnRaw.map(String);
    }
    if (!flat || shape.length < 2 || fields.length === 0) return null;
    const [nrows, ncols] = shape;
    const cols = {};
    fields.forEach((f, j) => {
      const col = new Array(nrows);
      for (let i = 0; i < nrows; i++) col[i] = Number(flat[i * ncols + j]);
      cols[f] = col;
    });
    return cols;
  };
  const frameGroups = struct("frame_groups");
  const instanceGroups = struct("instance_groups");
  const members = struct("instance_group_members");
  if (!frameGroups || !instanceGroups || !members) return null;
  const matrix = (name, ncolsDefault) => {
    const ds = file.get(`session_data/${name}`);
    if (!ds || !isDataset(ds)) return null;
    const flat = getValue(ds);
    if (!flat) return null;
    const shape = getShape(ds);
    return { flat, ncols: shape.length >= 2 ? shape[1] : ncolsDefault };
  };
  const meta = (name) => {
    const ds = file.get(`session_data/${name}`);
    if (!ds || !isDataset(ds)) return null;
    const v = getValue(ds);
    if (Array.isArray(v)) return v;
    return v != null ? [v] : null;
  };
  const points3d = matrix("points_3d", 3);
  const predPoints3d = matrix("pred_points_3d", 4);
  if (columnar) {
    const rows = (m) => m && m.ncols > 0 ? Math.floor(m.flat.length / m.ncols) : 0;
    const frames = file.get("frames");
    reportTableProblems(
      labelsPath,
      sessionProblems({
        frameGroups,
        instanceGroups,
        members,
        nPoints3d: rows(points3d),
        nPredPoints3d: rows(predPoints3d),
        nIdentities: getShape(file.get("identity/name"))[0] ?? 0,
        nFrames: frames ? getShape(
          isGroup(frames) ? file.get("frames/frame_idx") : frames
        )[0] ?? 0 : null
      })
    );
  }
  return {
    frameGroups,
    instanceGroups,
    members,
    points3d,
    predPoints3d,
    frameGroupMeta: meta("frame_group_meta"),
    instanceGroupMeta: meta("instance_group_meta")
  };
}
async function loadSlpMetadata(source, options) {
  const file = openJsfiveFile(source, options?.filename);
  try {
    checkSlpFormat(
      options?.filename ?? "slp-data.slp",
      file.keys.includes("metadata") ? getAttrs(file.get("metadata")) : null
    );
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    for (const key of requiredKeys) {
      if (!file.keys.includes(key)) {
        throw new Error(`Invalid SLP file: missing /${key}`);
      }
    }
    const metadataGroup = file.get("metadata");
    if (!metadataGroup) {
      throw new Error("Invalid SLP file: missing /metadata group");
    }
    const metadataAttrs = getAttrs(metadataGroup);
    const formatId = Number(
      metadataAttrs.format_id?.value ?? metadataAttrs.format_id ?? 1
    );
    const metadataJson = parseJsonAttr(metadataAttrs.json);
    if (!metadataJson) {
      throw new Error("Invalid SLP file: missing metadata.attrs.json");
    }
    const skeletons = parseSkeletons(metadataJson);
    const tracksDataset = file.get("tracks_json");
    const tracksValue = getValue(tracksDataset);
    const tracks = Array.isArray(tracksValue) ? parseTracks(tracksValue) : [];
    const videosDataset = file.get("videos_json");
    const videosValue = getValue(videosDataset);
    const labelsPath = options?.filename ?? "slp-data.slp";
    let videos = Array.isArray(videosValue) ? parseVideosMetadata(videosValue, labelsPath) : [];
    videos = videos.map((video) => {
      if (!video.embedded || !video.dataset) return video;
      const videoDs = file.get(video.dataset);
      if (!videoDs || !isDataset(videoDs)) return video;
      const attrs = getAttrs(videoDs);
      const enriched = { ...video };
      if (attrs.format !== void 0) enriched.format = String(attrs.format);
      if (attrs.width !== void 0) enriched.width = Number(attrs.width);
      if (attrs.height !== void 0) enriched.height = Number(attrs.height);
      if (attrs.channels !== void 0)
        enriched.channels = Number(attrs.channels);
      const shape = getShape(videoDs);
      if (shape.length > 0) {
        enriched.frameCount = shape[0];
      }
      return enriched;
    });
    const suggestionsDataset = file.get("suggestions_json");
    const suggestionsValue = getValue(suggestionsDataset);
    const suggestions = Array.isArray(suggestionsValue) ? parseSuggestions(suggestionsValue) : [];
    const sessionsDataset = file.get("sessions_json");
    const sessionsValue = getValue(sessionsDataset);
    const sessions = Array.isArray(sessionsValue) ? parseSessionsMetadata(
      sessionsValue,
      readSessionDataJsfive(file, labelsPath),
      skeletons
    ) : [];
    const framesDs = file.get("frames");
    const instancesDs = file.get("instances");
    const pointsDs = file.get("points");
    const predPointsDs = file.get("pred_points");
    const rows = (table, columnPath) => getShape(isGroup(table) ? file.get(columnPath) : table)[0] ?? 0;
    const counts = {
      labeledFrames: rows(framesDs, "frames/frame_idx"),
      instances: rows(instancesDs, "instances/instance_type"),
      points: rows(pointsDs, "points/x"),
      predictedPoints: rows(predPointsDs, "pred_points/x")
    };
    const hasEmbeddedImages = videos.some(
      (v) => v.embedded && (v.format || v.width)
    );
    return {
      version: metadataJson.version ?? "unknown",
      formatId,
      skeletons,
      tracks,
      videos,
      suggestions,
      sessions,
      counts,
      hasEmbeddedImages,
      provenance: metadataJson.provenance,
      ...formatId >= 3 ? {
        format3: format3SummaryJsfive(
          file,
          formatId,
          "provenance" in metadataJson
        )
      } : {}
    };
  } finally {
    file.close();
  }
}
function validateSlpBuffer(source) {
  const file = openJsfiveFile(source);
  try {
    checkSlpFormat(
      "slp-data.slp",
      file.keys.includes("metadata") ? getAttrs(file.get("metadata")) : null
    );
    const requiredKeys = ["metadata", "frames", "instances", "points"];
    const missingKeys = requiredKeys.filter((k) => !file.keys.includes(k));
    if (missingKeys.length > 0) {
      throw new Error(`Invalid SLP file: missing ${missingKeys.join(", ")}`);
    }
    const metadata = file.get("metadata");
    if (!metadata) {
      throw new Error("Invalid SLP file: cannot read metadata group");
    }
    const attrs = getAttrs(metadata);
    if (!attrs.json) {
      throw new Error("Invalid SLP file: missing metadata.attrs.json");
    }
    return true;
  } finally {
    file.close();
  }
}
function isHdf5Buffer(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length < 8) return false;
  return bytes[0] === 137 && bytes[1] === 72 && bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
}
export {
  Edge,
  LOSSLESS_FORMAT3_ASKS,
  Node,
  SLP_FORMAT_ID_LIMIT,
  SLP_SUPPORTED_FEATURES,
  Skeleton,
  SlpFormat3ChoiceError,
  SlpFormatError,
  SlpTableError,
  SlpViewOnlyError,
  Symmetry,
  Track,
  isHdf5Buffer,
  loadSlpMetadata,
  validateSlpBuffer
};
