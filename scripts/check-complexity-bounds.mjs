import { resolveConfig } from "../packages/core/dist/index.js";
import { createArgvSource } from "../packages/node/dist/index.js";

const mergeResults = [512, 1024].map((size) => ({
  size,
  wideConflicts: measureMapOperations(() => runWideConflicts(size)),
  subtreeReplacement: measureMapOperations(() => runSubtreeReplacement(size))
}));

assertLinearGrowth("wide conflicts", mergeResults, "wideConflicts");
assertLinearGrowth("subtree replacement", mergeResults, "subtreeReplacement");

const argvResults = [128, 4096].flatMap((mappingCount) =>
  [undefined, "warning"].map((unmappedBehavior) =>
    measureArgvAccesses(128, mappingCount, unmappedBehavior)
  )
);

for (const result of argvResults) {
  const expectedAccesses = result.mode === "default" ? result.argvEntries : result.argvEntries * 2;
  assertEqual(result.elementAccesses, expectedAccesses, `${result.mode} argv element accesses`);
}

process.stdout.write(`${JSON.stringify({
  check: "deterministic-complexity-bounds",
  mergeResults,
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
