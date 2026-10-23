import { resolveConfig, checkConfigChanges, buildDiagnosticReport } from "../packages/core/dist/index.js";
import { createArgvSource } from "../packages/node/dist/index.js";
import { compileRedaction } from "../packages/core/dist/compiled-redaction.js";
import { DEFAULT_SECRET_NAME_PATTERNS } from "../packages/core/dist/redaction.js";

const mergeResults = [512, 1024].map((size) => ({
  size,
  wideConflicts: measureMapOperations(() => runWideConflicts(size)),
  subtreeReplacement: measureMapOperations(() => runSubtreeReplacement(size))
}));

assertLinearGrowth("wide conflicts", mergeResults, "wideConflicts");
assertLinearGrowth("subtree replacement", mergeResults, "subtreeReplacement");

const policyResults = [512, 1024].map(size => {
  const result = resolveConfig({ sources: [objectSource("file", 0, createWideObject(size, 0))] });
  let total = 0;
  const measured = { ...result, resolvedPaths: result.resolvedPaths.map(entry => new Proxy(entry, {
    get(target, key, receiver) { if (key === "path") total++; return Reflect.get(target, key, receiver); }
  })) };
  const rules = Array.from({ length: size / 8 }, (_, index) => ({
    id: `rule-${index}`, path: [], mode: "allowed-sources", allowedSourceIds: ["file"]
  }));
  const checked = checkConfigChanges(measured, measured, { version: "change-policy-1", rules });
  assertEqual(checked.status, "ok", "indexed policy outcome");
  return { size, rules: rules.length, pathAccesses: { total } };
});
assertLinearGrowth("policy path accesses", policyResults, "pathAccesses");

const redactionResults = [512, 1024].map(size => {
  const sourceCount = size / 32;
  const result = resolveConfig({ sources: Array.from({ length: sourceCount }, (_, index) =>
    objectSource(`source-${index}`, index, index === sourceCount - 1 ? createWideObject(size, 0) : {})) });
  let total = 0;
  const measured = { ...result, sources: result.sources.map(source => new Proxy(source, {
    get(target, key, receiver) { if (key === "redaction") total++; return Reflect.get(target, key, receiver); }
  })) };
  assertEqual(buildDiagnosticReport(measured).status, "ok", "compiled redaction outcome");
  return { size, sourceCount, policyAccesses: { total } };
});
assertLinearGrowth("redaction policy accesses", redactionResults, "policyAccesses");

const namePatternResults = [512, 1024].map(size => {
  const match = compileRedaction([], { secretNamePatterns: Array.from({ length: size }, (_, index) => `secret_marker_${index}_end`) }, [], []);
  const includes = String.prototype.includes;
  let substringChecks = 0;
  const transitions = measureMapOperations(() => {
    String.prototype.includes = function (...args) {
      substringChecks++;
      return Reflect.apply(includes, this, args);
    };
    try {
      for (let index = 0; index < size; index++) {
        assertEqual(match(["service", `public_${String(index).padStart(6, "0")}`]).redacted, false, "name pattern miss");
      }
    } finally { String.prototype.includes = includes; }
  });
  return { size, patterns: size, queryOperations: { ...transitions, substringChecks, total: transitions.total + substringChecks } };
});
assertLinearGrowth("name pattern query operations", namePatternResults, "queryOperations");

const overflowNameResults = [512, 1024].map(size => {
  const patterns = Array.from({ length: size * 16 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_marker");
  let match;
  const compilation = measureMapOperations(() => { match = compileRedaction([], { secretNamePatterns: patterns }, [], []); });
  if (compilation.set > patterns.length + 65_536) throw new Error("Overflow matcher exceeded its automaton state budget.");
  const includes = String.prototype.includes;
  let substringChecks = 0;
  const transitions = measureMapOperations(() => {
    String.prototype.includes = function (...args) {
      substringChecks++;
      return Reflect.apply(includes, this, args);
    };
    try {
      for (let index = 0; index < size; index++) {
        assertEqual(match(["service", `public_field_${String(index).padStart(6, "0")}`]).redacted, false, "overflow pattern miss");
      }
    } finally { String.prototype.includes = includes; }
  });
  return { size, patterns: patterns.length, compilationSets: compilation.set,
    queryOperations: { ...transitions, substringChecks, total: transitions.total + substringChecks } };
});
assertLinearGrowth("overflow name pattern query operations", overflowNameResults, "queryOperations");

const longNameResults = [4096, 8192].map(size => {
  // Distinct suffixes bypass the bounded suffix gate and exercise pair filtering.
  const patterns = Array.from({ length: size * 2 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_" + String(index).padStart(5, "0"));
  const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
  const charCodeAt = String.prototype.charCodeAt;
  const includes = String.prototype.includes;
  const NativeUint32Array = globalThis.Uint32Array;
  let charReads = 0; let substringChecks = 0; let bufferBytes = 0;
  String.prototype.charCodeAt = function (...args) { charReads++; return Reflect.apply(charCodeAt, this, args); };
  String.prototype.includes = function (...args) { substringChecks++; return Reflect.apply(includes, this, args); };
  globalThis.Uint32Array = new Proxy(NativeUint32Array, {
    construct(target, args) { const result = Reflect.construct(target, args); bufferBytes += result.byteLength; return result; }
  });
  try {
    for (let index = 0; index < 4; index++) {
      assertEqual(match(["service", "q".repeat(size) + String(index).padStart(6, "0")]).redacted, false, "long name miss");
    }
  } finally {
    String.prototype.charCodeAt = charCodeAt;
    String.prototype.includes = includes;
    globalThis.Uint32Array = NativeUint32Array;
  }
  assertEqual(substringChecks, 0, "long names must reject absent pattern grams before exact searches");
  assertEqual(bufferBytes, 131_072, "one fixed streaming filter per matcher");
  return { size, patterns: patterns.length, paths: 4, bufferBytes, substringChecks, charReads: { total: charReads } };
});
assertLinearGrowth("streaming long name character reads", longNameResults, "charReads");

const suffixGateResults = [512, 1024].map(size => {
  const patterns = Array.from({ length: size * 16 }, (_, index) => String(index).padStart(5, "0") + "_sensitive_marker");
  const match = compileRedaction([], { secretNamePatterns: patterns }, DEFAULT_SECRET_NAME_PATTERNS, []);
  const includes = String.prototype.includes;
  const charCodeAt = String.prototype.charCodeAt;
  const NativeUint32Array = globalThis.Uint32Array;
  let total = 0; let charReads = 0; let bytes = 0;
  String.prototype.includes = function (...args) { total++; return Reflect.apply(includes, this, args); };
  String.prototype.charCodeAt = function (...args) { charReads++; return Reflect.apply(charCodeAt, this, args); };
  globalThis.Uint32Array = new Proxy(NativeUint32Array, {
    construct(target, args) { const result = Reflect.construct(target, args); bytes += result.byteLength; return result; }
  });
  try {
    for (let index = 0; index < 4; index++) assertEqual(match(["service", "q".repeat(size) + index]).redacted, false, "suffix-gated miss");
  } finally {
    String.prototype.includes = includes;
    String.prototype.charCodeAt = charCodeAt;
    globalThis.Uint32Array = NativeUint32Array;
  }
  assertEqual(bytes, 0, "suffix rejection must not allocate the lazy query filter");
  assertEqual(charReads, 0, "suffix rejection must not visit pattern units");
  if (total > 4 * 32 * 2) throw new Error("Suffix checks exceeded the bounded gate size.");
  return { size, patterns: patterns.length, bytes, charReads, suffixChecks: { total } };
});
assertLinearGrowth("bounded suffix checks", suffixGateResults, "suffixChecks");

const adversarialNameResults = ["many-lengths", "hash-collisions", "filter-positives", "gram-positives", "run-cap", "alternating"].map(kind => {
  const results = [256, 512].map(size => {
    const padding = Array.from({ length: 40 }, (_, index) => String(index).padStart(2, "0") + "x".repeat(2000));
    const candidates = Array.from({ length: size }, (_, index) => kind === "many-lengths" ? "a".repeat(index + 2) + "b"
      : kind === "hash-collisions" ? "a~".repeat(index + 2)
      : "ab" + (kind === "alternating" ? "xy" : "x").repeat(index + 8) + "cd");
    const name = kind === "many-lengths" ? "q".repeat(size * 32)
      : kind === "hash-collisions" ? "b_".repeat(size * 16)
      : (kind === "alternating" ? "abxyxycd" : kind === "gram-positives" || kind === "run-cap" ? "abxxxxcd" : "abxxcd").repeat(size * 8)
        + (kind === "run-cap" ? "q".repeat(33) : "");
    const match = compileRedaction([], { secretNamePatterns: [...padding, ...candidates] }, [], []);
    const charCodeAt = String.prototype.charCodeAt;
    const includes = String.prototype.includes;
    const slice = String.prototype.slice;
    const NativeUint32Array = globalThis.Uint32Array;
    let total = 0; let searches = 0; let slices = 0; let bytes = 0; let gramSearches = 0;
    const candidateNames = ["gram-positives", "run-cap", "alternating"].includes(kind) ? new Set(candidates) : undefined;
    let candidateReads = 0;
    String.prototype.charCodeAt = function (...args) {
      total++;
      if (candidateNames?.has(String(this))) candidateReads++;
      return Reflect.apply(charCodeAt, this, args);
    };
    String.prototype.includes = function (...args) {
      if (String(args[0]).length === 4) gramSearches++; else searches++;
      return Reflect.apply(includes, this, args);
    };
    String.prototype.slice = function (...args) {
      slices++;
      const result = Reflect.apply(slice, this, args);
      assertEqual(result.length, 4, "preview slices must remain four units");
      return result;
    };
    globalThis.Uint32Array = new Proxy(NativeUint32Array, {
      construct(target, args) { const result = Reflect.construct(target, args); bytes += result.byteLength; return result; }
    });
    try { assertEqual(match([name]).redacted, false, `${kind} literal miss`); }
    finally {
      String.prototype.charCodeAt = charCodeAt;
      String.prototype.includes = includes;
      String.prototype.slice = slice;
      globalThis.Uint32Array = NativeUint32Array;
    }
    assertEqual(bytes, 131_072, `${kind} fixed query filter`);
    assertEqual(slices, kind === "filter-positives" ? 2 : candidateNames !== undefined ? 3 : 0,
      `${kind} bounded preview without substring windows`);
    if (gramSearches > 6) throw new Error("Gram preview exceeded three samples in two normalized strings.");
    assertEqual(searches, ["filter-positives", "gram-positives", "alternating"].includes(kind) ? 128 : kind === "run-cap" ? size : 0,
      `${kind} exact searches limited to surviving patterns`);
    // Query spans are at most four. Alternating candidates first fail the
    // two-read uniform check, then reject after five period-two sample reads.
    if (candidateNames !== undefined) assertEqual(candidateReads, size * (4 + 8) + (kind === "run-cap" ? 0 : (size - 128) * (kind === "alternating" ? 7 : 5)),
      "run samples reject impossible native searches");
    if (candidateNames !== undefined && total > name.length * (kind === "alternating" ? 3 : 2) + size * 19 + 1024)
      throw new Error("Run rejection exceeded one extra query pass and bounded pattern samples.");
    return { size, searches, slices, bytes, charReads: { total } };
  });
  // The first 128 searches omit either three four-unit gram samples or the
  // seven run-sample reads. Allow that fixed saving, not a new growth slope.
  assertLinearGrowth(kind, results, "charReads", kind === "alternating" ? 128 * 7 : kind.endsWith("positives") ? 128 * 3 * 4 : 0);
  return { kind, results };
});

const argvResults = [128, 4096].flatMap((mappingCount) =>
  [undefined, "warning"].map((unmappedBehavior) =>
    measureArgvAccesses(128, mappingCount, unmappedBehavior)
  )
);

const prefixGateResults = ["diverse-suffixes", "incidental-suffix"].map(kind => {
  const results = [8192, 16_384].map(size => {
    const patterns = Array.from({ length: size }, (_, index) => String(index).padStart(5, "0") + "_sensitive_"
      + (kind === "diverse-suffixes" ? String(index).padStart(5, "0") : "marker"));
    const match = compileRedaction([], { secretNamePatterns: patterns }, DEFAULT_SECRET_NAME_PATTERNS, []);
    const path = ["service", "q".repeat(512) + (kind === "incidental-suffix" ? "_sensitive_marker" : "")];
    assertEqual(match(path).redacted, false, "prefix gate warmup");
    const iterator = Map.prototype[Symbol.iterator];
    const charCodeAt = String.prototype.charCodeAt;
    let patternVisits = 0; let total = 0;
    Map.prototype[Symbol.iterator] = function* () {
      for (const entry of Reflect.apply(iterator, this, [])) { patternVisits++; yield entry; }
    };
    String.prototype.charCodeAt = function (...args) { total++; return Reflect.apply(charCodeAt, this, args); };
    try {
      for (let index = 0; index < 4; index++) assertEqual(match(path).redacted, false, `${kind} prefix miss`);
    } finally {
      Map.prototype[Symbol.iterator] = iterator;
      String.prototype.charCodeAt = charCodeAt;
    }
    assertEqual(patternVisits, 0, `${kind} must not revisit the policy dictionary`);
    if (total > 8 * path.join(".").length) throw new Error("Prefix gate exceeded its query-length character bound.");
    return { size, patternVisits, charReads: { total } };
  });
  assertEqual(results[0].charReads.total, results[1].charReads.total, `${kind} policy-independent warm queries`);
  return { kind, results };
});

for (const result of argvResults) {
  assertEqual(result.elementAccesses, result.argvEntries, `${result.mode} argv element accesses`);
}

const positivePrefixResults = [8192, 16_384].map(size => {
  const patterns = Array.from({ length: size }, (_, index) => "0000" + String(index).padStart(5, "0") + "_sensitive_marker");
  const paths = Array.from({ length: 4 }, (_, index) => ["service", "0000" + "q".repeat(4096) + index + "_sensitive_marker"]);
  const NativeUint32Array = globalThis.Uint32Array;
  const includes = String.prototype.includes;
  const charCodeAt = String.prototype.charCodeAt;
  let bytes = 0; let exactSearches = 0; let total = 0;
  globalThis.Uint32Array = new Proxy(NativeUint32Array, {
    construct(target, args) { const result = Reflect.construct(target, args); bytes += result.byteLength; return result; }
  });
  try {
    const match = compileRedaction([], { secretNamePatterns: patterns }, [], []);
    assertEqual(match(paths[0]).redacted, false, "positive prefix warmup");
    String.prototype.includes = function (...args) {
      if (String(args[0]).length > 4) exactSearches++;
      return Reflect.apply(includes, this, args);
    };
    String.prototype.charCodeAt = function (...args) { total++; return Reflect.apply(charCodeAt, this, args); };
    for (const path of paths) assertEqual(match(path).redacted, false, "positive prefix exact miss");
  } finally {
    globalThis.Uint32Array = NativeUint32Array;
    String.prototype.includes = includes;
    String.prototype.charCodeAt = charCodeAt;
  }
  assertEqual(bytes, 139_264, "positive prefix retains the 136 KiB filter-buffer ceiling");
  if (exactSearches > size * paths.length / 32) throw new Error("Positive prefix candidates were not rejected before exact searches.");
  return { size, bytes, exactSearches, charReads: { total } };
});
// The preview finds common grams at both policy sizes, avoiding an extra query pass.
assertLinearGrowth("positive prefix filter work", positivePrefixResults, "charReads");

process.stdout.write(`${JSON.stringify({
  check: "deterministic-complexity-bounds",
  mergeResults,
  policyResults,
  redactionResults,
  namePatternResults,
  overflowNameResults,
  longNameResults,
  suffixGateResults,
  adversarialNameResults,
  prefixGateResults,
  positivePrefixResults,
  argvResults
}, null, 2)}\n`);

function runWideConflicts(size) {
  const result = resolveConfig({
    sources: [
      objectSource("left", 1, createWideObject(size, 0)),
      objectSource("right", 1, createWideObject(size, 1))
    ],
    limits: { maxDiagnostics: 32 }
  });
  assertEqual(result.resolvedPaths.length, size, "wide conflict resolved paths");
  assertEqual(result.issues.at(-1)?.code, "max_diagnostics_exceeded", "wide conflict marker");
}

function runSubtreeReplacement(size) {
  const result = resolveConfig({
    sources: [
      objectSource("base", 0, { root: createWideObject(size, 0) }),
      objectSource("replacement", 10, { root: "replaced" })
    ],
    limits: { maxKeyCount: size + 1 }
  });
  assertEqual(result.resolvedPaths.length, 1, "subtree replacement resolved paths");
  assertEqual(result.resolvedPaths[0]?.path.join("."), "root", "subtree replacement path");
}

function measureMapOperations(run) {
  const methods = ["get", "set", "has", "delete"];
  const originals = new Map(methods.map((name) => [name, Map.prototype[name]]));
  const counts = Object.fromEntries(methods.map((name) => [name, 0]));

  try {
    for (const name of methods) {
      const original = originals.get(name);
      Map.prototype[name] = function (...args) {
        counts[name] += 1;
        return Reflect.apply(original, this, args);
      };
    }
    run();
  } finally {
    for (const name of methods) {
      Map.prototype[name] = originals.get(name);
    }
  }

  return {
    ...counts,
    total: Object.values(counts).reduce((sum, value) => sum + value, 0)
  };
}

function assertLinearGrowth(label, results, field, startupAllowance = 0) {
  const smaller = results[0];
  const larger = results[1];
  const smallOperations = smaller[field].total;
  const largeOperations = larger[field].total;
  const maximum = smallOperations * 2 + 64 + startupAllowance;
  if (largeOperations > maximum) {
    throw new Error(
      `${label} exceeded deterministic linear bound: ${largeOperations} > ${maximum}.`
    );
  }
}

function measureArgvAccesses(argvEntries, mappingCount, unmappedBehavior) {
  const values = Array.from({ length: argvEntries }, (_, index) => `--key-${index}=${index}`);
  let elementAccesses = 0;
  const argv = new Proxy(values, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property)) {
        elementAccesses += 1;
      }
      return Reflect.get(target, property, receiver);
    }
  });
  const mappings = Array.from({ length: mappingCount }, (_, index) => ({
    externalName: `--key-${index}`,
    sourceKind: "argv",
    targetPath: [`key_${index}`],
    parseAs: "number"
  }));
  const source = createArgvSource({
    descriptor: {
      id: "argv",
      kind: "argv",
      priority: 10,
      displayName: "argv"
    },
    argv,
    mappings,
    ...(unmappedBehavior === undefined ? {} : { unmappedBehavior })
  });

  assertEqual(source.issues?.length ?? 0, 0, "argv issue count");
  assertEqual(source.value.key_0, 0, "argv first mapped value");
  assertEqual(source.value[`key_${argvEntries - 1}`], argvEntries - 1, "argv last mapped value");
  return {
    mode: unmappedBehavior === undefined ? "default" : "strict-warning",
    argvEntries,
    mappingCount,
    elementAccesses
  };
}

function objectSource(id, priority, value) {
  return {
    descriptor: { id, kind: "object", priority, displayName: id },
    value
  };
}

function createWideObject(size, offset) {
  return Object.fromEntries(
    Array.from({ length: size }, (_, index) => [`key_${index}`, index + offset])
  );
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}.`);
  }
}
