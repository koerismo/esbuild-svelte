import { dirname, basename, relative } from "node:path";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { preprocess, compile, VERSION } from "svelte/compiler";
import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
function convertMessage({ message, start, end }, filename, source, sourcemap) {
  let location = {};
  if (start && end) {
    let lineText = source.split(/\r\n|\r|\n/g)[start.line - 1];
    let lineEnd = start.line === end.line ? end.column : lineText.length;
    if (sourcemap) {
      sourcemap = new TraceMap(sourcemap);
      const pos = originalPositionFor(sourcemap, {
        line: start.line,
        column: start.column
      });
      if (pos.source) {
        start.line = pos.line ?? start.line;
        start.column = pos.column ?? start.column;
      }
    }
    location = {
      file: filename,
      line: start.line,
      column: start.column,
      length: lineEnd - start.column,
      lineText
    };
  }
  return { text: message, location };
}
const shouldCache = (build) => {
  var _a, _b;
  return ((_a = build.initialOptions) == null ? void 0 : _a.incremental) || ((_b = build.initialOptions) == null ? void 0 : _b.watch);
};
const SVELTE_VERSION = VERSION.split(".").map((v) => parseInt(v))[0];
const SVELTE_JAVASCRIPT_MODULE_FILTER = /\.svelte\.js$/;
const SVELTE_TYPESCRIPT_MODULE_FILTER = /\.svelte\.ts$/;
const SVELTE_MODULE_FILTER = new RegExp(
  `(${SVELTE_JAVASCRIPT_MODULE_FILTER.source})|(${SVELTE_TYPESCRIPT_MODULE_FILTER.source})`
);
const SVELTE_FILE_FILTER = /\.svelte$/;
const SVELTE_FILTER = SVELTE_VERSION === 5 ? new RegExp(`(${SVELTE_FILE_FILTER.source})|${SVELTE_MODULE_FILTER.source}`) : SVELTE_FILE_FILTER;
const FAKE_CSS_FILTER = /\.esbuild-svelte-fake-css$/;
const TS_MODULE_DISALLOWED_OPTIONS = [
  "absWorkingDir",
  "alias",
  "allowOverwrite",
  "analyze",
  "assetNames",
  "banner",
  "bundle",
  "chunkNames",
  "conditions",
  "entryNames",
  "entryPoints",
  "external",
  "footer",
  "inject",
  "mainFields",
  "mangeProps",
  "mangleQuoted",
  "metafile",
  "nodePaths",
  "outbase",
  "outdir",
  "outExtension",
  "outfile",
  "packages",
  "plugins",
  "preserveSymlinks",
  "publicPath",
  "resolveExtensions",
  "splitting",
  "stdin",
  "treeShaking",
  "tsconfig",
  "write",
  // minify breaks things
  "minify",
  // do not need to do any format conversion
  // output will go though esbuild again anyway
  "format",
  // loader has a different type in build vs transform
  "loader"
];
function sveltePlugin(options) {
  const svelteFilter = (options == null ? void 0 : options.include) ?? SVELTE_FILTER;
  return {
    name: "esbuild-svelte",
    setup(build) {
      if (!options) {
        options = {};
      }
      if (options.cache == void 0 && shouldCache(build)) {
        options.cache = true;
      }
      if (options.filterWarnings == void 0) {
        options.filterWarnings = () => true;
      }
      const transformOptions = (options == null ? void 0 : options.esbuildTsTransformOptions) ?? Object.fromEntries(
        Object.entries(build.initialOptions).filter(
          ([key, val]) => !TS_MODULE_DISALLOWED_OPTIONS.includes(key)
        )
      );
      const cssCode = /* @__PURE__ */ new Map();
      const fileCache = /* @__PURE__ */ new Map();
      build.onLoad({ filter: svelteFilter }, async (args) => {
        var _a, _b, _c, _d, _e;
        let cachedFile = null;
        let previousWatchFiles = [];
        if ((options == null ? void 0 : options.cache) === true && fileCache.has(args.path)) {
          cachedFile = fileCache.get(args.path) || {
            dependencies: /* @__PURE__ */ new Map(),
            data: null
          };
          let cacheValid = true;
          try {
            cachedFile.dependencies.forEach((time, path) => {
              if (statSync(path).mtime > time) {
                cacheValid = false;
              }
            });
          } catch {
            cacheValid = false;
          }
          if (cacheValid) {
            return cachedFile.data;
          } else {
            fileCache.delete(args.path);
          }
        }
        let originalSource = await readFile(args.path, "utf8");
        let filename = relative(process.cwd(), args.path);
        let source = originalSource;
        if (SVELTE_TYPESCRIPT_MODULE_FILTER.test(filename)) {
          try {
            const result = await build.esbuild.transform(originalSource, {
              loader: "ts",
              // first so it can be overrode by esbuildTsTransformOptions
              ...transformOptions
            });
            source = result.code;
          } catch (e) {
            let result = {};
            result.errors = [
              convertMessage(
                e,
                args.path,
                originalSource,
                (_a = options == null ? void 0 : options.compilerOptions) == null ? void 0 : _a.sourcemap
              )
            ];
            if (((_b = build.esbuild) == null ? void 0 : _b.context) !== void 0 || shouldCache(build)) {
              result.watchFiles = previousWatchFiles;
            }
            return result;
          }
        }
        const dependencyModifcationTimes = /* @__PURE__ */ new Map();
        dependencyModifcationTimes.set(args.path, statSync(args.path).mtime);
        let compilerOptions = {
          css: "external",
          ...options == null ? void 0 : options.compilerOptions
        };
        let moduleCompilerOptions = {
          ...options == null ? void 0 : options.moduleCompilerOptions
        };
        try {
          if ((options == null ? void 0 : options.preprocess) && !SVELTE_MODULE_FILTER.test(filename)) {
            let preprocessResult = null;
            try {
              preprocessResult = await preprocess(source, options.preprocess, {
                filename
              });
            } catch (e) {
              if (cachedFile) {
                previousWatchFiles = Array.from(cachedFile.dependencies.keys());
              }
              throw e;
            }
            if (preprocessResult.map) {
              let fixedMap = preprocessResult.map;
              const idx = fixedMap.sources.findIndex((val) => val === filename);
              if (idx != -1) {
                fixedMap.sources[idx] = basename(filename);
              }
              compilerOptions.sourcemap = fixedMap;
            }
            source = preprocessResult.code;
            if ((options == null ? void 0 : options.cache) === true) {
              (_c = preprocessResult.dependencies) == null ? void 0 : _c.forEach((entry) => {
                dependencyModifcationTimes.set(entry, statSync(entry).mtime);
              });
            }
          }
          let { js, css, warnings } = await (async () => {
            if (SVELTE_VERSION === 5 && SVELTE_MODULE_FILTER.test(filename)) {
              const { compileModule } = await import("svelte/compiler");
              return compileModule(source, {
                ...moduleCompilerOptions,
                filename
              });
            }
            return compile(source, {
              ...compilerOptions,
              filename
            });
          })();
          if (compilerOptions.sourcemap) {
            if (js.map.sourcesContent == void 0) {
              js.map.sourcesContent = [];
            }
            const baseFileName = basename(filename);
            const idx = js.map.sources.findIndex((val) => val === baseFileName);
            if (idx != -1) {
              js.map.sourcesContent[idx] = originalSource;
            }
          }
          let contents = js.code + `
//# sourceMappingURL=` + js.map.toUrl();
          if (compilerOptions.css === "external" && (css == null ? void 0 : css.code)) {
            let cssPath = args.path.replace(".svelte", ".esbuild-svelte-fake-css").replace(/\\/g, "/");
            cssCode.set(
              cssPath,
              css.code + `/*# sourceMappingURL=${css.map.toUrl()} */`
            );
            contents = contents + `
import "${cssPath}";`;
          }
          if (options == null ? void 0 : options.filterWarnings) {
            warnings = warnings.filter(options.filterWarnings);
          }
          const result = {
            contents,
            warnings: warnings.map(
              (e) => convertMessage(e, args.path, source, compilerOptions.sourcemap)
            )
          };
          if ((options == null ? void 0 : options.cache) === true) {
            fileCache.set(args.path, {
              data: result,
              dependencies: dependencyModifcationTimes
            });
          }
          if (((_d = build.esbuild) == null ? void 0 : _d.context) !== void 0 || shouldCache(build)) {
            result.watchFiles = Array.from(dependencyModifcationTimes.keys());
          }
          return result;
        } catch (e) {
          let result = {};
          result.errors = [
            convertMessage(e, args.path, originalSource, compilerOptions.sourcemap)
          ];
          if (((_e = build.esbuild) == null ? void 0 : _e.context) !== void 0 || shouldCache(build)) {
            result.watchFiles = previousWatchFiles;
          }
          return result;
        }
      });
      build.onResolve({ filter: FAKE_CSS_FILTER }, ({ path }) => {
        return { path, namespace: "fakecss" };
      });
      build.onLoad({ filter: FAKE_CSS_FILTER, namespace: "fakecss" }, ({ path }) => {
        const css = cssCode.get(path);
        return css ? { contents: css, loader: "css", resolveDir: dirname(path) } : null;
      });
      build.onEnd(() => {
        if (!options) {
          options = {};
        }
        if (options.cache === void 0) {
          options.cache = true;
        }
      });
    }
  };
}
export {
  sveltePlugin as default
};
