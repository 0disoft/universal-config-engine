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
fields inside an otherwise stable type. The `0.6` declarations mark them deprecated;
core continues to ignore them and reconstruct public diagnostics from structured
fields until their scheduled `1.0.0` removal.

### Stable Low-Level Helpers

- `cloneConfigValue`, `getConfigValueAtPath`, `setConfigValueAtPath`
- `formatPath`, `pathToKey`, `pathsEqual`, `isPathPrefix`,
  `isUnsafePathSegment`
- `flattenConfigObject`, `isConfigValue`, `isPlainConfigObject`

These independently callable helpers retain the throw, mutation, and malformed-input
contracts accepted in ADR 0016.

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

### Stable Low-Level Helpers

- `checkFileSize`
- `parseSimpleDotenv`

ADR 0016 distinguishes the direct parser and metadata preflight from the opened-file
loader boundary while retaining both public helpers.

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

### Stable Programmatic CLI Stages

- `parseCliArgs`
- `formatHumanReport`, `formatJsonReport`
- `loadPipelineDeclaration`, `loadPipelineDeclarationContext`,
  `loadDeclaredSources`
- `createDeclaredValidators`

The installed `uce` command is the recommended workflow, while ADR 0016 keeps these
programmatic stages compatible throughout `1.x`.

## Validator Packages

### Ajv Stable Surface

- `createAjvValidator`, `CreateAjvValidatorInput`
- `instancePathToConfigPath`

### Zod Stable Surface

- `createZodValidator`, `CreateZodValidatorInput`, `ZodValidatorOutput`

Validator package functions return the core `ValidatorAdapter` contract. Their
validator-library peer and runtime dependency policies remain package-specific.

## Audit Exit Conditions

- Every `v0.5.0` export is stable under ADR 0016.
- Compatibility fields have a release and removal schedule.
- Stable low-level helpers document throw, mutation, and malformed-input behavior.
- The declaration snapshot and this inventory are checked together before a release
  candidate is tagged.
