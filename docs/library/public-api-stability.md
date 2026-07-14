# Public API Stability Inventory

Status: Draft
Baseline: `v0.5.0`
Repository Type: library

## Classification

- `stable`: intended to retain source and documented behavioral compatibility
  throughout the `1.x` line.
- `candidate`: already public, but requires an explicit keep, change, or removal
  decision before `1.0.0-rc.1`.
- `compatibility`: retained for older consumers under the deprecation policy.

This inventory classifies exported declarations, not implementation files. No
candidate may be removed solely because a higher-level facade is preferred.

## Core Package

### Stable Functions And Constants

- `runConfigPipeline`, `loadConfigSources`, `resolveConfig`, `runValidators`
- `buildDiagnosticReport`, `combineConfigIssues`
- `applyCoercionRules`, `createMappedOverrideSource`
- `DEFAULT_MERGE_POLICY`, `DEFAULT_RESOURCE_LIMITS`,
  `DEFAULT_SECRET_NAME_PATTERNS`

### Stable Types

- `RunConfigPipelineInput`, `RunConfigPipelineResult`
- `LoadConfigSourcesInput`, `LoadConfigSourcesResult`
- `ResolveConfigInput`, `ConfigResult`
- `RunValidatorsInput`, `RunValidatorsResult`
- `ValidatorAdapter`, `ValidatorInput`, `ValidatorIssue`, `ValidatorResult`
- `ConfigLoader`, `ConfigLoaderResult`, `LoadedSource`
- `ConfigSourceDescriptor`, `SourceKind`, `SourceLocation`, `ValueLocation`
- `ConfigValue`, `ConfigScalar`, `ConfigPath`, `ConfigPathSegment`
- `ConfigIssue`, `ConfigIssueCategory`, `ConfigIssueSeverity`
- `MergePolicy`, `OverrideMapping`, `CoercionRule`
- `ApplyCoercionRulesInput`, `ApplyCoercionRulesResult`
- `CreateMappedOverrideSourceInput`
- `ProvenanceAction`, `ProvenanceEvent`, `ResolvedPath`
- `RedactionPolicyInput`, `DiagnosticReport`, `DiagnosticReportSource`,
  `DiagnosticReportResolvedPath`, `BuildDiagnosticReportOptions`
- `ResourceLimitPolicy`

`ValidatorIssue.message`, `details`, `category`, and `sourceId` are compatibility
fields inside an otherwise stable type. Core ignores them and reconstructs public
diagnostics from structured fields.

### Candidate Low-Level Helpers

- `cloneConfigValue`, `getConfigValueAtPath`, `setConfigValueAtPath`
- `formatPath`, `pathToKey`, `pathsEqual`, `isPathPrefix`,
  `isUnsafePathSegment`
- `flattenConfigObject`, `isConfigValue`, `isPlainConfigObject`

These helpers are independently callable and tested, but their throw behavior,
mutation contract, and role relative to `runConfigPipeline` require explicit stable
documentation before the `1.x` guarantee.

## Node Package

### Stable Functions, Constants, And Types

- `readTextFileWithinLimit`, `loadJsonFileSource`, `loadDotenvFileSource`
- `createProcessEnvSource`, `createArgvSource`
- `DEFAULT_MAX_FILE_BYTES`, `DEFAULT_MAX_ENV_ENTRIES`,
  `DEFAULT_MAX_ARGV_ENTRIES`
- `BoundedTextFileReadResult`, `FileReadPolicy`
- `LoadJsonFileSourceInput`, `LoadDotenvFileSourceInput`
- `CreateProcessEnvSourceInput`, `CreateArgvSourceInput`
- `UnmappedInputBehavior`

### Candidate Low-Level Helpers

- `checkFileSize`
- `parseSimpleDotenv`

Their current behavior is tested, but direct-parser and pre-read size-check usage
needs a stable caller contract distinct from the opened-file loader boundary.

## CLI Package

### Stable Commands, Results, And Constants

- `runCli`
- `EXIT_SUCCESS`, `EXIT_VALIDATION_FAILED`, `EXIT_SOURCE_FAILED`,
  `EXIT_POLICY_FAILED`, `EXIT_USAGE_ERROR`, `EXIT_REDACTION_FAILED`
- `exitCodeForIssues`, `exitCodeForResult`
- `CliCommand`, `CliOutputMode`, `CliResult`, `CliRuntime`, `CliJsonReport`
- `PipelineDeclaration`, `PipelineSourceDeclaration`
- `ObjectSourceDeclaration`, `JsonFileSourceDeclaration`,
  `DotenvFileSourceDeclaration`, `ProcessEnvSourceDeclaration`,
  `ArgvSourceDeclaration`
- `LoadedPipelineDeclaration`

### Candidate Programmatic CLI Stages

- `parseCliArgs`
- `formatHumanReport`, `formatJsonReport`
- `loadPipelineDeclaration`, `loadPipelineDeclarationContext`,
  `loadDeclaredSources`
- `createDeclaredValidators`

The installed `uce` command owns the stable workflow. These exported stages remain
supported through the audit, but their independent composition contract must be
accepted or deprecated before `1.0.0-rc.1`.

## Validator Packages

### Ajv Stable Surface

- `createAjvValidator`, `CreateAjvValidatorInput`
- `instancePathToConfigPath`

### Zod Stable Surface

- `createZodValidator`, `CreateZodValidatorInput`, `ZodValidatorOutput`

Validator package functions return the core `ValidatorAdapter` contract. Their
validator-library peer and runtime dependency policies remain package-specific.

## Audit Exit Conditions

- Every candidate has an accepted keep, deprecate, or remove decision.
- Compatibility fields have a release and removal schedule.
- Stable low-level helpers document throw, mutation, and malformed-input behavior.
- The declaration snapshot and this inventory are checked together before a release
  candidate is tagged.
