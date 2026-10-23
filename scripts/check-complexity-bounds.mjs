import { resolveConfig, checkConfigChanges, buildDiagnosticReport } from "../packages/core/dist/index.js";
import { createArgvSource } from "../packages/node/dist/index.js";
import { compileRedaction } from "../packages/core/dist/compiled-redaction.js";

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

const argvResults = [128, 4096].flatMap((mappingCount) =>
  [undefined, "warning"].map((unmappedBehavior) =>
    measureArgvAccesses(128, mappingCount, unmappedBehavior)
  )
);

for (const result of argvResults) {
  assertEqual(result.elementAccesses, result.argvEntries, `${result.mode} argv element accesses`);
}

process.stdout.write(`${JSON.stringify({
  check: "deterministic-complexity-bounds",
  mergeResults,
  policyResults,
  redactionResults,
  namePatternResults,
  overflowNameResults,
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

function assertLinearGrowth(label, results, field) {
  const smaller = results[0];
  const larger = results[1];
  const smallOperations = smaller[field].total;
  const largeOperations = larger[field].total;
  const maximum = smallOperations * 2 + 64;
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
