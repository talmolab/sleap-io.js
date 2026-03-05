import {
  __commonJS,
  __esm,
  __require,
  __toESM
} from "./chunk-EAQYK3U2.js";

// node_modules/skia-canvas/lib/skia.node
var skia_default;
var init_skia = __esm({
  "node_modules/skia-canvas/lib/skia.node"() {
    skia_default = "./skia-2CN5PKR3.node";
  }
});

// node-file:/home/talmo/code/sleap-io.js/node_modules/skia-canvas/lib/skia.node
var require_skia = __commonJS({
  "node-file:/home/talmo/code/sleap-io.js/node_modules/skia-canvas/lib/skia.node"(exports, module) {
    "use strict";
    init_skia();
    try {
      module.exports = __require(skia_default);
    } catch {
    }
  }
});

// node_modules/skia-canvas/lib/classes/neon.js
var require_neon = __commonJS({
  "node_modules/skia-canvas/lib/classes/neon.js"(exports, module) {
    "use strict";
    var { inspect } = __require("util");
    var STRICT = !["0", "false", "off"].includes((process.env.SKIA_CANVAS_STRICT || "0").trim().toLowerCase());
    var \u00F8 = /* @__PURE__ */ Symbol.for("\u{1F4E6}");
    var core = (obj) => (obj || {})[\u00F8];
    var wrap = (type, struct) => {
      let obj = internal(Object.create(type.prototype), \u00F8, struct);
      return struct && internal(obj, "native", neon[type.name]);
    };
    var neon = Object.entries(require_skia()).reduce((api, [name, fn]) => {
      let [_, struct, getset, attr] = name.match(/(.*?)_(?:([sg]et)_)?(.*)/), cls = api[struct] || (api[struct] = {}), slot = getset ? cls[attr] || (cls[attr] = {}) : cls;
      slot[getset || attr] = fn;
      return api;
    }, {});
    var RustClass = class {
      constructor(type) {
        internal(this, "native", neon[type.name]);
      }
      alloc(...args) {
        try {
          return this.init("new", ...args);
        } catch (error) {
          rustError(error, this.alloc);
        }
      }
      init(fn, ...args) {
        try {
          return internal(this, \u00F8, this.native[fn](null, ...args));
        } catch (error) {
          rustError(error, this.init);
        }
      }
      ref(key, val) {
        return arguments.length > 1 ? this[Symbol.for(key)] = val : this[Symbol.for(key)];
      }
      prop(attr, ...vals) {
        try {
          let getset = arguments.length > 1 ? "set" : "get";
          return this.native[attr][getset](this[\u00F8], ...vals);
        } catch (error) {
          rustError(error, this.prop);
        }
      }
      \u0192(fn, ...args) {
        try {
          return this.native[fn](this[\u00F8], ...args);
        } catch (error) {
          rustError(error, this.\u0192);
        }
      }
    };
    var readOnly = (obj, attr, value) => Object.defineProperty(obj, attr, { value, writable: false, enumerable: true });
    var internal = (obj, attr, value) => Object.defineProperty(obj, attr, { value, writable: false, enumerable: false });
    function signature(args) {
      return args.map((v) => Array.isArray(v) ? "a" : { string: "s", number: "n", object: "o" }[typeof v] || "x").join("");
    }
    var argc = (args, ...expected) => {
      if (expected.includes(args.length) || args.length > Math.max(...expected)) return;
      let error = new TypeError("not enough arguments");
      Error.captureStackTrace(error, argc);
      throw error;
    };
    var rustError = (error, stack) => {
      if (error.message.startsWith("\u26A0\uFE0F")) {
        if (STRICT) error.message = error.message.substr(1);
        else return;
      }
      Error.captureStackTrace(error, stack);
      throw error;
    };
    module.exports = { neon, core, wrap, signature, argc, readOnly, RustClass, inspect, REPR: inspect.custom };
  }
});

// node_modules/ms/index.js
var require_ms = __commonJS({
  "node_modules/ms/index.js"(exports, module) {
    "use strict";
    var s = 1e3;
    var m = s * 60;
    var h = m * 60;
    var d = h * 24;
    var w = d * 7;
    var y = d * 365.25;
    module.exports = function(val, options) {
      options = options || {};
      var type = typeof val;
      if (type === "string" && val.length > 0) {
        return parse(val);
      } else if (type === "number" && isFinite(val)) {
        return options.long ? fmtLong(val) : fmtShort(val);
      }
      throw new Error(
        "val is not a non-empty string or a valid number. val=" + JSON.stringify(val)
      );
    };
    function parse(str) {
      str = String(str);
      if (str.length > 100) {
        return;
      }
      var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(
        str
      );
      if (!match) {
        return;
      }
      var n = parseFloat(match[1]);
      var type = (match[2] || "ms").toLowerCase();
      switch (type) {
        case "years":
        case "year":
        case "yrs":
        case "yr":
        case "y":
          return n * y;
        case "weeks":
        case "week":
        case "w":
          return n * w;
        case "days":
        case "day":
        case "d":
          return n * d;
        case "hours":
        case "hour":
        case "hrs":
        case "hr":
        case "h":
          return n * h;
        case "minutes":
        case "minute":
        case "mins":
        case "min":
        case "m":
          return n * m;
        case "seconds":
        case "second":
        case "secs":
        case "sec":
        case "s":
          return n * s;
        case "milliseconds":
        case "millisecond":
        case "msecs":
        case "msec":
        case "ms":
          return n;
        default:
          return void 0;
      }
    }
    function fmtShort(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return Math.round(ms / d) + "d";
      }
      if (msAbs >= h) {
        return Math.round(ms / h) + "h";
      }
      if (msAbs >= m) {
        return Math.round(ms / m) + "m";
      }
      if (msAbs >= s) {
        return Math.round(ms / s) + "s";
      }
      return ms + "ms";
    }
    function fmtLong(ms) {
      var msAbs = Math.abs(ms);
      if (msAbs >= d) {
        return plural(ms, msAbs, d, "day");
      }
      if (msAbs >= h) {
        return plural(ms, msAbs, h, "hour");
      }
      if (msAbs >= m) {
        return plural(ms, msAbs, m, "minute");
      }
      if (msAbs >= s) {
        return plural(ms, msAbs, s, "second");
      }
      return ms + " ms";
    }
    function plural(ms, msAbs, n, name) {
      var isPlural = msAbs >= n * 1.5;
      return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
    }
  }
});

// node_modules/debug/src/common.js
var require_common = __commonJS({
  "node_modules/debug/src/common.js"(exports, module) {
    "use strict";
    function setup(env) {
      createDebug.debug = createDebug;
      createDebug.default = createDebug;
      createDebug.coerce = coerce;
      createDebug.disable = disable;
      createDebug.enable = enable;
      createDebug.enabled = enabled;
      createDebug.humanize = require_ms();
      createDebug.destroy = destroy;
      Object.keys(env).forEach((key) => {
        createDebug[key] = env[key];
      });
      createDebug.names = [];
      createDebug.skips = [];
      createDebug.formatters = {};
      function selectColor(namespace) {
        let hash = 0;
        for (let i = 0; i < namespace.length; i++) {
          hash = (hash << 5) - hash + namespace.charCodeAt(i);
          hash |= 0;
        }
        return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
      }
      createDebug.selectColor = selectColor;
      function createDebug(namespace) {
        let prevTime;
        let enableOverride = null;
        let namespacesCache;
        let enabledCache;
        function debug(...args) {
          if (!debug.enabled) {
            return;
          }
          const self = debug;
          const curr = Number(/* @__PURE__ */ new Date());
          const ms = curr - (prevTime || curr);
          self.diff = ms;
          self.prev = prevTime;
          self.curr = curr;
          prevTime = curr;
          args[0] = createDebug.coerce(args[0]);
          if (typeof args[0] !== "string") {
            args.unshift("%O");
          }
          let index = 0;
          args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
            if (match === "%%") {
              return "%";
            }
            index++;
            const formatter = createDebug.formatters[format];
            if (typeof formatter === "function") {
              const val = args[index];
              match = formatter.call(self, val);
              args.splice(index, 1);
              index--;
            }
            return match;
          });
          createDebug.formatArgs.call(self, args);
          const logFn = self.log || createDebug.log;
          logFn.apply(self, args);
        }
        debug.namespace = namespace;
        debug.useColors = createDebug.useColors();
        debug.color = createDebug.selectColor(namespace);
        debug.extend = extend;
        debug.destroy = createDebug.destroy;
        Object.defineProperty(debug, "enabled", {
          enumerable: true,
          configurable: false,
          get: () => {
            if (enableOverride !== null) {
              return enableOverride;
            }
            if (namespacesCache !== createDebug.namespaces) {
              namespacesCache = createDebug.namespaces;
              enabledCache = createDebug.enabled(namespace);
            }
            return enabledCache;
          },
          set: (v) => {
            enableOverride = v;
          }
        });
        if (typeof createDebug.init === "function") {
          createDebug.init(debug);
        }
        return debug;
      }
      function extend(namespace, delimiter) {
        const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
        newDebug.log = this.log;
        return newDebug;
      }
      function enable(namespaces) {
        createDebug.save(namespaces);
        createDebug.namespaces = namespaces;
        createDebug.names = [];
        createDebug.skips = [];
        const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
        for (const ns of split) {
          if (ns[0] === "-") {
            createDebug.skips.push(ns.slice(1));
          } else {
            createDebug.names.push(ns);
          }
        }
      }
      function matchesTemplate(search, template) {
        let searchIndex = 0;
        let templateIndex = 0;
        let starIndex = -1;
        let matchIndex = 0;
        while (searchIndex < search.length) {
          if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
            if (template[templateIndex] === "*") {
              starIndex = templateIndex;
              matchIndex = searchIndex;
              templateIndex++;
            } else {
              searchIndex++;
              templateIndex++;
            }
          } else if (starIndex !== -1) {
            templateIndex = starIndex + 1;
            matchIndex++;
            searchIndex = matchIndex;
          } else {
            return false;
          }
        }
        while (templateIndex < template.length && template[templateIndex] === "*") {
          templateIndex++;
        }
        return templateIndex === template.length;
      }
      function disable() {
        const namespaces = [
          ...createDebug.names,
          ...createDebug.skips.map((namespace) => "-" + namespace)
        ].join(",");
        createDebug.enable("");
        return namespaces;
      }
      function enabled(name) {
        for (const skip of createDebug.skips) {
          if (matchesTemplate(name, skip)) {
            return false;
          }
        }
        for (const ns of createDebug.names) {
          if (matchesTemplate(name, ns)) {
            return true;
          }
        }
        return false;
      }
      function coerce(val) {
        if (val instanceof Error) {
          return val.stack || val.message;
        }
        return val;
      }
      function destroy() {
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
      createDebug.enable(createDebug.load());
      return createDebug;
    }
    module.exports = setup;
  }
});

// node_modules/debug/src/browser.js
var require_browser = __commonJS({
  "node_modules/debug/src/browser.js"(exports, module) {
    "use strict";
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.storage = localstorage();
    exports.destroy = /* @__PURE__ */ (() => {
      let warned = false;
      return () => {
        if (!warned) {
          warned = true;
          console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
        }
      };
    })();
    exports.colors = [
      "#0000CC",
      "#0000FF",
      "#0033CC",
      "#0033FF",
      "#0066CC",
      "#0066FF",
      "#0099CC",
      "#0099FF",
      "#00CC00",
      "#00CC33",
      "#00CC66",
      "#00CC99",
      "#00CCCC",
      "#00CCFF",
      "#3300CC",
      "#3300FF",
      "#3333CC",
      "#3333FF",
      "#3366CC",
      "#3366FF",
      "#3399CC",
      "#3399FF",
      "#33CC00",
      "#33CC33",
      "#33CC66",
      "#33CC99",
      "#33CCCC",
      "#33CCFF",
      "#6600CC",
      "#6600FF",
      "#6633CC",
      "#6633FF",
      "#66CC00",
      "#66CC33",
      "#9900CC",
      "#9900FF",
      "#9933CC",
      "#9933FF",
      "#99CC00",
      "#99CC33",
      "#CC0000",
      "#CC0033",
      "#CC0066",
      "#CC0099",
      "#CC00CC",
      "#CC00FF",
      "#CC3300",
      "#CC3333",
      "#CC3366",
      "#CC3399",
      "#CC33CC",
      "#CC33FF",
      "#CC6600",
      "#CC6633",
      "#CC9900",
      "#CC9933",
      "#CCCC00",
      "#CCCC33",
      "#FF0000",
      "#FF0033",
      "#FF0066",
      "#FF0099",
      "#FF00CC",
      "#FF00FF",
      "#FF3300",
      "#FF3333",
      "#FF3366",
      "#FF3399",
      "#FF33CC",
      "#FF33FF",
      "#FF6600",
      "#FF6633",
      "#FF9900",
      "#FF9933",
      "#FFCC00",
      "#FFCC33"
    ];
    function useColors() {
      if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
        return true;
      }
      if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
        return false;
      }
      let m;
      return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || // Is firebug? http://stackoverflow.com/a/398120/376773
      typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || // Is firefox >= v31?
      // https://developer.mozilla.org/en-US/docs/Tools/Web_Console#Styling_messages
      typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || // Double check webkit in userAgent just in case we are in a worker
      typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
    }
    function formatArgs(args) {
      args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
      if (!this.useColors) {
        return;
      }
      const c = "color: " + this.color;
      args.splice(1, 0, c, "color: inherit");
      let index = 0;
      let lastC = 0;
      args[0].replace(/%[a-zA-Z%]/g, (match) => {
        if (match === "%%") {
          return;
        }
        index++;
        if (match === "%c") {
          lastC = index;
        }
      });
      args.splice(lastC, 0, c);
    }
    exports.log = console.debug || console.log || (() => {
    });
    function save(namespaces) {
      try {
        if (namespaces) {
          exports.storage.setItem("debug", namespaces);
        } else {
          exports.storage.removeItem("debug");
        }
      } catch (error) {
      }
    }
    function load() {
      let r;
      try {
        r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
      } catch (error) {
      }
      if (!r && typeof process !== "undefined" && "env" in process) {
        r = process.env.DEBUG;
      }
      return r;
    }
    function localstorage() {
      try {
        return localStorage;
      } catch (error) {
      }
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.j = function(v) {
      try {
        return JSON.stringify(v);
      } catch (error) {
        return "[UnexpectedJSONParseError]: " + error.message;
      }
    };
  }
});

// node_modules/has-flag/index.js
var require_has_flag = __commonJS({
  "node_modules/has-flag/index.js"(exports, module) {
    "use strict";
    module.exports = (flag, argv = process.argv) => {
      const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
      const position = argv.indexOf(prefix + flag);
      const terminatorPosition = argv.indexOf("--");
      return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
    };
  }
});

// node_modules/supports-color/index.js
var require_supports_color = __commonJS({
  "node_modules/supports-color/index.js"(exports, module) {
    "use strict";
    var os = __require("os");
    var tty = __require("tty");
    var hasFlag = require_has_flag();
    var { env } = process;
    var forceColor;
    if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
      forceColor = 0;
    } else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
      forceColor = 1;
    }
    if ("FORCE_COLOR" in env) {
      if (env.FORCE_COLOR === "true") {
        forceColor = 1;
      } else if (env.FORCE_COLOR === "false") {
        forceColor = 0;
      } else {
        forceColor = env.FORCE_COLOR.length === 0 ? 1 : Math.min(parseInt(env.FORCE_COLOR, 10), 3);
      }
    }
    function translateLevel(level) {
      if (level === 0) {
        return false;
      }
      return {
        level,
        hasBasic: true,
        has256: level >= 2,
        has16m: level >= 3
      };
    }
    function supportsColor(haveStream, streamIsTTY) {
      if (forceColor === 0) {
        return 0;
      }
      if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
        return 3;
      }
      if (hasFlag("color=256")) {
        return 2;
      }
      if (haveStream && !streamIsTTY && forceColor === void 0) {
        return 0;
      }
      const min = forceColor || 0;
      if (env.TERM === "dumb") {
        return min;
      }
      if (process.platform === "win32") {
        const osRelease = os.release().split(".");
        if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
          return Number(osRelease[2]) >= 14931 ? 3 : 2;
        }
        return 1;
      }
      if ("CI" in env) {
        if (["TRAVIS", "CIRCLECI", "APPVEYOR", "GITLAB_CI", "GITHUB_ACTIONS", "BUILDKITE"].some((sign) => sign in env) || env.CI_NAME === "codeship") {
          return 1;
        }
        return min;
      }
      if ("TEAMCITY_VERSION" in env) {
        return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
      }
      if (env.COLORTERM === "truecolor") {
        return 3;
      }
      if ("TERM_PROGRAM" in env) {
        const version = parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
        switch (env.TERM_PROGRAM) {
          case "iTerm.app":
            return version >= 3 ? 3 : 2;
          case "Apple_Terminal":
            return 2;
        }
      }
      if (/-256(color)?$/i.test(env.TERM)) {
        return 2;
      }
      if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
        return 1;
      }
      if ("COLORTERM" in env) {
        return 1;
      }
      return min;
    }
    function getSupportLevel(stream) {
      const level = supportsColor(stream, stream && stream.isTTY);
      return translateLevel(level);
    }
    module.exports = {
      supportsColor: getSupportLevel,
      stdout: translateLevel(supportsColor(true, tty.isatty(1))),
      stderr: translateLevel(supportsColor(true, tty.isatty(2)))
    };
  }
});

// node_modules/debug/src/node.js
var require_node = __commonJS({
  "node_modules/debug/src/node.js"(exports, module) {
    "use strict";
    var tty = __require("tty");
    var util = __require("util");
    exports.init = init;
    exports.log = log;
    exports.formatArgs = formatArgs;
    exports.save = save;
    exports.load = load;
    exports.useColors = useColors;
    exports.destroy = util.deprecate(
      () => {
      },
      "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`."
    );
    exports.colors = [6, 2, 3, 4, 5, 1];
    try {
      const supportsColor = require_supports_color();
      if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
        exports.colors = [
          20,
          21,
          26,
          27,
          32,
          33,
          38,
          39,
          40,
          41,
          42,
          43,
          44,
          45,
          56,
          57,
          62,
          63,
          68,
          69,
          74,
          75,
          76,
          77,
          78,
          79,
          80,
          81,
          92,
          93,
          98,
          99,
          112,
          113,
          128,
          129,
          134,
          135,
          148,
          149,
          160,
          161,
          162,
          163,
          164,
          165,
          166,
          167,
          168,
          169,
          170,
          171,
          172,
          173,
          178,
          179,
          184,
          185,
          196,
          197,
          198,
          199,
          200,
          201,
          202,
          203,
          204,
          205,
          206,
          207,
          208,
          209,
          214,
          215,
          220,
          221
        ];
      }
    } catch (error) {
    }
    exports.inspectOpts = Object.keys(process.env).filter((key) => {
      return /^debug_/i.test(key);
    }).reduce((obj, key) => {
      const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
        return k.toUpperCase();
      });
      let val = process.env[key];
      if (/^(yes|on|true|enabled)$/i.test(val)) {
        val = true;
      } else if (/^(no|off|false|disabled)$/i.test(val)) {
        val = false;
      } else if (val === "null") {
        val = null;
      } else {
        val = Number(val);
      }
      obj[prop] = val;
      return obj;
    }, {});
    function useColors() {
      return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
    }
    function formatArgs(args) {
      const { namespace: name, useColors: useColors2 } = this;
      if (useColors2) {
        const c = this.color;
        const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
        const prefix = `  ${colorCode};1m${name} \x1B[0m`;
        args[0] = prefix + args[0].split("\n").join("\n" + prefix);
        args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
      } else {
        args[0] = getDate() + name + " " + args[0];
      }
    }
    function getDate() {
      if (exports.inspectOpts.hideDate) {
        return "";
      }
      return (/* @__PURE__ */ new Date()).toISOString() + " ";
    }
    function log(...args) {
      return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + "\n");
    }
    function save(namespaces) {
      if (namespaces) {
        process.env.DEBUG = namespaces;
      } else {
        delete process.env.DEBUG;
      }
    }
    function load() {
      return process.env.DEBUG;
    }
    function init(debug) {
      debug.inspectOpts = {};
      const keys = Object.keys(exports.inspectOpts);
      for (let i = 0; i < keys.length; i++) {
        debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
      }
    }
    module.exports = require_common()(exports);
    var { formatters } = module.exports;
    formatters.o = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts).split("\n").map((str) => str.trim()).join(" ");
    };
    formatters.O = function(v) {
      this.inspectOpts.colors = this.useColors;
      return util.inspect(v, this.inspectOpts);
    };
  }
});

// node_modules/debug/src/index.js
var require_src = __commonJS({
  "node_modules/debug/src/index.js"(exports, module) {
    "use strict";
    if (typeof process === "undefined" || process.type === "renderer" || process.browser === true || process.__nwjs) {
      module.exports = require_browser();
    } else {
      module.exports = require_node();
    }
  }
});

// node_modules/follow-redirects/debug.js
var require_debug = __commonJS({
  "node_modules/follow-redirects/debug.js"(exports, module) {
    "use strict";
    var debug;
    module.exports = function() {
      if (!debug) {
        try {
          debug = require_src()("follow-redirects");
        } catch (error) {
        }
        if (typeof debug !== "function") {
          debug = function() {
          };
        }
      }
      debug.apply(null, arguments);
    };
  }
});

// node_modules/follow-redirects/index.js
var require_follow_redirects = __commonJS({
  "node_modules/follow-redirects/index.js"(exports, module) {
    "use strict";
    var url = __require("url");
    var URL2 = url.URL;
    var http = __require("http");
    var https = __require("https");
    var Writable = __require("stream").Writable;
    var assert = __require("assert");
    var debug = require_debug();
    (function detectUnsupportedEnvironment() {
      var looksLikeNode = typeof process !== "undefined";
      var looksLikeBrowser = typeof window !== "undefined" && typeof document !== "undefined";
      var looksLikeV8 = isFunction(Error.captureStackTrace);
      if (!looksLikeNode && (looksLikeBrowser || !looksLikeV8)) {
        console.warn("The follow-redirects package should be excluded from browser builds.");
      }
    })();
    var useNativeURL = false;
    try {
      assert(new URL2(""));
    } catch (error) {
      useNativeURL = error.code === "ERR_INVALID_URL";
    }
    var preservedUrlFields = [
      "auth",
      "host",
      "hostname",
      "href",
      "path",
      "pathname",
      "port",
      "protocol",
      "query",
      "search",
      "hash"
    ];
    var events = ["abort", "aborted", "connect", "error", "socket", "timeout"];
    var eventHandlers = /* @__PURE__ */ Object.create(null);
    events.forEach(function(event) {
      eventHandlers[event] = function(arg1, arg2, arg3) {
        this._redirectable.emit(event, arg1, arg2, arg3);
      };
    });
    var InvalidUrlError = createErrorType(
      "ERR_INVALID_URL",
      "Invalid URL",
      TypeError
    );
    var RedirectionError = createErrorType(
      "ERR_FR_REDIRECTION_FAILURE",
      "Redirected request failed"
    );
    var TooManyRedirectsError = createErrorType(
      "ERR_FR_TOO_MANY_REDIRECTS",
      "Maximum number of redirects exceeded",
      RedirectionError
    );
    var MaxBodyLengthExceededError = createErrorType(
      "ERR_FR_MAX_BODY_LENGTH_EXCEEDED",
      "Request body larger than maxBodyLength limit"
    );
    var WriteAfterEndError = createErrorType(
      "ERR_STREAM_WRITE_AFTER_END",
      "write after end"
    );
    var destroy = Writable.prototype.destroy || noop;
    function RedirectableRequest(options, responseCallback) {
      Writable.call(this);
      this._sanitizeOptions(options);
      this._options = options;
      this._ended = false;
      this._ending = false;
      this._redirectCount = 0;
      this._redirects = [];
      this._requestBodyLength = 0;
      this._requestBodyBuffers = [];
      if (responseCallback) {
        this.on("response", responseCallback);
      }
      var self = this;
      this._onNativeResponse = function(response) {
        try {
          self._processResponse(response);
        } catch (cause) {
          self.emit("error", cause instanceof RedirectionError ? cause : new RedirectionError({ cause }));
        }
      };
      this._performRequest();
    }
    RedirectableRequest.prototype = Object.create(Writable.prototype);
    RedirectableRequest.prototype.abort = function() {
      destroyRequest(this._currentRequest);
      this._currentRequest.abort();
      this.emit("abort");
    };
    RedirectableRequest.prototype.destroy = function(error) {
      destroyRequest(this._currentRequest, error);
      destroy.call(this, error);
      return this;
    };
    RedirectableRequest.prototype.write = function(data, encoding, callback) {
      if (this._ending) {
        throw new WriteAfterEndError();
      }
      if (!isString(data) && !isBuffer(data)) {
        throw new TypeError("data should be a string, Buffer or Uint8Array");
      }
      if (isFunction(encoding)) {
        callback = encoding;
        encoding = null;
      }
      if (data.length === 0) {
        if (callback) {
          callback();
        }
        return;
      }
      if (this._requestBodyLength + data.length <= this._options.maxBodyLength) {
        this._requestBodyLength += data.length;
        this._requestBodyBuffers.push({ data, encoding });
        this._currentRequest.write(data, encoding, callback);
      } else {
        this.emit("error", new MaxBodyLengthExceededError());
        this.abort();
      }
    };
    RedirectableRequest.prototype.end = function(data, encoding, callback) {
      if (isFunction(data)) {
        callback = data;
        data = encoding = null;
      } else if (isFunction(encoding)) {
        callback = encoding;
        encoding = null;
      }
      if (!data) {
        this._ended = this._ending = true;
        this._currentRequest.end(null, null, callback);
      } else {
        var self = this;
        var currentRequest = this._currentRequest;
        this.write(data, encoding, function() {
          self._ended = true;
          currentRequest.end(null, null, callback);
        });
        this._ending = true;
      }
    };
    RedirectableRequest.prototype.setHeader = function(name, value) {
      this._options.headers[name] = value;
      this._currentRequest.setHeader(name, value);
    };
    RedirectableRequest.prototype.removeHeader = function(name) {
      delete this._options.headers[name];
      this._currentRequest.removeHeader(name);
    };
    RedirectableRequest.prototype.setTimeout = function(msecs, callback) {
      var self = this;
      function destroyOnTimeout(socket) {
        socket.setTimeout(msecs);
        socket.removeListener("timeout", socket.destroy);
        socket.addListener("timeout", socket.destroy);
      }
      function startTimer(socket) {
        if (self._timeout) {
          clearTimeout(self._timeout);
        }
        self._timeout = setTimeout(function() {
          self.emit("timeout");
          clearTimer();
        }, msecs);
        destroyOnTimeout(socket);
      }
      function clearTimer() {
        if (self._timeout) {
          clearTimeout(self._timeout);
          self._timeout = null;
        }
        self.removeListener("abort", clearTimer);
        self.removeListener("error", clearTimer);
        self.removeListener("response", clearTimer);
        self.removeListener("close", clearTimer);
        if (callback) {
          self.removeListener("timeout", callback);
        }
        if (!self.socket) {
          self._currentRequest.removeListener("socket", startTimer);
        }
      }
      if (callback) {
        this.on("timeout", callback);
      }
      if (this.socket) {
        startTimer(this.socket);
      } else {
        this._currentRequest.once("socket", startTimer);
      }
      this.on("socket", destroyOnTimeout);
      this.on("abort", clearTimer);
      this.on("error", clearTimer);
      this.on("response", clearTimer);
      this.on("close", clearTimer);
      return this;
    };
    [
      "flushHeaders",
      "getHeader",
      "setNoDelay",
      "setSocketKeepAlive"
    ].forEach(function(method) {
      RedirectableRequest.prototype[method] = function(a, b) {
        return this._currentRequest[method](a, b);
      };
    });
    ["aborted", "connection", "socket"].forEach(function(property) {
      Object.defineProperty(RedirectableRequest.prototype, property, {
        get: function() {
          return this._currentRequest[property];
        }
      });
    });
    RedirectableRequest.prototype._sanitizeOptions = function(options) {
      if (!options.headers) {
        options.headers = {};
      }
      if (options.host) {
        if (!options.hostname) {
          options.hostname = options.host;
        }
        delete options.host;
      }
      if (!options.pathname && options.path) {
        var searchPos = options.path.indexOf("?");
        if (searchPos < 0) {
          options.pathname = options.path;
        } else {
          options.pathname = options.path.substring(0, searchPos);
          options.search = options.path.substring(searchPos);
        }
      }
    };
    RedirectableRequest.prototype._performRequest = function() {
      var protocol = this._options.protocol;
      var nativeProtocol = this._options.nativeProtocols[protocol];
      if (!nativeProtocol) {
        throw new TypeError("Unsupported protocol " + protocol);
      }
      if (this._options.agents) {
        var scheme = protocol.slice(0, -1);
        this._options.agent = this._options.agents[scheme];
      }
      var request = this._currentRequest = nativeProtocol.request(this._options, this._onNativeResponse);
      request._redirectable = this;
      for (var event of events) {
        request.on(event, eventHandlers[event]);
      }
      this._currentUrl = /^\//.test(this._options.path) ? url.format(this._options) : (
        // When making a request to a proxy, […]
        // a client MUST send the target URI in absolute-form […].
        this._options.path
      );
      if (this._isRedirect) {
        var i = 0;
        var self = this;
        var buffers = this._requestBodyBuffers;
        (function writeNext(error) {
          if (request === self._currentRequest) {
            if (error) {
              self.emit("error", error);
            } else if (i < buffers.length) {
              var buffer = buffers[i++];
              if (!request.finished) {
                request.write(buffer.data, buffer.encoding, writeNext);
              }
            } else if (self._ended) {
              request.end();
            }
          }
        })();
      }
    };
    RedirectableRequest.prototype._processResponse = function(response) {
      var statusCode = response.statusCode;
      if (this._options.trackRedirects) {
        this._redirects.push({
          url: this._currentUrl,
          headers: response.headers,
          statusCode
        });
      }
      var location = response.headers.location;
      if (!location || this._options.followRedirects === false || statusCode < 300 || statusCode >= 400) {
        response.responseUrl = this._currentUrl;
        response.redirects = this._redirects;
        this.emit("response", response);
        this._requestBodyBuffers = [];
        return;
      }
      destroyRequest(this._currentRequest);
      response.destroy();
      if (++this._redirectCount > this._options.maxRedirects) {
        throw new TooManyRedirectsError();
      }
      var requestHeaders;
      var beforeRedirect = this._options.beforeRedirect;
      if (beforeRedirect) {
        requestHeaders = Object.assign({
          // The Host header was set by nativeProtocol.request
          Host: response.req.getHeader("host")
        }, this._options.headers);
      }
      var method = this._options.method;
      if ((statusCode === 301 || statusCode === 302) && this._options.method === "POST" || // RFC7231§6.4.4: The 303 (See Other) status code indicates that
      // the server is redirecting the user agent to a different resource […]
      // A user agent can perform a retrieval request targeting that URI
      // (a GET or HEAD request if using HTTP) […]
      statusCode === 303 && !/^(?:GET|HEAD)$/.test(this._options.method)) {
        this._options.method = "GET";
        this._requestBodyBuffers = [];
        removeMatchingHeaders(/^content-/i, this._options.headers);
      }
      var currentHostHeader = removeMatchingHeaders(/^host$/i, this._options.headers);
      var currentUrlParts = parseUrl(this._currentUrl);
      var currentHost = currentHostHeader || currentUrlParts.host;
      var currentUrl = /^\w+:/.test(location) ? this._currentUrl : url.format(Object.assign(currentUrlParts, { host: currentHost }));
      var redirectUrl = resolveUrl(location, currentUrl);
      debug("redirecting to", redirectUrl.href);
      this._isRedirect = true;
      spreadUrlObject(redirectUrl, this._options);
      if (redirectUrl.protocol !== currentUrlParts.protocol && redirectUrl.protocol !== "https:" || redirectUrl.host !== currentHost && !isSubdomain(redirectUrl.host, currentHost)) {
        removeMatchingHeaders(/^(?:(?:proxy-)?authorization|cookie)$/i, this._options.headers);
      }
      if (isFunction(beforeRedirect)) {
        var responseDetails = {
          headers: response.headers,
          statusCode
        };
        var requestDetails = {
          url: currentUrl,
          method,
          headers: requestHeaders
        };
        beforeRedirect(this._options, responseDetails, requestDetails);
        this._sanitizeOptions(this._options);
      }
      this._performRequest();
    };
    function wrap(protocols) {
      var exports2 = {
        maxRedirects: 21,
        maxBodyLength: 10 * 1024 * 1024
      };
      var nativeProtocols = {};
      Object.keys(protocols).forEach(function(scheme) {
        var protocol = scheme + ":";
        var nativeProtocol = nativeProtocols[protocol] = protocols[scheme];
        var wrappedProtocol = exports2[scheme] = Object.create(nativeProtocol);
        function request(input, options, callback) {
          if (isURL(input)) {
            input = spreadUrlObject(input);
          } else if (isString(input)) {
            input = spreadUrlObject(parseUrl(input));
          } else {
            callback = options;
            options = validateUrl(input);
            input = { protocol };
          }
          if (isFunction(options)) {
            callback = options;
            options = null;
          }
          options = Object.assign({
            maxRedirects: exports2.maxRedirects,
            maxBodyLength: exports2.maxBodyLength
          }, input, options);
          options.nativeProtocols = nativeProtocols;
          if (!isString(options.host) && !isString(options.hostname)) {
            options.hostname = "::1";
          }
          assert.equal(options.protocol, protocol, "protocol mismatch");
          debug("options", options);
          return new RedirectableRequest(options, callback);
        }
        function get(input, options, callback) {
          var wrappedRequest = wrappedProtocol.request(input, options, callback);
          wrappedRequest.end();
          return wrappedRequest;
        }
        Object.defineProperties(wrappedProtocol, {
          request: { value: request, configurable: true, enumerable: true, writable: true },
          get: { value: get, configurable: true, enumerable: true, writable: true }
        });
      });
      return exports2;
    }
    function noop() {
    }
    function parseUrl(input) {
      var parsed;
      if (useNativeURL) {
        parsed = new URL2(input);
      } else {
        parsed = validateUrl(url.parse(input));
        if (!isString(parsed.protocol)) {
          throw new InvalidUrlError({ input });
        }
      }
      return parsed;
    }
    function resolveUrl(relative, base) {
      return useNativeURL ? new URL2(relative, base) : parseUrl(url.resolve(base, relative));
    }
    function validateUrl(input) {
      if (/^\[/.test(input.hostname) && !/^\[[:0-9a-f]+\]$/i.test(input.hostname)) {
        throw new InvalidUrlError({ input: input.href || input });
      }
      if (/^\[/.test(input.host) && !/^\[[:0-9a-f]+\](:\d+)?$/i.test(input.host)) {
        throw new InvalidUrlError({ input: input.href || input });
      }
      return input;
    }
    function spreadUrlObject(urlObject, target) {
      var spread = target || {};
      for (var key of preservedUrlFields) {
        spread[key] = urlObject[key];
      }
      if (spread.hostname.startsWith("[")) {
        spread.hostname = spread.hostname.slice(1, -1);
      }
      if (spread.port !== "") {
        spread.port = Number(spread.port);
      }
      spread.path = spread.search ? spread.pathname + spread.search : spread.pathname;
      return spread;
    }
    function removeMatchingHeaders(regex, headers) {
      var lastValue;
      for (var header in headers) {
        if (regex.test(header)) {
          lastValue = headers[header];
          delete headers[header];
        }
      }
      return lastValue === null || typeof lastValue === "undefined" ? void 0 : String(lastValue).trim();
    }
    function createErrorType(code, message, baseClass) {
      function CustomError(properties) {
        if (isFunction(Error.captureStackTrace)) {
          Error.captureStackTrace(this, this.constructor);
        }
        Object.assign(this, properties || {});
        this.code = code;
        this.message = this.cause ? message + ": " + this.cause.message : message;
      }
      CustomError.prototype = new (baseClass || Error)();
      Object.defineProperties(CustomError.prototype, {
        constructor: {
          value: CustomError,
          enumerable: false
        },
        name: {
          value: "Error [" + code + "]",
          enumerable: false
        }
      });
      return CustomError;
    }
    function destroyRequest(request, error) {
      for (var event of events) {
        request.removeListener(event, eventHandlers[event]);
      }
      request.on("error", noop);
      request.destroy(error);
    }
    function isSubdomain(subdomain, domain) {
      assert(isString(subdomain) && isString(domain));
      var dot = subdomain.length - domain.length - 1;
      return dot > 0 && subdomain[dot] === "." && subdomain.endsWith(domain);
    }
    function isString(value) {
      return typeof value === "string" || value instanceof String;
    }
    function isFunction(value) {
      return typeof value === "function";
    }
    function isBuffer(value) {
      return typeof value === "object" && "length" in value;
    }
    function isURL(value) {
      return URL2 && value instanceof URL2;
    }
    module.exports = wrap({ http, https });
    module.exports.wrap = wrap;
  }
});

// node_modules/agent-base/dist/helpers.js
var require_helpers = __commonJS({
  "node_modules/agent-base/dist/helpers.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.req = exports.json = exports.toBuffer = void 0;
    var http = __importStar(__require("http"));
    var https = __importStar(__require("https"));
    async function toBuffer(stream) {
      let length = 0;
      const chunks = [];
      for await (const chunk of stream) {
        length += chunk.length;
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, length);
    }
    exports.toBuffer = toBuffer;
    async function json(stream) {
      const buf = await toBuffer(stream);
      const str = buf.toString("utf8");
      try {
        return JSON.parse(str);
      } catch (_err) {
        const err = _err;
        err.message += ` (input: ${str})`;
        throw err;
      }
    }
    exports.json = json;
    function req(url, opts = {}) {
      const href = typeof url === "string" ? url : url.href;
      const req2 = (href.startsWith("https:") ? https : http).request(url, opts);
      const promise = new Promise((resolve, reject) => {
        req2.once("response", resolve).once("error", reject).end();
      });
      req2.then = promise.then.bind(promise);
      return req2;
    }
    exports.req = req;
  }
});

// node_modules/agent-base/dist/index.js
var require_dist = __commonJS({
  "node_modules/agent-base/dist/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Agent = void 0;
    var net = __importStar(__require("net"));
    var http = __importStar(__require("http"));
    var https_1 = __require("https");
    __exportStar(require_helpers(), exports);
    var INTERNAL = /* @__PURE__ */ Symbol("AgentBaseInternalState");
    var Agent = class extends http.Agent {
      constructor(opts) {
        super(opts);
        this[INTERNAL] = {};
      }
      /**
       * Determine whether this is an `http` or `https` request.
       */
      isSecureEndpoint(options) {
        if (options) {
          if (typeof options.secureEndpoint === "boolean") {
            return options.secureEndpoint;
          }
          if (typeof options.protocol === "string") {
            return options.protocol === "https:";
          }
        }
        const { stack } = new Error();
        if (typeof stack !== "string")
          return false;
        return stack.split("\n").some((l) => l.indexOf("(https.js:") !== -1 || l.indexOf("node:https:") !== -1);
      }
      // In order to support async signatures in `connect()` and Node's native
      // connection pooling in `http.Agent`, the array of sockets for each origin
      // has to be updated synchronously. This is so the length of the array is
      // accurate when `addRequest()` is next called. We achieve this by creating a
      // fake socket and adding it to `sockets[origin]` and incrementing
      // `totalSocketCount`.
      incrementSockets(name) {
        if (this.maxSockets === Infinity && this.maxTotalSockets === Infinity) {
          return null;
        }
        if (!this.sockets[name]) {
          this.sockets[name] = [];
        }
        const fakeSocket = new net.Socket({ writable: false });
        this.sockets[name].push(fakeSocket);
        this.totalSocketCount++;
        return fakeSocket;
      }
      decrementSockets(name, socket) {
        if (!this.sockets[name] || socket === null) {
          return;
        }
        const sockets = this.sockets[name];
        const index = sockets.indexOf(socket);
        if (index !== -1) {
          sockets.splice(index, 1);
          this.totalSocketCount--;
          if (sockets.length === 0) {
            delete this.sockets[name];
          }
        }
      }
      // In order to properly update the socket pool, we need to call `getName()` on
      // the core `https.Agent` if it is a secureEndpoint.
      getName(options) {
        const secureEndpoint = this.isSecureEndpoint(options);
        if (secureEndpoint) {
          return https_1.Agent.prototype.getName.call(this, options);
        }
        return super.getName(options);
      }
      createSocket(req, options, cb) {
        const connectOpts = {
          ...options,
          secureEndpoint: this.isSecureEndpoint(options)
        };
        const name = this.getName(connectOpts);
        const fakeSocket = this.incrementSockets(name);
        Promise.resolve().then(() => this.connect(req, connectOpts)).then((socket) => {
          this.decrementSockets(name, fakeSocket);
          if (socket instanceof http.Agent) {
            try {
              return socket.addRequest(req, connectOpts);
            } catch (err) {
              return cb(err);
            }
          }
          this[INTERNAL].currentSocket = socket;
          super.createSocket(req, options, cb);
        }, (err) => {
          this.decrementSockets(name, fakeSocket);
          cb(err);
        });
      }
      createConnection() {
        const socket = this[INTERNAL].currentSocket;
        this[INTERNAL].currentSocket = void 0;
        if (!socket) {
          throw new Error("No socket was returned in the `connect()` function");
        }
        return socket;
      }
      get defaultPort() {
        return this[INTERNAL].defaultPort ?? (this.protocol === "https:" ? 443 : 80);
      }
      set defaultPort(v) {
        if (this[INTERNAL]) {
          this[INTERNAL].defaultPort = v;
        }
      }
      get protocol() {
        return this[INTERNAL].protocol ?? (this.isSecureEndpoint() ? "https:" : "http:");
      }
      set protocol(v) {
        if (this[INTERNAL]) {
          this[INTERNAL].protocol = v;
        }
      }
    };
    exports.Agent = Agent;
  }
});

// node_modules/https-proxy-agent/dist/parse-proxy-response.js
var require_parse_proxy_response = __commonJS({
  "node_modules/https-proxy-agent/dist/parse-proxy-response.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.parseProxyResponse = void 0;
    var debug_1 = __importDefault(require_src());
    var debug = (0, debug_1.default)("https-proxy-agent:parse-proxy-response");
    function parseProxyResponse(socket) {
      return new Promise((resolve, reject) => {
        let buffersLength = 0;
        const buffers = [];
        function read() {
          const b = socket.read();
          if (b)
            ondata(b);
          else
            socket.once("readable", read);
        }
        function cleanup() {
          socket.removeListener("end", onend);
          socket.removeListener("error", onerror);
          socket.removeListener("readable", read);
        }
        function onend() {
          cleanup();
          debug("onend");
          reject(new Error("Proxy connection ended before receiving CONNECT response"));
        }
        function onerror(err) {
          cleanup();
          debug("onerror %o", err);
          reject(err);
        }
        function ondata(b) {
          buffers.push(b);
          buffersLength += b.length;
          const buffered = Buffer.concat(buffers, buffersLength);
          const endOfHeaders = buffered.indexOf("\r\n\r\n");
          if (endOfHeaders === -1) {
            debug("have not received end of HTTP headers yet...");
            read();
            return;
          }
          const headerParts = buffered.slice(0, endOfHeaders).toString("ascii").split("\r\n");
          const firstLine = headerParts.shift();
          if (!firstLine) {
            socket.destroy();
            return reject(new Error("No header received from proxy CONNECT response"));
          }
          const firstLineParts = firstLine.split(" ");
          const statusCode = +firstLineParts[1];
          const statusText = firstLineParts.slice(2).join(" ");
          const headers = {};
          for (const header of headerParts) {
            if (!header)
              continue;
            const firstColon = header.indexOf(":");
            if (firstColon === -1) {
              socket.destroy();
              return reject(new Error(`Invalid header from proxy CONNECT response: "${header}"`));
            }
            const key = header.slice(0, firstColon).toLowerCase();
            const value = header.slice(firstColon + 1).trimStart();
            const current = headers[key];
            if (typeof current === "string") {
              headers[key] = [current, value];
            } else if (Array.isArray(current)) {
              current.push(value);
            } else {
              headers[key] = value;
            }
          }
          debug("got proxy server response: %o %o", firstLine, headers);
          cleanup();
          resolve({
            connect: {
              statusCode,
              statusText,
              headers
            },
            buffered
          });
        }
        socket.on("error", onerror);
        socket.on("end", onend);
        read();
      });
    }
    exports.parseProxyResponse = parseProxyResponse;
  }
});

// node_modules/https-proxy-agent/dist/index.js
var require_dist2 = __commonJS({
  "node_modules/https-proxy-agent/dist/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || function(mod) {
      if (mod && mod.__esModule) return mod;
      var result = {};
      if (mod != null) {
        for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
      }
      __setModuleDefault(result, mod);
      return result;
    };
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.HttpsProxyAgent = void 0;
    var net = __importStar(__require("net"));
    var tls = __importStar(__require("tls"));
    var assert_1 = __importDefault(__require("assert"));
    var debug_1 = __importDefault(require_src());
    var agent_base_1 = require_dist();
    var url_1 = __require("url");
    var parse_proxy_response_1 = require_parse_proxy_response();
    var debug = (0, debug_1.default)("https-proxy-agent");
    var setServernameFromNonIpHost = (options) => {
      if (options.servername === void 0 && options.host && !net.isIP(options.host)) {
        return {
          ...options,
          servername: options.host
        };
      }
      return options;
    };
    var HttpsProxyAgent = class extends agent_base_1.Agent {
      constructor(proxy, opts) {
        super(opts);
        this.options = { path: void 0 };
        this.proxy = typeof proxy === "string" ? new url_1.URL(proxy) : proxy;
        this.proxyHeaders = opts?.headers ?? {};
        debug("Creating new HttpsProxyAgent instance: %o", this.proxy.href);
        const host = (this.proxy.hostname || this.proxy.host).replace(/^\[|\]$/g, "");
        const port = this.proxy.port ? parseInt(this.proxy.port, 10) : this.proxy.protocol === "https:" ? 443 : 80;
        this.connectOpts = {
          // Attempt to negotiate http/1.1 for proxy servers that support http/2
          ALPNProtocols: ["http/1.1"],
          ...opts ? omit(opts, "headers") : null,
          host,
          port
        };
      }
      /**
       * Called when the node-core HTTP client library is creating a
       * new HTTP request.
       */
      async connect(req, opts) {
        const { proxy } = this;
        if (!opts.host) {
          throw new TypeError('No "host" provided');
        }
        let socket;
        if (proxy.protocol === "https:") {
          debug("Creating `tls.Socket`: %o", this.connectOpts);
          socket = tls.connect(setServernameFromNonIpHost(this.connectOpts));
        } else {
          debug("Creating `net.Socket`: %o", this.connectOpts);
          socket = net.connect(this.connectOpts);
        }
        const headers = typeof this.proxyHeaders === "function" ? this.proxyHeaders() : { ...this.proxyHeaders };
        const host = net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
        let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r
`;
        if (proxy.username || proxy.password) {
          const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
          headers["Proxy-Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
        }
        headers.Host = `${host}:${opts.port}`;
        if (!headers["Proxy-Connection"]) {
          headers["Proxy-Connection"] = this.keepAlive ? "Keep-Alive" : "close";
        }
        for (const name of Object.keys(headers)) {
          payload += `${name}: ${headers[name]}\r
`;
        }
        const proxyResponsePromise = (0, parse_proxy_response_1.parseProxyResponse)(socket);
        socket.write(`${payload}\r
`);
        const { connect, buffered } = await proxyResponsePromise;
        req.emit("proxyConnect", connect);
        this.emit("proxyConnect", connect, req);
        if (connect.statusCode === 200) {
          req.once("socket", resume);
          if (opts.secureEndpoint) {
            debug("Upgrading socket connection to TLS");
            return tls.connect({
              ...omit(setServernameFromNonIpHost(opts), "host", "path", "port"),
              socket
            });
          }
          return socket;
        }
        socket.destroy();
        const fakeSocket = new net.Socket({ writable: false });
        fakeSocket.readable = true;
        req.once("socket", (s) => {
          debug("Replaying proxy buffer for failed request");
          (0, assert_1.default)(s.listenerCount("data") > 0);
          s.push(buffered);
          s.push(null);
        });
        return fakeSocket;
      }
    };
    HttpsProxyAgent.protocols = ["http", "https"];
    exports.HttpsProxyAgent = HttpsProxyAgent;
    function resume(socket) {
      socket.resume();
    }
    function omit(obj, ...keys) {
      const ret = {};
      let key;
      for (key in obj) {
        if (!keys.includes(key)) {
          ret[key] = obj[key];
        }
      }
      return ret;
    }
  }
});

// node_modules/skia-canvas/lib/urls.js
var require_urls = __commonJS({
  "node_modules/skia-canvas/lib/urls.js"(exports, module) {
    "use strict";
    var url = __require("url");
    var { http, https } = require_follow_redirects();
    var { HttpsProxyAgent } = require_dist2();
    var UA = { "User-Agent": "Skia Canvas" };
    var PROXY_URL = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
    var fetchURL = (url2, opts, ok, fail) => {
      let proto = url2.slice(0, 5).split(":")[0], client = { http, https }[proto.toLowerCase()];
      if (!client) {
        fail(new Error(`Unsupported protocol: expected 'http' or 'https' (got: ${proto})`));
      } else {
        opts = opts || {};
        opts.headers = { ...UA, ...opts.headers };
        opts.agent = opts.agent === void 0 && PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : opts.agent;
        let req = client.request(url2, opts, (resp) => {
          if (resp.statusCode < 200 || resp.statusCode >= 300) {
            fail(new Error(`Failed to load image from "${url2}" (HTTP error ${resp.statusCode})`));
          } else {
            const chunks = [];
            resp.on("data", (chunk) => chunks.push(chunk));
            resp.on("end", () => ok(Buffer.concat(chunks)));
            resp.on("error", (e) => fail(e));
          }
        });
        req.on("error", (e) => fail(e));
        if (opts.body) req.write(opts.body);
        req.end();
      }
    };
    var decodeDataURL = (dataURL, ok, fail) => {
      if (typeof dataURL != "string") return fail(TypeError(`Expected a data URL string (got ${typeof dataURL})`));
      let [header, mime, enc] = dataURL.slice(0, 40).match(/^\s*data:(?<mime>[^;]*);(?:charset=)?(?<enc>[^,]*),/) || [];
      if (!mime || !enc) return fail(TypeError(`Expected a valid data URL string (got: "${dataURL}")`));
      let content = dataURL.slice(header.length);
      if (enc.toLowerCase() != "base64") content = decodeURIComponent(content);
      try {
        ok(Buffer.from(content, enc));
      } catch (e) {
        fail(e);
      }
    };
    var expandURL = (src) => {
      if (src instanceof URL) {
        if (src.protocol == "file:") src = url.fileURLToPath(src);
        else if (src.protocol.match(/^(https?|data):/)) src = src.href;
        else throw Error(`Unsupported protocol: ${src.protocol.replace(":", "")}`);
      }
      return src;
    };
    module.exports = { fetchURL, decodeDataURL, expandURL };
  }
});

// node_modules/skia-canvas/lib/classes/imagery.js
var require_imagery = __commonJS({
  "node_modules/skia-canvas/lib/classes/imagery.js"(exports, module) {
    "use strict";
    var { RustClass, core, readOnly, inspect, neon, argc, REPR } = require_neon();
    var { fetchURL, decodeDataURL, expandURL } = require_urls();
    var { EventEmitter } = __require("events");
    var { readFile } = __require("fs/promises");
    var DecodingError = () => new Error("Could not decode image data");
    var loadImage2 = (src, options) => new Promise(
      (res, rej) => fetchData(
        src,
        options,
        (data, src2, raw) => {
          let img = new Image2();
          img.prop("src", src2);
          if (img.prop("data", data, raw)) res(img);
          else rej(DecodingError());
        },
        rej
      )
    );
    var Image2 = class _Image extends RustClass {
      #fetch;
      #err;
      constructor(data, src = "") {
        super(_Image).alloc();
        data = expandURL(data);
        this.prop("src", "" + src || "::Buffer::");
        if (Buffer.isBuffer(data)) {
          if (!this.prop("data", data)) throw DecodingError();
        } else if (typeof data == "string") {
          decodeDataURL(
            data,
            (buffer) => {
              if (!this.prop("data", buffer)) throw DecodingError();
              if (!src) this.prop("src", data);
            },
            (err) => {
              throw err;
            }
          );
        } else if (data) {
          throw TypeError(`Exptected a Buffer or a String containing a data URL (got: ${data})`);
        }
      }
      get complete() {
        return this.prop("complete");
      }
      get height() {
        return this.prop("height");
      }
      get width() {
        return this.prop("width");
      }
      #onload;
      get onload() {
        return this.#onload;
      }
      set onload(cb) {
        if (this.#onload) this.off("load", this.#onload);
        this.#onload = typeof cb == "function" ? cb : null;
        if (this.#onload) this.on("load", this.#onload);
      }
      #onerror;
      get onerror() {
        return this.#onerror;
      }
      set onerror(cb) {
        if (this.#onerror) this.off("error", this.#onerror);
        this.#onerror = typeof cb == "function" ? cb : null;
        if (this.#onerror) this.on("error", this.#onerror);
      }
      get src() {
        return this.prop("src");
      }
      set src(src) {
        const request = this.#fetch = {};
        const loaded = (data, imgSrc, raw) => {
          if (request === this.#fetch) {
            this.#fetch = void 0;
            this.prop("src", imgSrc);
            this.#err = this.prop("data", data, raw) ? null : DecodingError();
            if (this.#err) this.emit("error", this.#err);
            else this.emit("load", this);
          }
        };
        const failed = (err) => {
          if (request === this.#fetch) {
            this.#fetch = void 0;
            this.#err = err;
            this.prop("data", Buffer.alloc(0));
            this.emit("error", err);
          }
        };
        src = expandURL(src);
        this.prop("src", typeof src == "string" ? src : "");
        fetchData(src, void 0, loaded, failed);
      }
      decode() {
        return this.#fetch ? new Promise((res, rej) => this.once("load", res).once("error", rej)) : this.#err ? Promise.reject(this.#err) : this.complete ? Promise.resolve(this) : Promise.reject(new Error("Image source not set"));
      }
      [REPR](depth, options) {
        let { width, height, complete, src } = this;
        options.maxStringLength = src.match(/^data:/) ? 128 : Infinity;
        return `Image ${inspect({ width, height, complete, src }, options)}`;
      }
    };
    Object.assign(Image2.prototype, EventEmitter.prototype);
    var loadImageData2 = (src, ...args) => new Promise((res, rej) => {
      let { colorType, colorSpace, ...options } = args[2] || {};
      fetchData(src, options, (data, src2, raw) => res(
        raw ? new ImageData2(data, raw.width, raw.height) : new ImageData2(data, ...args)
      ), rej);
    });
    var ImageData2 = class _ImageData {
      constructor(...args) {
        if (args[0] instanceof _ImageData) {
          argc(arguments, 1);
          var { data, width, height, colorSpace, colorType, bytesPerPixel } = args[0];
        } else if (args[0] instanceof Image2) {
          argc(arguments, 1);
          var [image, { colorSpace = "srgb", colorType = "rgba" } = {}] = args, { width, height } = image, bytesPerPixel = pixelSize(colorType), buffer = neon.Image.pixels(core(image), { colorType }), data = new Uint8ClampedArray(buffer);
        } else if (args[0] instanceof Uint8ClampedArray || args[0] instanceof Buffer) {
          argc(arguments, 2);
          var [data, width, height, { colorSpace = "srgb", colorType = "rgba" } = {}] = args, bytesPerPixel = pixelSize(colorType);
          width = Math.floor(Math.abs(width));
          height = Math.floor(Math.abs(height || data.length / width / bytesPerPixel));
          data = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
          if (data.length / bytesPerPixel != width * height) {
            throw new TypeError("ImageData dimensions must match buffer length");
          }
        } else {
          argc(arguments, 2);
          var [width, height, { colorSpace = "srgb", colorType = "rgba" } = {}] = args, bytesPerPixel = pixelSize(colorType);
          width = Math.floor(Math.abs(width));
          height = Math.floor(Math.abs(height));
        }
        if (!["srgb"].includes(colorSpace)) {
          throw TypeError(`Unsupported colorSpace: ${colorSpace}`);
        }
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
          throw RangeError("Dimensions must be non-zero");
        }
        readOnly(this, "colorSpace", colorSpace);
        readOnly(this, "colorType", colorType);
        readOnly(this, "width", width);
        readOnly(this, "height", height);
        readOnly(this, "bytesPerPixel", bytesPerPixel);
        readOnly(this, "data", data || new Uint8ClampedArray(width * height * bytesPerPixel));
      }
      toSharp() {
        const sharp = getSharp();
        let { width, height, bytesPerPixel: channels } = this;
        return sharp(this.data, { raw: { width, height, channels } }).withMetadata({ density: 72 });
      }
      [REPR](depth, options) {
        let { width, height, colorType, bytesPerPixel, data } = this;
        return `ImageData ${inspect({ width, height, colorType, bytesPerPixel, data }, options)}`;
      }
    };
    function pixelSize(colorType) {
      const bpp = ["Alpha8", "Gray8", "R8UNorm"].includes(colorType) ? 1 : ["A16Float", "A16UNorm", "ARGB4444", "R8G8UNorm", "RGB565"].includes(colorType) ? 2 : [
        "rgb",
        "rgba",
        "bgra",
        "BGR101010x",
        "BGRA1010102",
        "BGRA8888",
        "R16G16Float",
        "R16G16UNorm",
        "RGB101010x",
        "RGB888x",
        "RGBA1010102",
        "RGBA8888",
        "RGBA8888",
        "SRGBA8888"
      ].includes(colorType) ? 4 : ["R16G16B16A16UNorm", "RGBAF16", "RGBAF16Norm"].includes(colorType) ? 8 : colorType == "RGBAF32" ? 16 : 0;
      if (!bpp) throw new TypeError(`Unknown colorType: ${colorType}`);
      return bpp;
    }
    function getSharp() {
      try {
        return __require("sharp");
      } catch (e) {
        throw Error("Cannot find module 'sharp' (try running `npm install sharp` first)");
      }
    }
    function isSharpImage(obj) {
      try {
        return obj instanceof __require("sharp");
      } catch {
        return false;
      }
    }
    var fetchData = (src, reqOpts, loaded, failed) => {
      src = expandURL(src);
      if (Buffer.isBuffer(src)) {
        loaded(src, "::Buffer::");
      } else if (isSharpImage(src)) {
        src.ensureAlpha().raw().toBuffer((err, buf, info) => {
          let { options: { input: { file, buffer } } } = src;
          if (err) failed(err);
          else loaded(buf, buffer ? "::Sharp::" : file, info);
        });
      } else {
        src = typeof src == "string" ? src : "" + src;
        if (src.startsWith("data:")) {
          decodeDataURL(
            src,
            (buffer) => loaded(buffer, src),
            (err) => failed(err)
          );
        } else if (/^\s*https?:\/\//.test(src)) {
          fetchURL(
            src,
            reqOpts,
            (buffer) => loaded(buffer, src),
            (err) => failed(err)
          );
        } else {
          readFile(src).then((data) => loaded(data, src)).catch((e) => failed(e));
        }
      }
    };
    module.exports = { Image: Image2, ImageData: ImageData2, loadImage: loadImage2, loadImageData: loadImageData2, pixelSize, getSharp };
  }
});

// node_modules/skia-canvas/lib/classes/geometry.js
var require_geometry = __commonJS({
  "node_modules/skia-canvas/lib/classes/geometry.js"(exports, module) {
    "use strict";
    var { inspect } = __require("util");
    var isPlainObject = (o) => o !== null && typeof o === "object" && !(o instanceof DOMMatrix2) && !Array.isArray(o) && !ArrayBuffer.isView(o);
    var DOMPoint2 = class _DOMPoint {
      constructor(x = 0, y = 0, z = 0, w = 1) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.w = w;
      }
      static fromPoint(otherPoint) {
        return new _DOMPoint(
          otherPoint.x,
          otherPoint.y,
          otherPoint.z !== void 0 ? otherPoint.z : 0,
          otherPoint.w !== void 0 ? otherPoint.w : 1
        );
      }
      matrixTransform(matrix) {
        if (matrix.is2D && this.z === 0 && this.w === 1) {
          return new _DOMPoint(
            this.x * matrix.a + this.y * matrix.c + matrix.e,
            this.x * matrix.b + this.y * matrix.d + matrix.f,
            0,
            1
          );
        } else {
          return new _DOMPoint(
            this.x * matrix.m11 + this.y * matrix.m21 + this.z * matrix.m31 + this.w * matrix.m41,
            this.x * matrix.m12 + this.y * matrix.m22 + this.z * matrix.m32 + this.w * matrix.m42,
            this.x * matrix.m13 + this.y * matrix.m23 + this.z * matrix.m33 + this.w * matrix.m43,
            this.x * matrix.m14 + this.y * matrix.m24 + this.z * matrix.m34 + this.w * matrix.m44
          );
        }
      }
      toJSON() {
        return {
          x: this.x,
          y: this.y,
          z: this.z,
          w: this.w
        };
      }
    };
    var DOMRect2 = class _DOMRect {
      constructor(x = 0, y = 0, width = 0, height = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
      }
      static fromRect(otherRect) {
        return new _DOMRect(otherRect.x, otherRect.y, otherRect.width, otherRect.height);
      }
      get top() {
        return this.y;
      }
      get left() {
        return this.x;
      }
      get right() {
        return this.x + this.width;
      }
      get bottom() {
        return this.y + this.height;
      }
      toJSON() {
        return {
          x: this.x,
          y: this.y,
          width: this.width,
          height: this.height,
          top: this.top,
          left: this.left,
          right: this.right,
          bottom: this.bottom
        };
      }
    };
    for (let propertyName of ["top", "right", "bottom", "left"]) {
      let propertyDescriptor = Object.getOwnPropertyDescriptor(DOMRect2.prototype, propertyName);
      propertyDescriptor.enumerable = true;
      Object.defineProperty(DOMRect2.prototype, propertyName, propertyDescriptor);
    }
    var M11 = 0;
    var M12 = 1;
    var M13 = 2;
    var M14 = 3;
    var M21 = 4;
    var M22 = 5;
    var M23 = 6;
    var M24 = 7;
    var M31 = 8;
    var M32 = 9;
    var M33 = 10;
    var M34 = 11;
    var M41 = 12;
    var M42 = 13;
    var M43 = 14;
    var M44 = 15;
    var A = M11;
    var B = M12;
    var C = M21;
    var D = M22;
    var E = M41;
    var F = M42;
    var DEGREE_PER_RAD = 180 / Math.PI;
    var RAD_PER_DEGREE = Math.PI / 180;
    var $values = /* @__PURE__ */ Symbol();
    var $is2D = /* @__PURE__ */ Symbol();
    var parseTransformName = (name) => name.match(/^(matrix(3d)?|(rotate|translate|scale)(3d|X|Y|Z)?|skew(X|Y)?)$/);
    var parseAngle = (value) => {
      if (value.endsWith("deg")) return parseFloat(value);
      if (value.endsWith("rad")) return parseFloat(value) / Math.PI * 180;
      if (value.endsWith("turn")) return parseFloat(value) * 360;
      throw new TypeError(`Angles must be in 'deg', 'rad', or 'turn' units (got: "${value}")`);
    };
    var parseLength = (value) => {
      if (value.endsWith("px")) return parseFloat(value);
      if (!isNaN(value) && !isNaN(parseFloat(value))) return parseFloat(value);
      throw new TypeError(`Lengths must be in 'px' or numeric units (got: "${value}")`);
    };
    var parseScalar = (value) => {
      if (value.endsWith("%")) return parseFloat(value) / 100;
      if (!isNaN(value) && !isNaN(parseFloat(value))) return parseFloat(value);
      throw new TypeError(`Scales must be in '%' or numeric units (got: "${value}")`);
    };
    var parseNumeric = (value) => {
      if (!isNaN(value) && !isNaN(parseFloat(value))) return parseFloat(value);
      throw new TypeError(`Matrix values must be in plain, numeric units (got: "${value}")`);
    };
    var parseTransformString = (transformString) => {
      return transformString.split(/\)\s*?/).filter((s) => !!s.trim()).map((transform) => {
        let [name, transformValue] = transform.split("(").map((s) => s.trim());
        if (!transformValue) {
          if (name.match(/^(inherit|initial|revert(-layer)?|unset|none)$/)) return { op: "matrix", vals: [1, 0, 0, 1, 0, 0] };
          throw new SyntaxError("The string did not match the expected pattern");
        }
        if (!transformString.trim().endsWith(")")) {
          throw new SyntaxError("Expected a closing ')'");
        }
        if (!parseTransformName(name)) {
          throw new SyntaxError(`Unknown transform operation: ${name}`);
        } else if (name == "rotate3d") {
          name = "rotateAxisAngle";
        }
        const rawVals = transformValue.split(",").map((s) => s.trim());
        const values = name.startsWith("rotate") ? [
          ...rawVals.slice(0, -1).map(parseLength),
          parseAngle(rawVals.at(-1))
        ] : name.startsWith("skew") ? rawVals.map(parseAngle) : name.startsWith("scale") ? rawVals.map(parseScalar) : name.startsWith("matrix") ? rawVals.map(parseNumeric) : rawVals.map(parseLength);
        for (const [form, len] of [["matrix", 6], ["matrix3d", 16]]) {
          if (name == form && values.length != len) {
            throw new TypeError(`${name}() requires 6 numeric values (got ${values.length})`);
          }
        }
        const parts = name.match(/^(rotate|translate|scale)(3d|X|Y|Z)$/);
        if (parts) {
          const [_, op, dim] = parts;
          const fill = op == "scale" ? 1 : 0;
          return { op, vals: dim == "X" ? [values[0], fill, fill] : dim == "Y" ? [fill, values[0], fill] : dim == "Z" ? [fill, fill, values[0]] : values };
        } else {
          return { op: name, vals: values };
        }
      }).flat();
    };
    var setNumber2D = (receiver, index, value) => {
      if (typeof value !== "number") {
        throw new TypeError("Expected number");
      }
      receiver[$values][index] = value;
    };
    var setNumber3D = (receiver, index, value) => {
      if (typeof value !== "number") {
        throw new TypeError("Expected number");
      }
      if (index === M33 || index === M44) {
        if (value !== 1) {
          receiver[$is2D] = false;
        }
      } else if (value !== 0) {
        receiver[$is2D] = false;
      }
      receiver[$values][index] = value;
    };
    var newInstance = (values) => {
      let instance = Object.create(DOMMatrix2.prototype);
      instance.constructor = DOMMatrix2;
      instance[$is2D] = true;
      instance[$values] = values;
      return instance;
    };
    var multiply = (first, second) => {
      let dest = new Float64Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            sum += first[i * 4 + k] * second[k * 4 + j];
          }
          dest[i * 4 + j] = sum;
        }
      }
      return dest;
    };
    var DOMMatrix2 = class _DOMMatrix {
      get m11() {
        return this[$values][M11];
      }
      set m11(value) {
        setNumber2D(this, M11, value);
      }
      get m12() {
        return this[$values][M12];
      }
      set m12(value) {
        setNumber2D(this, M12, value);
      }
      get m13() {
        return this[$values][M13];
      }
      set m13(value) {
        setNumber3D(this, M13, value);
      }
      get m14() {
        return this[$values][M14];
      }
      set m14(value) {
        setNumber3D(this, M14, value);
      }
      get m21() {
        return this[$values][M21];
      }
      set m21(value) {
        setNumber2D(this, M21, value);
      }
      get m22() {
        return this[$values][M22];
      }
      set m22(value) {
        setNumber2D(this, M22, value);
      }
      get m23() {
        return this[$values][M23];
      }
      set m23(value) {
        setNumber3D(this, M23, value);
      }
      get m24() {
        return this[$values][M24];
      }
      set m24(value) {
        setNumber3D(this, M24, value);
      }
      get m31() {
        return this[$values][M31];
      }
      set m31(value) {
        setNumber3D(this, M31, value);
      }
      get m32() {
        return this[$values][M32];
      }
      set m32(value) {
        setNumber3D(this, M32, value);
      }
      get m33() {
        return this[$values][M33];
      }
      set m33(value) {
        setNumber3D(this, M33, value);
      }
      get m34() {
        return this[$values][M34];
      }
      set m34(value) {
        setNumber3D(this, M34, value);
      }
      get m41() {
        return this[$values][M41];
      }
      set m41(value) {
        setNumber2D(this, M41, value);
      }
      get m42() {
        return this[$values][M42];
      }
      set m42(value) {
        setNumber2D(this, M42, value);
      }
      get m43() {
        return this[$values][M43];
      }
      set m43(value) {
        setNumber3D(this, M43, value);
      }
      get m44() {
        return this[$values][M44];
      }
      set m44(value) {
        setNumber3D(this, M44, value);
      }
      get a() {
        return this[$values][A];
      }
      set a(value) {
        setNumber2D(this, A, value);
      }
      get b() {
        return this[$values][B];
      }
      set b(value) {
        setNumber2D(this, B, value);
      }
      get c() {
        return this[$values][C];
      }
      set c(value) {
        setNumber2D(this, C, value);
      }
      get d() {
        return this[$values][D];
      }
      set d(value) {
        setNumber2D(this, D, value);
      }
      get e() {
        return this[$values][E];
      }
      set e(value) {
        setNumber2D(this, E, value);
      }
      get f() {
        return this[$values][F];
      }
      set f(value) {
        setNumber2D(this, F, value);
      }
      get is2D() {
        return this[$is2D];
      }
      get isIdentity() {
        let values = this[$values];
        return values[M11] === 1 && values[M12] === 0 && values[M13] === 0 && values[M14] === 0 && values[M21] === 0 && values[M22] === 1 && values[M23] === 0 && values[M24] === 0 && values[M31] === 0 && values[M32] === 0 && values[M33] === 1 && values[M34] === 0 && values[M41] === 0 && values[M42] === 0 && values[M43] === 0 && values[M44] === 1;
      }
      static fromMatrix(init) {
        if (init instanceof _DOMMatrix)
          return new _DOMMatrix(init[$values]);
        if (_DOMMatrix.isMatrix4(init))
          return new _DOMMatrix([
            init.m11,
            init.m12,
            init.m13,
            init.m14,
            init.m21,
            init.m22,
            init.m23,
            init.m24,
            init.m31,
            init.m32,
            init.m33,
            init.m34,
            init.m41,
            init.m42,
            init.m43,
            init.m44
          ]);
        if (_DOMMatrix.isMatrix3(init) || isPlainObject(init)) {
          let { a = 1, b = 0, c = 0, d = 1, e = 0, f = 0 } = init;
          return new _DOMMatrix([a, b, c, d, e, f]);
        }
        throw new TypeError(`Expected DOMMatrix, got: '${init}'`);
      }
      static fromFloat32Array(init) {
        if (!(init instanceof Float32Array)) throw new TypeError("Expected Float32Array");
        return new _DOMMatrix(init);
      }
      static fromFloat64Array(init) {
        if (!(init instanceof Float64Array)) throw new TypeError("Expected Float64Array");
        return new _DOMMatrix(init);
      }
      static isMatrix3(matrix) {
        if (matrix instanceof _DOMMatrix)
          return true;
        if (typeof matrix != "object")
          return false;
        for (const p of ["a", "b", "c", "d", "e", "f"])
          if (typeof matrix[p] != "number")
            return false;
        return true;
      }
      static isMatrix4(matrix) {
        if (matrix instanceof _DOMMatrix)
          return true;
        if (typeof matrix != "object")
          return false;
        for (const p of [
          "m11",
          "m12",
          "m13",
          "m14",
          "m21",
          "m22",
          "m23",
          "m24",
          "m31",
          "m32",
          "m33",
          "m34",
          "m41",
          "m42",
          "m43",
          "m44"
        ]) {
          if (typeof matrix[p] != "number")
            return false;
        }
        return true;
      }
      // @type
      // (Float64Array) => void
      constructor(init) {
        if (init instanceof _DOMMatrix || isPlainObject(init))
          return _DOMMatrix.fromMatrix(init);
        if (arguments.length > 1)
          init = [...arguments];
        this[$is2D] = true;
        this[$values] = new Float64Array([
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ]);
        if (typeof init === "string") {
          if (init === "") return;
          let acc = new _DOMMatrix();
          for (const { op, vals } of parseTransformString(init)) {
            acc = op.startsWith("matrix") ? acc.multiply(new _DOMMatrix(vals)) : acc[op] ? acc[op](...vals) : acc;
          }
          init = acc[$values];
        }
        let i = 0;
        if (init && init.length === 6) {
          setNumber2D(this, A, init[i++]);
          setNumber2D(this, B, init[i++]);
          setNumber2D(this, C, init[i++]);
          setNumber2D(this, D, init[i++]);
          setNumber2D(this, E, init[i++]);
          setNumber2D(this, F, init[i++]);
        } else if (init && init.length === 16) {
          setNumber2D(this, M11, init[i++]);
          setNumber2D(this, M12, init[i++]);
          setNumber3D(this, M13, init[i++]);
          setNumber3D(this, M14, init[i++]);
          setNumber2D(this, M21, init[i++]);
          setNumber2D(this, M22, init[i++]);
          setNumber3D(this, M23, init[i++]);
          setNumber3D(this, M24, init[i++]);
          setNumber3D(this, M31, init[i++]);
          setNumber3D(this, M32, init[i++]);
          setNumber3D(this, M33, init[i++]);
          setNumber3D(this, M34, init[i++]);
          setNumber2D(this, M41, init[i++]);
          setNumber2D(this, M42, init[i++]);
          setNumber3D(this, M43, init[i++]);
          setNumber3D(this, M44, init[i]);
        } else if (init !== void 0) {
          throw new TypeError("Expected string, array, or matrix object.");
        }
      }
      dump() {
        let mat = this[$values];
        console.log([
          mat.slice(0, 4),
          mat.slice(4, 8),
          mat.slice(8, 12),
          mat.slice(12, 16)
        ]);
      }
      [inspect.custom](depth, options) {
        if (depth < 0) return "[DOMMatrix]";
        let { a, b, c, d, e, f, is2D, isIdentity } = this;
        if (this.is2D) {
          return `DOMMatrix ${inspect({ a, b, c, d, e, f, is2D, isIdentity }, { colors: true })}`;
        } else {
          let { m11, m12, m13, m14, m21, m22, m23, m24, m31, m32, m33, m34, m41, m42, m43, m44, is2D: is2D2, isIdentity: isIdentity2 } = this;
          return `DOMMatrix ${inspect({ a, b, c, d, e, f, m11, m12, m13, m14, m21, m22, m23, m24, m31, m32, m33, m34, m41, m42, m43, m44, is2D: is2D2, isIdentity: isIdentity2 }, { colors: true })}`;
        }
      }
      multiply(other) {
        return newInstance(this[$values]).multiplySelf(other);
      }
      multiplySelf(other) {
        this[$values] = multiply(other[$values], this[$values]);
        if (!other.is2D) {
          this[$is2D] = false;
        }
        return this;
      }
      preMultiplySelf(other) {
        this[$values] = multiply(this[$values], other[$values]);
        if (!other.is2D) {
          this[$is2D] = false;
        }
        return this;
      }
      translate(tx, ty, tz) {
        return newInstance(this[$values]).translateSelf(tx, ty, tz);
      }
      translateSelf(tx = 0, ty = 0, tz = 0) {
        this[$values] = multiply([
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          tx,
          ty,
          tz,
          1
        ], this[$values]);
        if (tz !== 0) {
          this[$is2D] = false;
        }
        return this;
      }
      scale(scaleX, scaleY, scaleZ, originX, originY, originZ) {
        return newInstance(this[$values]).scaleSelf(scaleX, scaleY, scaleZ, originX, originY, originZ);
      }
      scale3d(scale, originX, originY, originZ) {
        return newInstance(this[$values]).scale3dSelf(scale, originX, originY, originZ);
      }
      scale3dSelf(scale, originX, originY, originZ) {
        return this.scaleSelf(scale, scale, scale, originX, originY, originZ);
      }
      scaleSelf(scaleX, scaleY, scaleZ, originX, originY, originZ) {
        if (typeof originX !== "number") originX = 0;
        if (typeof originY !== "number") originY = 0;
        if (typeof originZ !== "number") originZ = 0;
        this.translateSelf(originX, originY, originZ);
        if (typeof scaleX !== "number") scaleX = 1;
        if (typeof scaleY !== "number") scaleY = scaleX;
        if (typeof scaleZ !== "number") scaleZ = 1;
        this[$values] = multiply([
          scaleX,
          0,
          0,
          0,
          0,
          scaleY,
          0,
          0,
          0,
          0,
          scaleZ,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        this.translateSelf(-originX, -originY, -originZ);
        if (scaleZ !== 1 || originZ !== 0) {
          this[$is2D] = false;
        }
        return this;
      }
      rotateFromVector(x, y) {
        return newInstance(this[$values]).rotateFromVectorSelf(x, y);
      }
      rotateFromVectorSelf(x = 0, y = 0) {
        let theta = x === 0 && y === 0 ? 0 : Math.atan2(y, x) * DEGREE_PER_RAD;
        return this.rotateSelf(theta);
      }
      rotate(rotX, rotY, rotZ) {
        return newInstance(this[$values]).rotateSelf(rotX, rotY, rotZ);
      }
      rotateSelf(rotX, rotY, rotZ) {
        if (rotY === void 0 && rotZ === void 0) {
          rotZ = rotX;
          rotX = rotY = 0;
        }
        if (typeof rotY !== "number") rotY = 0;
        if (typeof rotZ !== "number") rotZ = 0;
        if (rotX !== 0 || rotY !== 0) {
          this[$is2D] = false;
        }
        rotX *= RAD_PER_DEGREE;
        rotY *= RAD_PER_DEGREE;
        rotZ *= RAD_PER_DEGREE;
        let c = Math.cos(rotZ);
        let s = Math.sin(rotZ);
        this[$values] = multiply([
          c,
          s,
          0,
          0,
          -s,
          c,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        c = Math.cos(rotY);
        s = Math.sin(rotY);
        this[$values] = multiply([
          c,
          0,
          -s,
          0,
          0,
          1,
          0,
          0,
          s,
          0,
          c,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        c = Math.cos(rotX);
        s = Math.sin(rotX);
        this[$values] = multiply([
          1,
          0,
          0,
          0,
          0,
          c,
          s,
          0,
          0,
          -s,
          c,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        return this;
      }
      rotateAxisAngle(x, y, z, angle) {
        return newInstance(this[$values]).rotateAxisAngleSelf(x, y, z, angle);
      }
      rotateAxisAngleSelf(x = 0, y = 0, z = 0, angle = 0) {
        let length = Math.sqrt(x * x + y * y + z * z);
        if (length === 0) {
          return this;
        }
        if (length !== 1) {
          x /= length;
          y /= length;
          z /= length;
        }
        angle *= RAD_PER_DEGREE;
        let c = Math.cos(angle);
        let s = Math.sin(angle);
        let t = 1 - c;
        let tx = t * x;
        let ty = t * y;
        this[$values] = multiply([
          tx * x + c,
          tx * y + s * z,
          tx * z - s * y,
          0,
          tx * y - s * z,
          ty * y + c,
          ty * z + s * x,
          0,
          tx * z + s * y,
          ty * z - s * x,
          t * z * z + c,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        if (x !== 0 || y !== 0) {
          this[$is2D] = false;
        }
        return this;
      }
      skew(sx, sy) {
        return newInstance(this[$values]).skewSelf(sx, sy);
      }
      skewSelf(sx, sy) {
        if (typeof sx !== "number" && typeof sy !== "number") {
          return this;
        }
        let x = isNaN(sx) ? 0 : Math.tan(sx * RAD_PER_DEGREE);
        let y = isNaN(sy) ? 0 : Math.tan(sy * RAD_PER_DEGREE);
        this[$values] = multiply([
          1,
          y,
          0,
          0,
          x,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        return this;
      }
      skewX(sx) {
        return newInstance(this[$values]).skewXSelf(sx);
      }
      skewXSelf(sx) {
        if (typeof sx !== "number") {
          return this;
        }
        let t = Math.tan(sx * RAD_PER_DEGREE);
        this[$values] = multiply([
          1,
          0,
          0,
          0,
          t,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        return this;
      }
      skewY(sy) {
        return newInstance(this[$values]).skewYSelf(sy);
      }
      skewYSelf(sy) {
        if (typeof sy !== "number") {
          return this;
        }
        let t = Math.tan(sy * RAD_PER_DEGREE);
        this[$values] = multiply([
          1,
          t,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ], this[$values]);
        return this;
      }
      flipX() {
        return newInstance(multiply([
          -1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ], this[$values]));
      }
      flipY() {
        return newInstance(multiply([
          1,
          0,
          0,
          0,
          0,
          -1,
          0,
          0,
          0,
          0,
          1,
          0,
          0,
          0,
          0,
          1
        ], this[$values]));
      }
      inverse() {
        return newInstance(this[$values]).invertSelf();
      }
      invertSelf() {
        if (this[$is2D]) {
          let det = this[$values][A] * this[$values][D] - this[$values][B] * this[$values][C];
          if (det !== 0) {
            let result = new _DOMMatrix();
            result.a = this[$values][D] / det;
            result.b = -this[$values][B] / det;
            result.c = -this[$values][C] / det;
            result.d = this[$values][A] / det;
            result.e = (this[$values][C] * this[$values][F] - this[$values][D] * this[$values][E]) / det;
            result.f = (this[$values][B] * this[$values][E] - this[$values][A] * this[$values][F]) / det;
            return result;
          } else {
            this[$is2D] = false;
            this[$values] = [
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN,
              NaN
            ];
          }
        } else {
          throw new Error("3D matrix inversion is not implemented.");
        }
      }
      setMatrixValue(transformList) {
        let temp = new _DOMMatrix(transformList);
        this[$values] = temp[$values];
        this[$is2D] = temp[$is2D];
        return this;
      }
      transformPoint(point) {
        let x = point.x;
        let y = point.y;
        let z = point.z;
        let w = point.w;
        let values = this[$values];
        let nx = values[M11] * x + values[M21] * y + values[M31] * z + values[M41] * w;
        let ny = values[M12] * x + values[M22] * y + values[M32] * z + values[M42] * w;
        let nz = values[M13] * x + values[M23] * y + values[M33] * z + values[M43] * w;
        let nw = values[M14] * x + values[M24] * y + values[M34] * z + values[M44] * w;
        return new DOMPoint2(nx, ny, nz, nw);
      }
      toFloat32Array() {
        return Float32Array.from(this[$values]);
      }
      toFloat64Array() {
        return this[$values].slice(0);
      }
      toJSON() {
        return {
          a: this.a,
          b: this.b,
          c: this.c,
          d: this.d,
          e: this.e,
          f: this.f,
          m11: this.m11,
          m12: this.m12,
          m13: this.m13,
          m14: this.m14,
          m21: this.m21,
          m22: this.m22,
          m23: this.m23,
          m24: this.m24,
          m31: this.m31,
          m32: this.m32,
          m33: this.m33,
          m34: this.m34,
          m41: this.m41,
          m42: this.m42,
          m43: this.m43,
          m44: this.m44,
          is2D: this.is2D,
          isIdentity: this.isIdentity
        };
      }
      toString() {
        let name = this.is2D ? "matrix" : "matrix3d";
        let values = this.is2D ? [this.a, this.b, this.c, this.d, this.e, this.f] : this[$values];
        let simplify = (n) => n.toFixed(12).replace(/\.([^0])?0*$/, ".$1").replace(/\.$/, "").replace(/^-0$/, "0");
        return `${name}(${values.map(simplify).join(", ")})`;
      }
      clone() {
        return new _DOMMatrix(this);
      }
    };
    for (let propertyName of [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "m11",
      "m12",
      "m13",
      "m14",
      "m21",
      "m22",
      "m23",
      "m24",
      "m31",
      "m32",
      "m33",
      "m34",
      "m41",
      "m42",
      "m43",
      "m44",
      "is2D",
      "isIdentity"
    ]) {
      let propertyDescriptor = Object.getOwnPropertyDescriptor(DOMMatrix2.prototype, propertyName);
      propertyDescriptor.enumerable = true;
      Object.defineProperty(DOMMatrix2.prototype, propertyName, propertyDescriptor);
    }
    function toSkMatrix() {
      if (arguments.length != 1 && arguments.length < 6) {
        throw new TypeError("not enough arguments");
      }
      try {
        const m = new DOMMatrix2(...arguments);
        return [m.a, m.c, m.e, m.b, m.d, m.f, m.m14, m.m24, m.m44];
      } catch (e) {
        throw new TypeError(`Invalid transform matrix argument(s): ` + e);
      }
    }
    function fromSkMatrix(skMatrix) {
      let [a, b, c, d, e, f, p0, p1, p2] = skMatrix;
      return new DOMMatrix2([
        a,
        d,
        0,
        p0,
        b,
        e,
        0,
        p1,
        0,
        0,
        1,
        0,
        c,
        f,
        0,
        p2
      ]);
    }
    module.exports = { DOMPoint: DOMPoint2, DOMMatrix: DOMMatrix2, DOMRect: DOMRect2, toSkMatrix, fromSkMatrix };
  }
});

// node_modules/parenthesis/index.js
var require_parenthesis = __commonJS({
  "node_modules/parenthesis/index.js"(exports, module) {
    "use strict";
    function parse(str, opts) {
      if (typeof str !== "string") return [str];
      var res = [str];
      if (typeof opts === "string" || Array.isArray(opts)) {
        opts = { brackets: opts };
      } else if (!opts) opts = {};
      var brackets = opts.brackets ? Array.isArray(opts.brackets) ? opts.brackets : [opts.brackets] : ["{}", "[]", "()"];
      var escape = opts.escape || "___";
      var flat = !!opts.flat;
      brackets.forEach(function(bracket) {
        var pRE = new RegExp(["\\", bracket[0], "[^\\", bracket[0], "\\", bracket[1], "]*\\", bracket[1]].join(""));
        var ids = [];
        function replaceToken(token, idx, str2) {
          var refId = res.push(token.slice(bracket[0].length, -bracket[1].length)) - 1;
          ids.push(refId);
          return escape + refId + escape;
        }
        res.forEach(function(str2, i) {
          var prevStr;
          var a = 0;
          while (str2 != prevStr) {
            prevStr = str2;
            str2 = str2.replace(pRE, replaceToken);
            if (a++ > 1e4) throw Error("References have circular dependency. Please, check them.");
          }
          res[i] = str2;
        });
        ids = ids.reverse();
        res = res.map(function(str2) {
          ids.forEach(function(id) {
            str2 = str2.replace(new RegExp("(\\" + escape + id + "\\" + escape + ")", "g"), bracket[0] + "$1" + bracket[1]);
          });
          return str2;
        });
      });
      var re = new RegExp("\\" + escape + "([0-9]+)\\" + escape);
      function nest(str2, refs, escape2) {
        var res2 = [], match;
        var a = 0;
        while (match = re.exec(str2)) {
          if (a++ > 1e4) throw Error("Circular references in parenthesis");
          res2.push(str2.slice(0, match.index));
          res2.push(nest(refs[match[1]], refs));
          str2 = str2.slice(match.index + match[0].length);
        }
        res2.push(str2);
        return res2;
      }
      return flat ? res : nest(res[0], res);
    }
    function stringify(arg, opts) {
      if (opts && opts.flat) {
        var escape = opts && opts.escape || "___";
        var str = arg[0], prevStr;
        if (!str) return "";
        var re = new RegExp("\\" + escape + "([0-9]+)\\" + escape);
        var a = 0;
        while (str != prevStr) {
          if (a++ > 1e4) throw Error("Circular references in " + arg);
          prevStr = str;
          str = str.replace(re, replaceRef);
        }
        return str;
      }
      return arg.reduce(function f(prev, curr) {
        if (Array.isArray(curr)) {
          curr = curr.reduce(f, "");
        }
        return prev + curr;
      }, "");
      function replaceRef(match, idx) {
        if (arg[idx] == null) throw Error("Reference " + idx + "is undefined");
        return arg[idx];
      }
    }
    function parenthesis(arg, opts) {
      if (Array.isArray(arg)) {
        return stringify(arg, opts);
      } else {
        return parse(arg, opts);
      }
    }
    parenthesis.parse = parse;
    parenthesis.stringify = stringify;
    module.exports = parenthesis;
  }
});

// node_modules/string-split-by/index.js
var require_string_split_by = __commonJS({
  "node_modules/string-split-by/index.js"(exports, module) {
    "use strict";
    var paren = require_parenthesis();
    module.exports = function splitBy(string, separator, o) {
      if (string == null) throw Error("First argument should be a string");
      if (separator == null) throw Error("Separator should be a string or a RegExp");
      if (!o) o = {};
      else if (typeof o === "string" || Array.isArray(o)) {
        o = { ignore: o };
      }
      if (o.escape == null) o.escape = true;
      if (o.ignore == null) o.ignore = ["[]", "()", "{}", "<>", '""', "''", "``", "\u201C\u201D", "\xAB\xBB"];
      else {
        if (typeof o.ignore === "string") {
          o.ignore = [o.ignore];
        }
        o.ignore = o.ignore.map(function(pair) {
          if (pair.length === 1) pair = pair + pair;
          return pair;
        });
      }
      var tokens = paren.parse(string, { flat: true, brackets: o.ignore });
      var str = tokens[0];
      var parts = str.split(separator);
      if (o.escape) {
        var cleanParts = [];
        for (var i = 0; i < parts.length; i++) {
          var prev = parts[i];
          var part = parts[i + 1];
          if (prev[prev.length - 1] === "\\" && prev[prev.length - 2] !== "\\") {
            cleanParts.push(prev + separator + part);
            i++;
          } else {
            cleanParts.push(prev);
          }
        }
        parts = cleanParts;
      }
      for (var i = 0; i < parts.length; i++) {
        tokens[0] = parts[i];
        parts[i] = paren.stringify(tokens, { flat: true });
      }
      return parts;
    };
  }
});

// node_modules/skia-canvas/lib/classes/css.js
var require_css = __commonJS({
  "node_modules/skia-canvas/lib/classes/css.js"(exports, module) {
    "use strict";
    var splitBy = require_string_split_by();
    var m;
    var cache = { font: {}, variant: {} };
    var styleRE = /^(normal|italic|oblique)$/;
    var smallcapsRE = /^(normal|small-caps)$/;
    var stretchRE = /^(normal|(semi-|extra-|ultra-)?(condensed|expanded))$/;
    var namedSizeRE = /(?:xx?-)?small|smaller|medium|larger|(?:xx?-)?large|normal/;
    var numSizeRE = /^(\-?[\d\.]+)(px|pt|pc|in|cm|mm|%|em|ex|ch|rem|q)/;
    var namedWeightRE = /^(normal|bold(er)?|lighter)$/;
    var numWeightRE = /^(1000|\d{1,3})$/;
    var parameterizedRE = /([\w\-]+)\((.*?)\)/;
    var unquote = (s) => s.replace(/^(['"])(.*?)\1$/, "$2");
    var isSize = (s) => namedSizeRE.test(s) || numSizeRE.test(s);
    var isWeight = (s) => namedWeightRE.test(s) || numWeightRE.test(s);
    function parseFont(str) {
      if (cache.font[str] === void 0) {
        try {
          if (typeof str !== "string") throw new Error("Font specification must be a string");
          if (!str) throw new Error("Font specification cannot be an empty string");
          let font = { style: "normal", variant: "normal", weight: "normal", stretch: "normal" }, value = str.replace(/\s*\/\*s/, "/"), tokens = splitBy(value, /\s+/), token;
          while (token = tokens.shift()) {
            let match = styleRE.test(token) ? "style" : smallcapsRE.test(token) ? "variant" : stretchRE.test(token) ? "stretch" : isWeight(token) ? "weight" : isSize(token) ? "size" : null;
            switch (match) {
              case "style":
              case "variant":
              case "stretch":
              case "weight":
                font[match] = token;
                break;
              case "size":
                let [emSize, leading] = splitBy(token, "/"), size = parseSize(emSize), lineHeight = leading ? parseSize(leading.replace(/(\d)$/, "$1em"), size) : void 0, weight = parseWeight(font.weight), family = splitBy(tokens.join(" "), /\s*,\s*/).map(unquote), features = font.variant == "small-caps" ? { on: ["smcp", "onum"] } : {}, { style, stretch, variant } = font;
                let invalid = !isFinite(size) ? `font size "${emSize}"` : !isFinite(lineHeight) && lineHeight !== void 0 ? `line height "${leading}"` : !isFinite(weight) ? `font weight "${font.weight}"` : family.length == 0 ? `font family "${tokens.join(", ")}"` : false;
                if (!invalid) {
                  return cache.font[str] = Object.assign(font, {
                    size,
                    lineHeight,
                    weight,
                    family,
                    features,
                    canonical: [
                      style,
                      variant !== style && variant,
                      [variant, style].indexOf(weight) == -1 && weight,
                      [variant, style, weight].indexOf(stretch) == -1 && stretch,
                      `${size}px${isFinite(lineHeight) ? `/${lineHeight}px` : ""}`,
                      family.map((nm) => nm.match(/\s/) ? `"${nm}"` : nm).join(", ")
                    ].filter(Boolean).join(" ")
                  });
                }
                throw new Error(`Invalid ${invalid}`);
              default:
                throw new Error(`Unrecognized font attribute "${token}"`);
            }
          }
          throw new Error("Could not find a font size value");
        } catch (e) {
          cache.font[str] = null;
        }
      }
      return cache.font[str];
    }
    function parseSize(str, emSize = 16) {
      if (m = numSizeRE.exec(str)) {
        let [size, unit] = [parseFloat(m[1]), m[2]];
        return size * (unit == "px" ? 1 : unit == "pt" ? 1 / 0.75 : unit == "%" ? emSize / 100 : unit == "pc" ? 16 : unit == "in" ? 96 : unit == "cm" ? 96 / 2.54 : unit == "mm" ? 96 / 25.4 : unit == "q" ? 96 / 25.4 / 4 : unit.match("r?em") ? emSize : NaN);
      }
      if (m = namedSizeRE.exec(str)) {
        return emSize * (sizeMap[m[0]] || 1);
      }
      return NaN;
    }
    function parseFlexibleSize(str) {
      if (m = numSizeRE.exec(str)) {
        let [size, unit] = [parseFloat(m[1]), m[2]], px = size * (unit == "px" ? 1 : unit == "pt" ? 1 / 0.75 : unit == "pc" ? 16 : unit == "in" ? 96 : unit == "cm" ? 96 / 2.54 : unit == "mm" ? 96 / 25.4 : unit == "q" ? 96 / 25.4 / 4 : NaN);
        return { size, unit, px };
      }
      return null;
    }
    function parseStretch(str) {
      return (m = stretchRE.exec(str)) ? m[0] : void 0;
    }
    function parseWeight(str) {
      return (m = numWeightRE.exec(str)) ? parseInt(m[0]) || NaN : (m = namedWeightRE.exec(str)) ? weightMap[m[0]] : NaN;
    }
    function parseVariant(str) {
      if (cache.variant[str] === void 0) {
        let variants = [], features = { on: [], off: [] };
        for (let token of splitBy(str, /\s+/)) {
          if (token == "normal") {
            return { variants: [token], features: { on: [], off: [] } };
          } else if (token in featureMap) {
            featureMap[token].forEach((feat) => {
              if (feat[0] == "-") features.off.push(feat.slice(1));
              else features.on.push(feat);
            });
            variants.push(token);
          } else if (m = parameterizedRE.exec(token)) {
            let subPattern = alternatesMap[m[1]], subValue = Math.max(0, Math.min(99, parseInt(m[2], 10))), [feat, val] = subPattern.replace(/##/, subValue < 10 ? "0" + subValue : subValue).replace(/#/, Math.min(9, subValue)).split(" ");
            if (typeof val == "undefined") features.on.push(feat);
            else features[feat] = parseInt(val, 10);
            variants.push(`${m[1]}(${subValue})`);
          } else {
            throw new Error(`Invalid font variant "${token}"`);
          }
        }
        cache.variant[str] = { variant: variants.join(" "), features };
      }
      return cache.variant[str];
    }
    function parseTextDecoration(str) {
      let style = "solid", line = "none", color = "currentColor", inherit = "auto", thickness, _val;
      str = (typeof str == "string" ? str : "").trim().replace(/\s+/, " ");
      for (const token of str.split(" ")) {
        if (token.match(/solid|double|dotted|dashed|wavy/)) style = token;
        else if (token.match(/none|initial|revert(-layer)?|unset/)) line = "none";
        else if (token.match(/underline|overline|line-through/)) line = token;
        else if (_val = parseFlexibleSize(token)) thickness = _val;
        else if (token.match(/auto|from-font/)) inherit = token;
        else color = token;
      }
      return { style, line, color, thickness, inherit, str };
    }
    var cursorTypes = [
      "default",
      "none",
      "context-menu",
      "help",
      "pointer",
      "progress",
      "wait",
      "cell",
      "crosshair",
      "text",
      "vertical-text",
      "alias",
      "copy",
      "move",
      "no-drop",
      "not-allowed",
      "grab",
      "grabbing",
      "e-resize",
      "n-resize",
      "ne-resize",
      "nw-resize",
      "s-resize",
      "se-resize",
      "sw-resize",
      "w-resize",
      "ew-resize",
      "ns-resize",
      "nesw-resize",
      "nwse-resize",
      "col-resize",
      "row-resize",
      "all-scroll",
      "zoom-in",
      "zoom-out"
    ];
    function parseCursor(str) {
      return cursorTypes.includes(str);
    }
    function parseFit(mode) {
      return ["none", "contain-x", "contain-y", "contain", "cover", "fill", "scale-down", "resize"].includes(mode);
    }
    function parseCornerRadii(r) {
      r = [r].flat().slice(0, 4).map((n) => n && Object.hasOwn(n, "x") && Object.hasOwn(n, "y") ? n : { x: n, y: n });
      if (r.some((pt) => !Number.isFinite(pt.x) || !Number.isFinite(pt.y))) {
        return null;
      } else if (r.some((pt) => pt.x < 0 || pt.y < 0)) {
        throw RangeError("Corner radius cannot be negative");
      }
      return r.length == 1 ? [r[0], r[0], r[0], r[0]] : r.length == 2 ? [r[0], r[1], r[0], r[1]] : r.length == 3 ? [r[0], r[1], r[2], r[1]] : r.length == 4 ? [r[0], r[1], r[2], r[3]] : [0, 0, 0, 0].map((n) => ({ x: n, y: n }));
    }
    var plainFilterRE = /(blur|hue-rotate|brightness|contrast|grayscale|invert|opacity|saturate|sepia)\((.*?)\)/;
    var shadowFilterRE = /drop-shadow\((.*)\)/;
    var percentValueRE = /^(\+|-)?\d+%$/;
    var angleValueRE = /([\d\.]+)(deg|g?rad|turn)/;
    function parseFilter(str) {
      let filters = {};
      let canonical = [];
      for (var spec of splitBy(str, /\s+/) || []) {
        if (m = shadowFilterRE.exec(spec)) {
          let kind = "drop-shadow", args = m[1].trim().split(/\s+/), lengths = args.slice(0, 3), color = args.slice(3).join(" "), dims = lengths.map((s) => parseSize(s)).filter(isFinite);
          if (dims.length == 3 && !!color) {
            filters[kind] = [...dims, color];
            canonical.push(`${kind}(${lengths.join(" ")} ${color.replace(/ /g, "")})`);
          }
        } else if (m = plainFilterRE.exec(spec)) {
          let [kind, arg] = m.slice(1);
          let val = kind == "blur" ? parseSize(arg) : kind == "hue-rotate" ? parseAngle(arg) : parsePercentage(arg);
          if (isFinite(val)) {
            filters[kind] = val;
            canonical.push(`${kind}(${arg.trim()})`);
          }
        }
      }
      return str.trim() == "none" ? { canonical: "none", filters } : canonical.length ? { canonical: canonical.join(" "), filters } : null;
    }
    function parsePercentage(str) {
      return percentValueRE.test(str.trim()) ? parseInt(str, 10) / 100 : !isNaN(str) ? parseFloat(str) : NaN;
    }
    function parseAngle(str) {
      if (m = angleValueRE.exec(str.trim())) {
        let [amt, unit] = [parseFloat(m[1]), m[2]];
        return unit == "deg" ? amt : unit == "rad" ? 360 * amt / (2 * Math.PI) : unit == "grad" ? 360 * amt / 400 : unit == "turn" ? 360 * amt : NaN;
      }
    }
    var weightMap = {
      "lighter": 300,
      "normal": 400,
      "bold": 700,
      "bolder": 800
    };
    var sizeMap = {
      "xx-small": 3 / 5,
      "x-small": 3 / 4,
      "small": 8 / 9,
      "smaller": 8 / 9,
      "large": 6 / 5,
      "larger": 6 / 5,
      "x-large": 3 / 2,
      "xx-large": 2 / 1,
      "normal": 1.2
      // special case for lineHeight
    };
    var featureMap = {
      "normal": [],
      // font-variant-ligatures
      "common-ligatures": ["liga", "clig"],
      "no-common-ligatures": ["-liga", "-clig"],
      "discretionary-ligatures": ["dlig"],
      "no-discretionary-ligatures": ["-dlig"],
      "historical-ligatures": ["hlig"],
      "no-historical-ligatures": ["-hlig"],
      "contextual": ["calt"],
      "no-contextual": ["-calt"],
      // font-variant-position
      "super": ["sups"],
      "sub": ["subs"],
      // font-variant-caps
      "small-caps": ["smcp"],
      "all-small-caps": ["c2sc", "smcp"],
      "petite-caps": ["pcap"],
      "all-petite-caps": ["c2pc", "pcap"],
      "unicase": ["unic"],
      "titling-caps": ["titl"],
      // font-variant-numeric
      "lining-nums": ["lnum"],
      "oldstyle-nums": ["onum"],
      "proportional-nums": ["pnum"],
      "tabular-nums": ["tnum"],
      "diagonal-fractions": ["frac"],
      "stacked-fractions": ["afrc"],
      "ordinal": ["ordn"],
      "slashed-zero": ["zero"],
      // font-variant-east-asian
      "jis78": ["jp78"],
      "jis83": ["jp83"],
      "jis90": ["jp90"],
      "jis04": ["jp04"],
      "simplified": ["smpl"],
      "traditional": ["trad"],
      "full-width": ["fwid"],
      "proportional-width": ["pwid"],
      "ruby": ["ruby"],
      // font-variant-alternates (non-parameterized)
      "historical-forms": ["hist"]
    };
    var alternatesMap = {
      "stylistic": "salt #",
      "styleset": "ss##",
      "character-variant": "cv##",
      "swash": "swsh #",
      "ornaments": "ornm #",
      "annotation": "nalt #"
    };
    module.exports = {
      // used by context
      font: parseFont,
      variant: parseVariant,
      size: parseSize,
      spacing: parseFlexibleSize,
      stretch: parseStretch,
      decoration: parseTextDecoration,
      filter: parseFilter,
      // path & context
      radii: parseCornerRadii,
      // gui
      cursor: parseCursor,
      fit: parseFit
    };
  }
});

// node_modules/skia-canvas/lib/classes/path.js
var require_path = __commonJS({
  "node_modules/skia-canvas/lib/classes/path.js"(exports, module) {
    "use strict";
    var { RustClass, core, wrap, inspect, argc, REPR } = require_neon();
    var { toSkMatrix } = require_geometry();
    var css = require_css();
    var Path2D2 = class _Path2D extends RustClass {
      static op(operation, path, other) {
        let args = other ? [core(other), operation] : [];
        return wrap(_Path2D, path.\u0192("op", ...args));
      }
      static interpolate(path, other, weight) {
        let args = other ? [core(other), weight] : [];
        return wrap(_Path2D, path.\u0192("interpolate", ...args));
      }
      static effect(effect, path, ...args) {
        return wrap(_Path2D, path.\u0192(effect, ...args));
      }
      constructor(source) {
        super(_Path2D);
        if (source instanceof _Path2D) this.init("from_path", core(source));
        else if (typeof source == "string") this.init("from_svg", source);
        else this.alloc();
      }
      // dimensions & contents
      get bounds() {
        return this.\u0192("bounds");
      }
      get edges() {
        return this.\u0192("edges");
      }
      get d() {
        return this.prop("d");
      }
      set d(svg) {
        return this.prop("d", svg);
      }
      contains(x, y) {
        return this.\u0192("contains", ...arguments);
      }
      points(step = 1) {
        return this.jitter(step, 0).edges.map(([verb, ...pts]) => pts.slice(-2)).filter((pt) => pt.length);
      }
      // concatenation
      addPath(path, matrix) {
        let args = path instanceof _Path2D ? [core(path)] : [];
        if (matrix) args.push(toSkMatrix(matrix));
        this.\u0192("addPath", ...args);
      }
      // line segments
      moveTo(x, y) {
        this.\u0192("moveTo", ...arguments);
      }
      lineTo(x, y) {
        this.\u0192("lineTo", ...arguments);
      }
      closePath() {
        this.\u0192("closePath");
      }
      arcTo(x1, y1, x2, y2, radius) {
        this.\u0192("arcTo", ...arguments);
      }
      bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
        this.\u0192("bezierCurveTo", ...arguments);
      }
      quadraticCurveTo(cpx, cpy, x, y) {
        this.\u0192("quadraticCurveTo", ...arguments);
      }
      conicCurveTo(cpx, cpy, x, y, weight) {
        this.\u0192("conicCurveTo", ...arguments);
      }
      // shape primitives
      ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, isCCW) {
        this.\u0192("ellipse", ...arguments);
      }
      rect(x, y, width, height) {
        this.\u0192("rect", ...arguments);
      }
      arc(x, y, radius, startAngle, endAngle) {
        this.\u0192("arc", ...arguments);
      }
      roundRect(x, y, w, h, r) {
        argc(arguments, 4, 5);
        let radii = css.radii(r);
        if (radii) {
          if (w < 0) radii = [radii[1], radii[0], radii[3], radii[2]];
          if (h < 0) radii = [radii[3], radii[2], radii[1], radii[0]];
          this.\u0192("roundRect", x, y, w, h, ...radii.map(({ x: x2, y: y2 }) => [x2, y2]).flat());
        }
      }
      // tween similar paths
      interpolate(path, weight) {
        return _Path2D.interpolate(this, ...arguments);
      }
      // boolean operations
      complement(path) {
        return _Path2D.op("complement", this, ...arguments);
      }
      difference(path) {
        return _Path2D.op("difference", this, ...arguments);
      }
      intersect(path) {
        return _Path2D.op("intersect", this, ...arguments);
      }
      union(path) {
        return _Path2D.op("union", this, ...arguments);
      }
      xor(path) {
        return _Path2D.op("xor", this, ...arguments);
      }
      // path effects
      jitter(len, amt, seed) {
        return _Path2D.effect("jitter", this, ...arguments);
      }
      simplify(rule) {
        return _Path2D.effect("simplify", this, ...arguments);
      }
      unwind() {
        return _Path2D.effect("unwind", this);
      }
      round(radius) {
        return _Path2D.effect("round", this, ...arguments);
      }
      offset(dx, dy) {
        return _Path2D.effect("offset", this, ...arguments);
      }
      transform(matrix) {
        return _Path2D.effect("transform", this, toSkMatrix.apply(null, arguments));
      }
      trim(...rng) {
        if (typeof rng[1] != "number") {
          if (rng[0] > 0) rng.unshift(0);
          else if (rng[0] < 0) rng.splice(1, 0, 1);
        }
        if (rng[0] < 0) rng[0] = Math.max(-1, rng[0]) + 1;
        if (rng[1] < 0) rng[1] = Math.max(-1, rng[1]) + 1;
        return _Path2D.effect("trim", this, ...rng);
      }
      [REPR](depth, options) {
        let { d, bounds, edges } = this;
        return `Path2D ${inspect({ d, bounds, edges }, options)}`;
      }
    };
    module.exports = { Path2D: Path2D2 };
  }
});

// node_modules/skia-canvas/lib/classes/typography.js
var require_typography = __commonJS({
  "node_modules/skia-canvas/lib/classes/typography.js"(exports, module) {
    "use strict";
    var { RustClass, readOnly, signature, inspect, REPR } = require_neon();
    var FontLibrary2 = class _FontLibrary extends RustClass {
      constructor() {
        super(_FontLibrary);
      }
      get families() {
        return this.prop("families");
      }
      has(familyName) {
        return this.\u0192("has", familyName);
      }
      family(name) {
        return this.\u0192("family", name);
      }
      use(...args) {
        let sig = signature(args);
        if (sig == "o") {
          let results = {};
          for (let [alias, paths] of Object.entries(args.shift())) {
            results[alias] = this.\u0192("addFamily", alias, [paths].flat());
          }
          return results;
        } else if (sig.match(/^s?[as]$/)) {
          let fonts = [args.pop()].flat();
          let alias = args.shift();
          return this.\u0192("addFamily", alias, fonts);
        } else {
          throw new Error("Expected an array of file paths or an object mapping family names to font files");
        }
      }
      reset() {
        return this.\u0192("reset");
      }
    };
    var TextMetrics2 = class {
      constructor(metrics) {
        for (let k in metrics) readOnly(this, k, metrics[k]);
      }
    };
    module.exports = { FontLibrary: new FontLibrary2(), TextMetrics: TextMetrics2 };
  }
});

// node_modules/skia-canvas/lib/classes/context.js
var require_context = __commonJS({
  "node_modules/skia-canvas/lib/classes/context.js"(exports, module) {
    "use strict";
    var { RustClass, core, wrap, inspect, argc, REPR } = require_neon();
    var { Canvas: Canvas2, CanvasGradient: CanvasGradient2, CanvasPattern: CanvasPattern2, CanvasTexture: CanvasTexture2 } = require_canvas();
    var { fromSkMatrix, toSkMatrix } = require_geometry();
    var { Image: Image2, ImageData: ImageData2 } = require_imagery();
    var { TextMetrics: TextMetrics2 } = require_typography();
    var { Path2D: Path2D2 } = require_path();
    var css = require_css();
    var toString = (val) => typeof val == "string" ? val : new String(val).toString();
    var CanvasRenderingContext2D2 = class _CanvasRenderingContext2D extends RustClass {
      #canvas;
      constructor(canvas) {
        try {
          super(_CanvasRenderingContext2D).alloc(core(canvas));
          this.#canvas = new WeakRef(canvas);
        } catch (e) {
          throw new TypeError(`Function is not a constructor (use Canvas's "getContext" method instead)`);
        }
      }
      get canvas() {
        return this.#canvas.deref();
      }
      // -- global state & content reset ------------------------------------------
      reset() {
        this.\u0192("reset");
      }
      // -- grid state ------------------------------------------------------------
      save() {
        this.\u0192("save");
      }
      restore() {
        this.\u0192("restore");
      }
      get currentTransform() {
        return fromSkMatrix(this.prop("currentTransform"));
      }
      set currentTransform(matrix) {
        this.setTransform(matrix);
      }
      resetTransform() {
        this.\u0192("resetTransform");
      }
      getTransform() {
        return this.currentTransform;
      }
      setTransform(matrix) {
        this.prop("currentTransform", toSkMatrix.apply(null, arguments));
      }
      transform(matrix) {
        this.\u0192("transform", toSkMatrix.apply(null, arguments));
      }
      translate(x, y) {
        this.\u0192("translate", ...arguments);
      }
      scale(x, y) {
        this.\u0192("scale", ...arguments);
      }
      rotate(angle) {
        this.\u0192("rotate", ...arguments);
      }
      createProjection(quad, basis) {
        return fromSkMatrix(this.\u0192("createProjection", [quad].flat(), [basis].flat()));
      }
      // -- bézier paths ----------------------------------------------------------
      beginPath() {
        this.\u0192("beginPath");
      }
      rect(x, y, width, height) {
        this.\u0192("rect", ...arguments);
      }
      arc(x, y, radius, startAngle, endAngle, isCCW) {
        this.\u0192("arc", ...arguments);
      }
      ellipse(x, y, xRadius, yRadius, rotation, startAngle, endAngle, isCCW) {
        this.\u0192("ellipse", ...arguments);
      }
      moveTo(x, y) {
        this.\u0192("moveTo", ...arguments);
      }
      lineTo(x, y) {
        this.\u0192("lineTo", ...arguments);
      }
      arcTo(x1, y1, x2, y2, radius) {
        this.\u0192("arcTo", ...arguments);
      }
      bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
        this.\u0192("bezierCurveTo", ...arguments);
      }
      quadraticCurveTo(cpx, cpy, x, y) {
        this.\u0192("quadraticCurveTo", ...arguments);
      }
      conicCurveTo(cpx, cpy, x, y, weight) {
        this.\u0192("conicCurveTo", ...arguments);
      }
      closePath() {
        this.\u0192("closePath");
      }
      roundRect(x, y, w, h, r = 0) {
        argc(arguments, 4, 5);
        let radii = css.radii(r);
        if (radii) {
          if (w < 0) radii = [radii[1], radii[0], radii[3], radii[2]];
          if (h < 0) radii = [radii[3], radii[2], radii[1], radii[0]];
          this.\u0192("roundRect", x, y, w, h, ...radii.map(({ x: x2, y: y2 }) => [x2, y2]).flat());
        }
      }
      // -- using paths -----------------------------------------------------------
      fill(path, rule) {
        if (path instanceof Path2D2) arguments[0] = core(path);
        return this.\u0192("fill", ...arguments);
      }
      stroke(path) {
        if (path instanceof Path2D2) arguments[0] = core(path);
        return this.\u0192("stroke", ...arguments);
      }
      clip(path, rule) {
        if (path instanceof Path2D2) arguments[0] = core(path);
        return this.\u0192("clip", ...arguments);
      }
      isPointInPath(path, x, y, rule) {
        if (path instanceof Path2D2) arguments[0] = core(path);
        return this.\u0192("isPointInPath", ...arguments);
      }
      isPointInStroke(path, x, y) {
        if (path instanceof Path2D2) arguments[0] = core(path);
        return this.\u0192("isPointInStroke", ...arguments);
      }
      // -- shaders ---------------------------------------------------------------
      createPattern(image, repetition) {
        return new CanvasPattern2(this.canvas, ...arguments);
      }
      createLinearGradient(x0, y0, x1, y1) {
        return new CanvasGradient2("Linear", ...arguments);
      }
      createRadialGradient(x0, y0, r0, x1, y1, r1) {
        return new CanvasGradient2("Radial", ...arguments);
      }
      createConicGradient(startAngle, x, y) {
        return new CanvasGradient2("Conic", ...arguments);
      }
      createTexture(spacing, options) {
        return new CanvasTexture2(...arguments);
      }
      // -- fill & stroke ---------------------------------------------------------
      fillRect(x, y, width, height) {
        this.\u0192("fillRect", ...arguments);
      }
      strokeRect(x, y, width, height) {
        this.\u0192("strokeRect", ...arguments);
      }
      clearRect(x, y, width, height) {
        this.\u0192("clearRect", ...arguments);
      }
      set fillStyle(style) {
        let isShader = style instanceof CanvasPattern2 || style instanceof CanvasGradient2 || style instanceof CanvasTexture2, [ref, val] = isShader ? [style, core(style)] : [null, style];
        this.ref("fill", ref);
        this.prop("fillStyle", val);
      }
      get fillStyle() {
        let style = this.prop("fillStyle");
        return style === null ? this.ref("fill") : style;
      }
      set strokeStyle(style) {
        let isShader = style instanceof CanvasPattern2 || style instanceof CanvasGradient2 || style instanceof CanvasTexture2, [ref, val] = isShader ? [style, core(style)] : [null, style];
        this.ref("stroke", ref);
        this.prop("strokeStyle", val);
      }
      get strokeStyle() {
        let style = this.prop("strokeStyle");
        return style === null ? this.ref("stroke") : style;
      }
      // -- line style ------------------------------------------------------------
      getLineDash() {
        return this.\u0192("getLineDash");
      }
      setLineDash(segments) {
        this.\u0192("setLineDash", ...arguments);
      }
      get lineCap() {
        return this.prop("lineCap");
      }
      set lineCap(style) {
        this.prop("lineCap", style);
      }
      get lineDashFit() {
        return this.prop("lineDashFit");
      }
      set lineDashFit(style) {
        this.prop("lineDashFit", style);
      }
      get lineDashMarker() {
        return wrap(Path2D2, this.prop("lineDashMarker"));
      }
      set lineDashMarker(path) {
        this.prop("lineDashMarker", path instanceof Path2D2 ? core(path) : path);
      }
      get lineDashOffset() {
        return this.prop("lineDashOffset");
      }
      set lineDashOffset(offset) {
        this.prop("lineDashOffset", offset);
      }
      get lineJoin() {
        return this.prop("lineJoin");
      }
      set lineJoin(style) {
        this.prop("lineJoin", style);
      }
      get lineWidth() {
        return this.prop("lineWidth");
      }
      set lineWidth(width) {
        this.prop("lineWidth", width);
      }
      get miterLimit() {
        return this.prop("miterLimit");
      }
      set miterLimit(limit) {
        this.prop("miterLimit", limit);
      }
      // -- imagery ---------------------------------------------------------------
      get imageSmoothingEnabled() {
        return this.prop("imageSmoothingEnabled");
      }
      set imageSmoothingEnabled(flag) {
        this.prop("imageSmoothingEnabled", !!flag);
      }
      get imageSmoothingQuality() {
        return this.prop("imageSmoothingQuality");
      }
      set imageSmoothingQuality(level) {
        this.prop("imageSmoothingQuality", level);
      }
      createImageData(width, height, settings) {
        argc(arguments, 2, 3);
        return new ImageData2(width, height, settings);
      }
      getImageData(x, y, width, height, { colorType = "rgba", colorSpace = "srgb", density = 1, matte, msaa } = {}) {
        argc(arguments, 4, 5);
        if (typeof density != "number" || !Number.isInteger(density) || density < 1) {
          throw new TypeError("Expected a non-negative integer for `density`");
        }
        if (msaa === void 0 || msaa === true) {
          msaa = void 0;
        } else if (!isFinite(+msaa) || +msaa < 0) {
          throw new TypeError("The number of MSAA samples must be an integer \u22650");
        }
        let opts = { colorType, colorSpace, density, matte, msaa }, buffer = this.\u0192("getImageData", x, y, width, height, opts, core(this.canvas));
        return new ImageData2(buffer, width * density, height * density, { colorType, colorSpace });
      }
      putImageData(imageData, ...coords) {
        argc(arguments, 3, 7);
        if (!(imageData instanceof ImageData2)) throw TypeError("Expected an ImageData as 1st arg");
        this.\u0192("putImageData", imageData, ...coords);
      }
      drawImage(image, ...coords) {
        if (image instanceof Canvas2) {
          this.\u0192("drawImage", core(image.getContext("2d")), ...coords);
        } else if (image instanceof Image2) {
          if (image.complete) this.\u0192("drawImage", core(image), ...coords);
          else throw Error("Image has not completed loading: listen for `load` event or await `decode()` first");
        } else if (image instanceof ImageData2) {
          this.\u0192("drawImage", image, ...coords);
        } else if (image instanceof Promise) {
          throw Error("Promise has not yet resolved: `await` image loading before drawing");
        } else {
          let nonimage = inspect(image, { depth: 1 });
          throw Error(`Expected an Image or a Canvas argument (got: ${nonimage})`);
        }
      }
      drawCanvas(image, ...coords) {
        if (image instanceof Canvas2) {
          this.\u0192("drawCanvas", core(image.getContext("2d")), ...coords);
        } else {
          this.drawImage(image, ...coords);
        }
      }
      // -- typography ------------------------------------------------------------
      get font() {
        return this.prop("font");
      }
      set font(str) {
        this.prop("font", css.font(str));
      }
      get textAlign() {
        return this.prop("textAlign");
      }
      set textAlign(mode) {
        this.prop("textAlign", mode);
      }
      get textBaseline() {
        return this.prop("textBaseline");
      }
      set textBaseline(mode) {
        this.prop("textBaseline", mode);
      }
      get direction() {
        return this.prop("direction");
      }
      set direction(mode) {
        this.prop("direction", mode);
      }
      get fontStretch() {
        return this.prop("fontStretch");
      }
      set fontStretch(str) {
        this.prop("fontStretch", css.stretch(str));
      }
      get letterSpacing() {
        return this.prop("letterSpacing");
      }
      set letterSpacing(str) {
        this.prop("letterSpacing", css.spacing(str));
      }
      get wordSpacing() {
        return this.prop("wordSpacing");
      }
      set wordSpacing(str) {
        this.prop("wordSpacing", css.spacing(str));
      }
      measureText(text, maxWidth) {
        let metrics = JSON.parse(this.\u0192("measureText", toString(text), maxWidth));
        return new TextMetrics2(metrics);
      }
      fillText(text, ...geom) {
        this.\u0192("fillText", toString(text), ...geom);
      }
      strokeText(text, ...geom) {
        this.\u0192("strokeText", toString(text), ...geom);
      }
      outlineText(text, ...geom) {
        let path = this.\u0192("outlineText", toString(text), ...geom);
        return path ? wrap(Path2D2, path) : null;
      }
      // -- non-standard typography extensions --------------------------------------------
      get fontHinting() {
        return this.prop("fontHinting");
      }
      set fontHinting(flag) {
        this.prop("fontHinting", !!flag);
      }
      get fontVariant() {
        return this.prop("fontVariant");
      }
      set fontVariant(str) {
        this.prop("fontVariant", css.variant(str));
      }
      get textWrap() {
        return this.prop("textWrap");
      }
      set textWrap(flag) {
        this.prop("textWrap", !!flag);
      }
      get textDecoration() {
        return this.prop("textDecoration");
      }
      set textDecoration(str) {
        this.prop("textDecoration", css.decoration(str));
      }
      set textTracking(_) {
        process.emitWarning("The .textTracking property has been removed; use the .letterSpacing property instead", "PropertyRemoved");
      }
      // -- effects ---------------------------------------------------------------
      get globalCompositeOperation() {
        return this.prop("globalCompositeOperation");
      }
      set globalCompositeOperation(blend) {
        this.prop("globalCompositeOperation", blend);
      }
      get globalAlpha() {
        return this.prop("globalAlpha");
      }
      set globalAlpha(alpha) {
        this.prop("globalAlpha", alpha);
      }
      get shadowBlur() {
        return this.prop("shadowBlur");
      }
      set shadowBlur(level) {
        this.prop("shadowBlur", level);
      }
      get shadowColor() {
        return this.prop("shadowColor");
      }
      set shadowColor(color) {
        this.prop("shadowColor", color);
      }
      get shadowOffsetX() {
        return this.prop("shadowOffsetX");
      }
      set shadowOffsetX(x) {
        this.prop("shadowOffsetX", x);
      }
      get shadowOffsetY() {
        return this.prop("shadowOffsetY");
      }
      set shadowOffsetY(y) {
        this.prop("shadowOffsetY", y);
      }
      get filter() {
        return this.prop("filter");
      }
      set filter(str) {
        this.prop("filter", css.filter(str));
      }
      [REPR](depth, options) {
        let props = [
          "canvas",
          "currentTransform",
          "fillStyle",
          "strokeStyle",
          "font",
          "fontStretch",
          "fontVariant",
          "direction",
          "textAlign",
          "textBaseline",
          "textWrap",
          "letterSpacing",
          "wordSpacing",
          "globalAlpha",
          "globalCompositeOperation",
          "imageSmoothingEnabled",
          "imageSmoothingQuality",
          "filter",
          "shadowBlur",
          "shadowColor",
          "shadowOffsetX",
          "shadowOffsetY",
          "lineCap",
          "lineDashOffset",
          "lineJoin",
          "lineWidth",
          "miterLimit"
        ];
        let info = {};
        if (depth > 0) {
          for (var prop of props) {
            try {
              info[prop] = this[prop];
            } catch {
              info[prop] = void 0;
            }
          }
        }
        return `CanvasRenderingContext2D ${inspect(info, options)}`;
      }
    };
    module.exports = { CanvasRenderingContext2D: CanvasRenderingContext2D2 };
  }
});

// node_modules/skia-canvas/lib/classes/canvas.js
var require_canvas = __commonJS({
  "node_modules/skia-canvas/lib/classes/canvas.js"(exports, module) {
    "use strict";
    var { fileURLToPath } = __require("url");
    var { RustClass, core, inspect, argc, REPR } = require_neon();
    var { Image: Image2, ImageData: ImageData2, pixelSize, getSharp } = require_imagery();
    var { Path2D: Path2D2 } = require_path();
    var { toSkMatrix } = require_geometry();
    var Canvas2 = class _Canvas extends RustClass {
      #contexts;
      constructor(width, height, { textContrast = 0, textGamma = 1.4, gpu = true } = {}) {
        super(_Canvas).alloc({ textContrast, textGamma, gpu: !!gpu });
        this.#contexts = [];
        Object.assign(this, { width, height });
      }
      getContext(kind) {
        return kind == "2d" ? this.#contexts[0] || this.newPage() : null;
      }
      get gpu() {
        return this.prop("engine") == "gpu";
      }
      set gpu(mode) {
        this.prop("engine", !!mode ? "gpu" : "cpu");
      }
      get engine() {
        return JSON.parse(this.prop("engine_status"));
      }
      get width() {
        return this.prop("width");
      }
      set width(w) {
        this.prop("width", !Number.isNaN(+w) && +w >= 0 ? w : 300);
        if (this.#contexts[0]) this.getContext("2d").\u0192("resetSize", core(this));
      }
      get height() {
        return this.prop("height");
      }
      set height(h) {
        this.prop("height", !Number.isNaN(+h) && +h >= 0 ? h : 150);
        if (this.#contexts[0]) this.getContext("2d").\u0192("resetSize", core(this));
      }
      newPage(width, height) {
        const { CanvasRenderingContext2D: CanvasRenderingContext2D2 } = require_context();
        let ctx = new CanvasRenderingContext2D2(this);
        this.#contexts.unshift(ctx);
        if (arguments.length == 2) {
          Object.assign(this, { width, height });
        }
        return ctx;
      }
      get pages() {
        return this.#contexts.slice().reverse();
      }
      get raw() {
        return this.toBuffer("raw");
      }
      get png() {
        return this.toBuffer("png");
      }
      get jpg() {
        return this.toBuffer("jpg");
      }
      get pdf() {
        return this.toBuffer("pdf");
      }
      get svg() {
        return this.toBuffer("svg");
      }
      get webp() {
        return this.toBuffer("webp");
      }
      // Warn about renamed methods but map them to the new names (for now)
      saveAs() {
        _deprecated("Canvas.saveAs()");
        this.toFile(...arguments);
      }
      saveAsSync() {
        _deprecated("Canvas.saveAsSync()");
        this.toFileSync(...arguments);
      }
      toDataURLSync() {
        _deprecated("Canvas.toDataURLSync()");
        this.toURLSync(...arguments);
      }
      toFile(filename, opts = {}) {
        let { pages, padding, pattern, ...rest } = exportOptions(this, { filename }, opts), args = [pages.map(core), pattern, padding, rest];
        return this.\u0192("save", ...args);
      }
      toFileSync(filename, opts = {}) {
        let { pages, padding, pattern, ...rest } = exportOptions(this, { filename }, opts);
        this.\u0192("saveSync", pages.map(core), pattern, padding, rest);
      }
      toBuffer(extension = "png", opts = {}) {
        let { pages, ...rest } = exportOptions(this, { extension }, opts);
        return this.\u0192("toBuffer", pages.map(core), rest);
      }
      toBufferSync(extension = "png", opts = {}) {
        let { pages, ...rest } = exportOptions(this, { extension }, opts);
        return this.\u0192("toBufferSync", pages.map(core), rest);
      }
      toURL(extension = "png", opts = {}) {
        let { mime } = exportOptions(this, { extension }, opts), buffer = this.toBuffer(extension, opts);
        return buffer.then((data) => `data:${mime};base64,${data.toString("base64")}`);
      }
      toURLSync(extension = "png", opts = {}) {
        let { mime } = exportOptions(this, { extension }, opts), buffer = this.toBufferSync(extension, opts);
        return `data:${mime};base64,${buffer.toString("base64")}`;
      }
      // Match the browser API in only accepting a single optional quality argument
      toDataURL(extension = "png", quality) {
        if (quality !== void 0 && typeof quality !== "number") {
          throw TypeError("Expected a number in the range 0\u20131 for `quality` (use toURL() for additional rendering options)");
        }
        return this.toURLSync(extension, { quality });
      }
      toSharp({ page, matte, msaa, density = 1 } = {}) {
        const { Readable } = __require("stream"), sharp = getSharp(), buffer = this.toBuffer("raw", { page, matte, density, msaa });
        return Readable.from(
          (async function* () {
            yield buffer;
          })()
        ).pipe(sharp({
          raw: { width: this.width * density, height: this.height * density, channels: 4 }
        }).withMetadata({ density: density * 72 }));
      }
      [REPR](depth, options) {
        let { width, height, gpu, engine, pages } = this;
        return `Canvas ${inspect({ width, height, gpu, engine, pages }, options)}`;
      }
    };
    var CanvasGradient2 = class _CanvasGradient extends RustClass {
      constructor(style, ...coords) {
        super(_CanvasGradient);
        style = (style || "").toLowerCase();
        if (["linear", "radial", "conic"].includes(style)) this.init(style, ...coords);
        else throw new Error(`Function is not a constructor (use CanvasRenderingContext2D's "createConicGradient", "createLinearGradient", and "createRadialGradient" methods instead)`);
      }
      addColorStop(offset, color) {
        this.\u0192("addColorStop", ...arguments);
      }
      [REPR](depth, options) {
        return `CanvasGradient (${this.\u0192("repr")})`;
      }
    };
    var CanvasPattern2 = class _CanvasPattern extends RustClass {
      constructor(canvas, src, repeat) {
        repeat = [...arguments].slice(2);
        super(_CanvasPattern);
        if (src instanceof Image2) {
          let { width, height } = canvas;
          this.init("from_image", core(src), width, height, ...repeat);
        } else if (src instanceof ImageData2) {
          this.init("from_image_data", src, ...repeat);
        } else if (src instanceof Canvas2) {
          let ctx = src.getContext("2d");
          this.init("from_canvas", core(ctx), ...repeat);
        } else {
          throw new Error("CanvasPatterns require a source Image or a Canvas");
        }
      }
      setTransform(matrix) {
        this.\u0192("setTransform", toSkMatrix.apply(null, arguments));
      }
      [REPR](depth, options) {
        return `CanvasPattern (${this.\u0192("repr")})`;
      }
    };
    var CanvasTexture2 = class _CanvasTexture extends RustClass {
      constructor(spacing, { path, color, angle, line, cap = "butt", outline = false, offset = 0 } = {}) {
        super(_CanvasTexture);
        argc(arguments, 1);
        let [x, y] = Array.isArray(offset) ? offset.concat(offset).slice(0, 2) : [offset, offset];
        let [h, v] = Array.isArray(spacing) ? spacing.concat(spacing).slice(0, 2) : [spacing, spacing];
        if (path !== void 0 && !(path instanceof Path2D2)) {
          throw TypeError("Expected a Path2D object for `path`");
        }
        path = core(path);
        line = line != null ? line : path ? 0 : 1;
        angle = angle != null ? angle : path ? 0 : -Math.PI / 4;
        this.alloc(path, color, line, cap, angle, !!outline, h, v, x, y);
      }
      [REPR](depth, options) {
        return `CanvasTexture (${this.\u0192("repr")})`;
      }
    };
    var Format = class {
      constructor() {
        let png = "image/png", jpg = "image/jpeg", jpeg = "image/jpeg", webp = "image/webp", pdf = "application/pdf", svg = "image/svg+xml", raw = "application/octet-stream";
        Object.assign(this, {
          toMime: this.toMime.bind(this),
          fromMime: this.fromMime.bind(this),
          expected: `"png", "jpg", "webp", "raw", "pdf", or "svg"`,
          formats: { png, jpg, jpeg, webp, raw, pdf, svg },
          mimes: { [png]: "png", [jpg]: "jpg", [webp]: "webp", [raw]: "raw", [pdf]: "pdf", [svg]: "svg" }
        });
      }
      toMime(ext) {
        return this.formats[(ext || "").replace(/^\./, "").toLowerCase()];
      }
      fromMime(mime) {
        return this.mimes[mime];
      }
    };
    var { basename, extname } = __require("path");
    function exportOptions(canvas, { filename = "", extension = "" }, opts) {
      if (typeof opts == "number") opts = { quality: opts };
      let { page, quality, matte, density, msaa, outline, downsample, colorType } = opts;
      let imageFormat = !!filename ? opts.format : void 0;
      if (filename instanceof URL) {
        if (filename.protocol == "file:") filename = fileURLToPath(filename);
        else throw Error(`URLs must use 'file' protocol (got '${filename.protocol.replace(":", "")}')`);
      }
      if (!canvas.pages.length) canvas.getContext("2d");
      var { fromMime, toMime, expected } = new Format(), ext = imageFormat || extension.replace(/@\d+x$/i, "") || extname(filename), format = fromMime(toMime(ext) || ext), mime = toMime(format), pages = canvas.pages, pp = pages.length;
      if (!ext) throw new Error(`Cannot determine image format (use a filename extension or 'format' argument)`);
      if (!format) throw new Error(`Unsupported file format "${ext}" (expected ${expected})`);
      let padding, isSequence, pattern = filename.replace(/{(\d*)}/g, (_, width) => {
        isSequence = true;
        width = parseInt(width, 10);
        padding = isFinite(width) ? width : isFinite(padding) ? padding : -1;
        return "{}";
      });
      let idx = page > 0 ? page - 1 : page < 0 ? pp + page : void 0;
      if (isFinite(idx) && idx < 0 || idx >= pp) throw new RangeError(
        pp == 1 ? `Canvas only has a \u2018page 1\u2019 (${idx} is out of bounds)` : `Canvas has pages 1\u2013${pp} (${idx} is out of bounds)`
      );
      pages = isFinite(idx) ? [pages[idx]] : isSequence || format == "pdf" ? pages : pages.slice(-1);
      const { textContrast, textGamma } = canvas.engine;
      if (quality === void 0) {
        quality = 0.92;
      } else {
        if (typeof quality != "number" || !isFinite(quality) || quality < 0 || quality > 1) {
          throw new TypeError("Expected a number between 0.0\u20131.0 for `quality`");
        }
      }
      if (density === void 0) {
        let m = (extension || basename(filename, ext)).match(/@(\d+)x$/i);
        density = m ? parseInt(m[1], 10) : 1;
      } else if (typeof density != "number" || !Number.isInteger(density) || density < 1) {
        throw new TypeError("Expected a non-negative integer for `density`");
      }
      if (msaa === void 0 || msaa === true) {
        msaa = void 0;
      } else if (!isFinite(+msaa) || +msaa < 0) {
        throw new TypeError("The number of MSAA samples must be an integer \u22650");
      }
      if (colorType !== void 0) {
        pixelSize(colorType);
      }
      downsample = !!downsample;
      outline = !!outline;
      return {
        filename,
        pattern,
        format,
        mime,
        pages,
        padding,
        quality,
        matte,
        density,
        msaa,
        outline,
        textContrast,
        textGamma,
        downsample,
        colorType
      };
    }
    var _warnings = {
      "Canvas.saveAs()": "Canvas.toFile()",
      "Canvas.saveAsSync()": "Canvas.toFileSync()",
      "Canvas.toDataURLSync()": "Canvas.toURLSync() (see also Canvas.toDataURL() which is now synchronous)"
    };
    function _deprecated(oldAPI) {
      let newAPI = _warnings[oldAPI];
      if (newAPI) console.error(`Deprecation warning: ${oldAPI} has been renamed to ${newAPI} and will stop working in a future release.`);
      delete _warnings[oldAPI];
    }
    module.exports = { Canvas: Canvas2, CanvasGradient: CanvasGradient2, CanvasPattern: CanvasPattern2, CanvasTexture: CanvasTexture2, getSharp };
  }
});

// node_modules/skia-canvas/lib/classes/gui.js
var require_gui = __commonJS({
  "node_modules/skia-canvas/lib/classes/gui.js"(exports, module) {
    "use strict";
    var { EventEmitter } = __require("events");
    var { RustClass, core, inspect, neon, REPR } = require_neon();
    var { Canvas: Canvas2 } = require_canvas();
    var css = require_css();
    var checkSupport = () => {
      if (!neon.App) throw new Error("Skia Canvas was compiled without window support");
    };
    var App2 = class _App extends RustClass {
      static #locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE;
      #events = "native";
      // `native` for an OS event loop or `node` to poll for ui-events from node
      #started = false;
      // whether the `eventLoop` property is permanently set
      #launcher;
      // timer set by opening windows to ensure app is launched soon after
      #session;
      // Promise that resolves when the current set of windows are all closed
      #windows = [];
      #frames = {};
      #fps = 60;
      constructor() {
        super(_App);
        if (neon.App) this.\u0192("register", this.#dispatch.bind(this));
        Window2.events.on("open", (win) => {
          this.#windows.push(win);
          this.#frames[win.id] = 0;
          if (!this.#launcher) this.#launcher = setImmediate(() => this.launch());
          this.\u0192("openWindow", JSON.stringify(win.state), core(win.canvas.pages[win.state.page - 1]));
        });
        Window2.events.on("close", (win) => {
          this.#windows = this.#windows.filter((w) => w !== win);
          this.\u0192("closeWindow", win.id);
          win.emit("close");
        });
      }
      get windows() {
        return [...this.#windows];
      }
      get running() {
        return this.#started;
      }
      get eventLoop() {
        return this.#events;
      }
      set eventLoop(mode) {
        if (this.#started) throw new Error("Cannot alter event loop after it has begun");
        if (["native", "node"].includes(mode) && mode != this.#events) {
          this.#events = this.\u0192("setMode", mode);
        }
      }
      get fps() {
        return this.#fps;
      }
      set fps(rate) {
        checkSupport();
        if (rate >= 1 && rate != this.#fps) {
          this.#fps = this.\u0192("setRate", rate);
        }
      }
      launch() {
        checkSupport();
        clearImmediate(this.#launcher);
        this.#started = true;
        this.#session ??= this.\u0192("activate").finally(() => {
          this.#session = null;
          this.#launcher = null;
          this.emit("idle", { type: "idle", target: this });
        });
        return this.#session;
      }
      #eachWindow(updates, callback) {
        for (const [id, payload] of Object.entries(updates || {})) {
          let win = this.#windows.find((win2) => win2.id == id);
          if (win) callback(win, payload);
        }
      }
      #dispatch(isFrame, payload) {
        let { geom, state, ui } = JSON.parse(payload);
        if (geom) this.#eachWindow(geom, (win, { top, left }) => {
          win.left = win.left || left;
          win.top = win.top || top;
        });
        if (state) this.#windows = this.#windows.filter((win) => {
          if (win.id in state || win.top === void 0) {
            Object.assign(win, state[win.id]);
            return true;
          }
          win.close();
        });
        if (ui) this.#eachWindow(ui, (win, events) => {
          for (const [[type, e]] of events.map((o) => Object.entries(o))) {
            switch (type) {
              case "mouse":
                var { button, buttons, point, page_point: { x: pageX, y: pageY }, modifiers } = e;
                win.emit(e.event, { button, buttons, ...point, pageX, pageY, ...modifiers });
                break;
              case "input":
                let [data, inputType] = e;
                win.emit(type, { data, inputType });
                break;
              case "composition":
                win.emit(e.event, { data: e.data, locale: _App.#locale });
                break;
              case "keyboard":
                var { event, key, code, location, repeat, modifiers } = e, defaults = true;
                win.emit(event, {
                  key,
                  code,
                  location,
                  repeat,
                  ...modifiers,
                  preventDefault: () => defaults = false
                });
                if (defaults && event == "keydown" && !repeat) {
                  let { ctrlKey, altKey, metaKey } = modifiers;
                  if (metaKey && key == "w" || ctrlKey && key == "c" || altKey && key == "F4") {
                    win.close();
                  } else if (metaKey && key == "f" || altKey && key == "F8") {
                    win.fullscreen = !win.fullscreen;
                  }
                }
                break;
              case "focus":
                if (e) win.emit("focus");
                else win.emit("blur");
                break;
              case "resize":
                if (win.fit == "resize") {
                  win.ctx.prop("size", e.width, e.height);
                  win.canvas.prop("width", e.width);
                  win.canvas.prop("height", e.height);
                }
                win.emit(type, e);
                break;
              case "move":
              case "wheel":
                win.emit(type, e);
                break;
              case "fullscreen":
                win.emit(type, { enabled: e });
                break;
              default:
                console.log(type, e);
            }
          }
        });
        if (isFrame) for (let win of this.#windows) {
          let frame = ++this.#frames[win.id];
          if (frame == 0) win.emit("setup");
          win.emit("frame", { frame });
          if (win.listenerCount("draw")) {
            win.canvas.getContext("2d").reset();
            win.emit("draw", { frame });
          }
        }
        return isFrame && [
          JSON.stringify(this.#windows.map((win) => win.state)),
          this.#windows.map((win) => core(win.canvas.pages[win.page - 1]))
        ];
      }
      quit() {
        this.\u0192("quit");
      }
      [REPR](depth, options) {
        let { eventLoop, fps, windows } = this;
        return `App ${inspect({ eventLoop, fps, windows }, Object.assign(options, {
          depth: 1,
          customInspect: false
        }))}`;
      }
    };
    Object.assign(App2.prototype, EventEmitter.prototype);
    var Window2 = class _Window extends EventEmitter {
      static events = new EventEmitter();
      static #kwargs = "id,left,top,width,height,title,page,background,fullscreen,cursor,fit,visible,resizable,borderless,closed".split(/,/);
      static #nextID = 1;
      #canvas;
      #state;
      // accept either ƒ(width, height, {…}) or ƒ({…})
      constructor(width = 512, height = 512, opts = {}) {
        checkSupport();
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          opts = [...arguments].slice(-1)[0] || {};
          width = opts.width || (opts.canvas || {}).width || 512;
          height = opts.height || (opts.canvas || {}).height || 512;
        }
        let hasCanvas = opts.canvas instanceof Canvas2;
        let { textContrast = 0, textGamma = 1.4 } = hasCanvas ? opts.canvas.engine : opts;
        let canvas = hasCanvas ? opts.canvas : new Canvas2(width, height, { textContrast, textGamma });
        super(_Window);
        this.#state = {
          title: "",
          visible: true,
          resizable: true,
          borderless: false,
          background: "white",
          fullscreen: false,
          closed: false,
          page: canvas.pages.length,
          left: void 0,
          top: void 0,
          width,
          height,
          textContrast,
          textGamma,
          cursor: "default",
          fit: "contain",
          id: _Window.#nextID++
        };
        Object.assign(this, { canvas }, Object.fromEntries(
          Object.entries(opts).filter(([k, v]) => _Window.#kwargs.includes(k) && v !== void 0)
        ));
        _Window.events.emit("open", this);
      }
      get state() {
        return { ...this.#state };
      }
      get ctx() {
        return this.#canvas.pages[this.page - 1];
      }
      get id() {
        return this.#state.id;
      }
      set id(id) {
        if (id != this.id) throw new Error("Window IDs are immutable");
      }
      get canvas() {
        return this.#canvas;
      }
      set canvas(canvas) {
        if (canvas instanceof Canvas2) {
          canvas.getContext("2d");
          this.#canvas = canvas;
          this.#state.page = canvas.pages.length;
          this.#state.textContrast = canvas.engine.textContrast;
          this.#state.textGamma = canvas.engine.textGamma;
        }
      }
      get visible() {
        return this.#state.visible;
      }
      set visible(flag) {
        this.#state.visible = !!flag;
      }
      get resizable() {
        return this.#state.resizable;
      }
      set resizable(flag) {
        this.#state.resizable = !!flag;
      }
      get borderless() {
        return this.#state.borderless;
      }
      set borderless(flag) {
        this.#state.borderless = !!flag;
      }
      get fullscreen() {
        return this.#state.fullscreen;
      }
      set fullscreen(flag) {
        this.#state.fullscreen = !!flag;
      }
      get title() {
        return this.#state.title;
      }
      set title(txt) {
        this.#state.title = (txt != null ? txt : "").toString();
      }
      get cursor() {
        return this.#state.cursor;
      }
      set cursor(icon) {
        if (css.cursor(icon)) {
          this.#state.cursor = icon;
        }
      }
      get fit() {
        return this.#state.fit;
      }
      set fit(mode) {
        if (css.fit(mode)) this.#state.fit = mode;
      }
      get left() {
        return this.#state.left;
      }
      set left(val) {
        if (Number.isFinite(val)) this.#state.left = val;
      }
      get top() {
        return this.#state.top;
      }
      set top(val) {
        if (Number.isFinite(val)) this.#state.top = val;
      }
      get width() {
        return this.#state.width;
      }
      set width(val) {
        if (Number.isFinite(val)) this.#state.width = val;
      }
      get height() {
        return this.#state.height;
      }
      set height(val) {
        if (Number.isFinite(val)) this.#state.height = val;
      }
      get page() {
        return this.#state.page;
      }
      set page(val) {
        if (val < 0) val += this.#canvas.pages.length + 1;
        let page = this.#canvas.pages[val - 1];
        if (page && this.#state.page != val) {
          let [width, height] = page.prop("size");
          this.#canvas.prop("width", width);
          this.#canvas.prop("height", height);
          this.#state.page = val;
        }
      }
      get background() {
        return this.#state.background;
      }
      set background(c) {
        this.#state.background = (c != null ? c : "").toString();
      }
      get closed() {
        return this.#state.closed;
      }
      close() {
        if (!this.#state.closed) {
          this.#state.closed = true;
          _Window.events.emit("close", this);
        }
      }
      open() {
        if (this.#state.closed) {
          this.#state.closed = false;
          _Window.events.emit("open", this);
        }
      }
      emit(type, e) {
        try {
          super.emit(type, Object.assign({ target: this, type }, e));
        } catch (err) {
          console.error(err);
        }
      }
      [REPR](depth, options) {
        let info = Object.fromEntries(_Window.#kwargs.map((k) => [k, this.#state[k]]));
        return `Window ${inspect(info, options)}`;
      }
    };
    module.exports = { App: new App2(), Window: Window2 };
  }
});

// node_modules/skia-canvas/lib/index.js
var require_lib = __commonJS({
  "node_modules/skia-canvas/lib/index.js"(exports, module) {
    "use strict";
    var { Canvas: Canvas2, CanvasGradient: CanvasGradient2, CanvasPattern: CanvasPattern2, CanvasTexture: CanvasTexture2 } = require_canvas();
    var { Image: Image2, ImageData: ImageData2, loadImage: loadImage2, loadImageData: loadImageData2 } = require_imagery();
    var { DOMPoint: DOMPoint2, DOMMatrix: DOMMatrix2, DOMRect: DOMRect2 } = require_geometry();
    var { TextMetrics: TextMetrics2, FontLibrary: FontLibrary2 } = require_typography();
    var { CanvasRenderingContext2D: CanvasRenderingContext2D2 } = require_context();
    var { App: App2, Window: Window2 } = require_gui();
    var { Path2D: Path2D2 } = require_path();
    module.exports = {
      Canvas: Canvas2,
      CanvasGradient: CanvasGradient2,
      CanvasPattern: CanvasPattern2,
      CanvasTexture: CanvasTexture2,
      Image: Image2,
      ImageData: ImageData2,
      loadImage: loadImage2,
      loadImageData: loadImageData2,
      Path2D: Path2D2,
      DOMPoint: DOMPoint2,
      DOMMatrix: DOMMatrix2,
      DOMRect: DOMRect2,
      FontLibrary: FontLibrary2,
      TextMetrics: TextMetrics2,
      CanvasRenderingContext2D: CanvasRenderingContext2D2,
      App: App2,
      Window: Window2
    };
  }
});

// node_modules/skia-canvas/lib/index.mjs
var import_index = __toESM(require_lib(), 1);
var {
  Canvas,
  CanvasGradient,
  CanvasPattern,
  CanvasTexture,
  Image,
  ImageData,
  loadImage,
  loadImageData,
  Path2D,
  DOMPoint,
  DOMMatrix,
  DOMRect,
  FontLibrary,
  TextMetrics,
  CanvasRenderingContext2D,
  App,
  Window
} = import_index.default;
var export_default = import_index.default;
export {
  App,
  Canvas,
  CanvasGradient,
  CanvasPattern,
  CanvasRenderingContext2D,
  CanvasTexture,
  DOMMatrix,
  DOMPoint,
  DOMRect,
  FontLibrary,
  Image,
  ImageData,
  Path2D,
  TextMetrics,
  Window,
  export_default as default,
  loadImage,
  loadImageData
};
