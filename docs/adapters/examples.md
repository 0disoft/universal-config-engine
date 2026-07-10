# Adapter Examples

Status: Draft

## Source of Truth

- Product decision: `docs/product/02-spec.md`
- Adapter contract: `docs/adapters/README.md`
- Adapter ADR: `docs/adr/0006-adapter-ecosystem-contract.md`

## Parser Loader Pattern

Parser adapters should keep parser choice outside core and return normalized loader
results. The adapter owns dialect parsing, source locations, and parse errors.

```ts
import type {
  ConfigIssue,
  ConfigLoader,
  ConfigLoaderResult,
  ConfigSourceDescriptor,
  ConfigValue,
  ValueLocation
} from "@0disoft/universal-config-engine-core";

interface ParsedConfigDocument {
  readonly value: ConfigValue;
  readonly locations?: readonly ValueLocation[];
}

interface ParserFailure {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

type ParseConfigText =
  (text: string) => ParsedConfigDocument | { readonly error: ParserFailure };

interface CreateTextLoaderInput {
  readonly descriptor: ConfigSourceDescriptor;
  readonly sourcePath: string;
  readonly readText: () => Promise<string> | string;
  readonly parseText: ParseConfigText;
  readonly parseErrorCode: string;
}

export function createTextAdapterLoader(input: CreateTextLoaderInput): ConfigLoader {
  return {
    descriptor: input.descriptor,
    async load(): Promise<ConfigLoaderResult> {
      const text = await input.readText();
      const parsed = input.parseText(text);

      if ("error" in parsed) {
        return {
          value: {},
          issues: [
            parserIssue({
              descriptor: input.descriptor,
              sourcePath: input.sourcePath,
              code: input.parseErrorCode,
              error: parsed.error
            })
          ]
        };
      }

      return {
        value: parsed.value,
        ...(parsed.locations === undefined ? {} : { locations: parsed.locations })
      };
    }
  };
}

function parserIssue(input: {
  readonly descriptor: ConfigSourceDescriptor;
  readonly sourcePath: string;
  readonly code: string;
  readonly error: ParserFailure;
}): ConfigIssue {
  return {
    category: "parse",
    code: input.code,
    severity: "error",
    sourceId: input.descriptor.id,
    message: input.error.message,
    details: {
      sourcePath: input.sourcePath,
      ...(input.error.line === undefined ? {} : { line: input.error.line }),
      ...(input.error.column === undefined ? {} : { column: input.error.column })
    }
  };
}
```

## YAML Loader Example

This is an adapter authoring pattern. Core does not parse YAML; the parser is
provided by the adapter package or application.

```ts
const yamlLoader = createTextAdapterLoader({
  descriptor: {
    id: "yaml:app",
    kind: "adapter",
    priority: 20,
    displayName: "app.yaml"
  },
  sourcePath: "app.yaml",
  readText: () => readFileText("app.yaml"),
  parseText: (text) => parseYamlToNormalizedConfig(text),
  parseErrorCode: "yaml_parse_error"
});
```

## TOML Parse Failure Example

Parser failures should be explicit `parse` issues when the parser can identify a
dialect error.

```ts
const tomlLoader = createTextAdapterLoader({
  descriptor: {
    id: "toml:app",
    kind: "adapter",
    priority: 20,
    displayName: "app.toml"
  },
  sourcePath: "app.toml",
  readText: () => readFileText("app.toml"),
  parseText: (text) => parseTomlToNormalizedConfig(text),
  parseErrorCode: "toml_parse_error"
});
```

## JSON5 Loader Example

JSON5 adapters should normalize parser output to ordinary config values before
core sees it. Comments, trailing commas, raw parser tokens, and AST nodes stay
inside the adapter package.

```ts
const json5Loader = createTextAdapterLoader({
  descriptor: {
    id: "json5:developer",
    kind: "adapter",
    priority: 30,
    displayName: "developer.config.json5"
  },
  sourcePath: "developer.config.json5",
  readText: () => readFileText("developer.config.json5"),
  parseText: (text) => parseJson5ToNormalizedConfig(text),
  parseErrorCode: "json5_parse_error"
});
```

## Validator Path Example

Validator adapters receive normalized config and must return normalized config
paths. They should translate validator-specific paths, such as JSON Pointer strings
or library-specific path arrays, before returning issues.

```ts
import type {
  ConfigPath,
  ValidatorAdapter,
  ValidatorIssue
} from "@0disoft/universal-config-engine-core";

interface ExternalValidatorIssue {
  readonly code: string;
  readonly message: string;
  readonly instancePath: string;
}

export function createJsonPointerValidator(
  validateExternal: (value: unknown) => readonly ExternalValidatorIssue[]
): ValidatorAdapter {
  return {
    id: "example-json-pointer-validator",
    validate(input) {
      const externalIssues = validateExternal(input.config);
      const issues = externalIssues.map(toValidatorIssue);

      return {
        ok: issues.length === 0,
        issues
      };
    }
  };
}

function toValidatorIssue(issue: ExternalValidatorIssue): ValidatorIssue {
  return {
    code: issue.code,
    severity: "error",
    path: jsonPointerToConfigPath(issue.instancePath)
  };
}

function jsonPointerToConfigPath(pointer: string): ConfigPath {
  if (pointer === "") {
    return [];
  }

  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((segment) => (/^(0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment));
}
```

Validator adapters may keep typed validator output in `value`, but core does not
replace the resolved config with that value.
