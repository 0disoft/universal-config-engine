import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const adapterDocsDir = join(process.cwd(), "docs", "adapters");
const fixtureDir = join(process.cwd(), "docs", "adapters", "fixtures");
const examplesPath = join(adapterDocsDir, "examples.md");
const requiredExampleHeadings = [
  "## Parser Loader Pattern",
  "## YAML Loader Example",
  "## TOML Parse Failure Example",
  "## JSON5 Loader Example",
  "## Validator Path Example"
];
const allowedIssueCategories = new Set([
  "usage",
  "source-load",
  "parse",
  "mapping",
  "merge",
  "coercion",
  "validation",
  "redaction",
  "resource-limit"
]);
const unsafePathSegments = new Set(["__proto__", "prototype", "constructor"]);

validateExamplesDocument();

const files = readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

if (files.length === 0) {
  fail("No adapter fixtures found.");
}

for (const file of files) {
  const fixturePath = join(fixtureDir, file);
  const text = readFileSync(fixturePath, "utf8");
  const fixture = parseJson(file, text);

  if (file.endsWith(".loaded-source.json")) {
    validateLoadedSourceFixture(file, fixture);
    continue;
  }

  if (file.endsWith(".validator-result.json")) {
    validateValidatorResultFixture(file, fixture);
    continue;
  }

  fail(`${file}: fixture filename must end with .loaded-source.json or .validator-result.json.`);
}

function validateExamplesDocument() {
  if (!existsSync(examplesPath)) {
    fail("docs/adapters/examples.md is missing.");
  }

  const text = readFileSync(examplesPath, "utf8");
  for (const heading of requiredExampleHeadings) {
    if (!text.includes(heading)) {
      fail(`docs/adapters/examples.md is missing required heading: ${heading}`);
    }
  }

  const forbiddenClaims = [
    "built-in YAML support",
    "built-in TOML support",
    "built-in JSON5 support"
  ];
  for (const claim of forbiddenClaims) {
    if (text.includes(claim)) {
      fail(`docs/adapters/examples.md must not claim ${claim}.`);
    }
  }
}

function validateLoadedSourceFixture(file, fixture) {
  assertRecord(file, fixture, "fixture");
  const descriptor = fixture.descriptor;
  assertRecord(file, descriptor, "descriptor");
  assertNonEmptyString(file, descriptor.id, "descriptor.id");
  assertEqual(file, descriptor.kind, "adapter", "descriptor.kind");
  assertNumber(file, descriptor.priority, "descriptor.priority");
  assertNonEmptyString(file, descriptor.displayName, "descriptor.displayName");
  validateNormalizedValue(file, fixture.value, "value");

  if (fixture.locations !== undefined) {
    assertArray(file, fixture.locations, "locations");
    for (const [index, location] of fixture.locations.entries()) {
      const prefix = `locations[${index}]`;
      assertRecord(file, location, prefix);
      validatePath(file, location.path, `${prefix}.path`);
      assertRecord(file, location.location, `${prefix}.location`);
      assertEqual(file, location.location.sourceId, descriptor.id, `${prefix}.location.sourceId`);
      if (location.location.sourcePath !== undefined) {
        assertNonEmptyString(file, location.location.sourcePath, `${prefix}.location.sourcePath`);
      }
      if (location.location.line !== undefined) {
        assertPositiveInteger(file, location.location.line, `${prefix}.location.line`);
      }
      if (location.location.column !== undefined) {
        assertPositiveInteger(file, location.location.column, `${prefix}.location.column`);
      }
    }
  }

  if (fixture.issues !== undefined) {
    assertArray(file, fixture.issues, "issues");
    for (const [index, issue] of fixture.issues.entries()) {
      validateIssue(file, issue, `issues[${index}]`, descriptor.id);
    }
  }
}

function validateValidatorResultFixture(file, fixture) {
  assertRecord(file, fixture, "fixture");
  assertNonEmptyString(file, fixture.id, "id");
  assertRecord(file, fixture.result, "result");
  assertBoolean(file, fixture.result.ok, "result.ok");
  assertArray(file, fixture.result.issues, "result.issues");

  for (const [index, issue] of fixture.result.issues.entries()) {
    validateIssue(file, issue, `result.issues[${index}]`, fixture.id);
    assertEqual(file, issue.category, "validation", `result.issues[${index}].category`);
  }
}

function validateIssue(file, issue, path, expectedSourceId) {
  assertRecord(file, issue, path);
  if (!allowedIssueCategories.has(issue.category)) {
    fail(`${file}: ${path}.category is not a known issue category.`);
  }
  assertNonEmptyString(file, issue.code, `${path}.code`);
  if (issue.severity !== "error" && issue.severity !== "warning") {
    fail(`${file}: ${path}.severity must be error or warning.`);
  }
  assertNonEmptyString(file, issue.message, `${path}.message`);
  if (issue.path !== undefined) {
    validatePath(file, issue.path, `${path}.path`);
  }
  if (issue.sourceId !== undefined) {
    assertEqual(file, issue.sourceId, expectedSourceId, `${path}.sourceId`);
  }
  if (issue.details !== undefined) {
    validateIssueDetails(file, issue.details, `${path}.details`);
  }
}

function validateIssueDetails(file, details, path) {
  assertRecord(file, details, path);
  for (const [key, value] of Object.entries(details)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean" &&
      value !== null
    ) {
      fail(`${file}: ${path}.${key} must be a string, number, boolean, or null.`);
    }
  }
}

function validateNormalizedValue(file, value, path) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      validateNormalizedValue(file, item, `${path}[${index}]`);
    }
    return;
  }

  assertRecord(file, value, path);
  for (const [key, item] of Object.entries(value)) {
    if (unsafePathSegments.has(key)) {
      fail(`${file}: ${path}.${key} uses an unsafe path segment.`);
    }
    validateNormalizedValue(file, item, `${path}.${key}`);
  }
}

function validatePath(file, value, path) {
  assertArray(file, value, path);
  if (value.length === 0) {
    fail(`${file}: ${path} must not be empty.`);
  }
  for (const [index, segment] of value.entries()) {
    if (typeof segment !== "string" && typeof segment !== "number") {
      fail(`${file}: ${path}[${index}] must be a string or number.`);
    }
    if (typeof segment === "string" && unsafePathSegments.has(segment)) {
      fail(`${file}: ${path}[${index}] uses an unsafe path segment.`);
    }
  }
}

function parseJson(file, text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(`${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertRecord(file, value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${file}: ${path} must be an object.`);
  }
}

function assertArray(file, value, path) {
  if (!Array.isArray(value)) {
    fail(`${file}: ${path} must be an array.`);
  }
}

function assertNonEmptyString(file, value, path) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${file}: ${path} must be a non-empty string.`);
  }
}

function assertNumber(file, value, path) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${file}: ${path} must be a finite number.`);
  }
}

function assertPositiveInteger(file, value, path) {
  if (!Number.isInteger(value) || value < 1) {
    fail(`${file}: ${path} must be a positive integer.`);
  }
}

function assertBoolean(file, value, path) {
  if (typeof value !== "boolean") {
    fail(`${file}: ${path} must be a boolean.`);
  }
}

function assertEqual(file, actual, expected, path) {
  if (actual !== expected) {
    fail(`${file}: ${path} must be ${JSON.stringify(expected)}.`);
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
