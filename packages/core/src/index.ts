export {
  DEFAULT_MERGE_POLICY,
  DEFAULT_RESOURCE_LIMITS,
  resolveConfig
} from "./merge.js";
export {
  DEFAULT_SECRET_NAME_PATTERNS,
  buildDiagnosticReport
} from "./redaction.js";
export {
  cloneConfigValue,
  formatPath,
  getConfigValueAtPath,
  isUnsafePathSegment,
  pathToKey,
  pathsEqual,
  setConfigValueAtPath
} from "./path.js";
export {
  flattenConfigObject,
  isConfigValue,
  isPlainConfigObject
} from "./value.js";
export type {
  CoercionRule,
  ConfigIssue,
  ConfigIssueCategory,
  ConfigIssueSeverity,
  ConfigPath,
  ConfigPathSegment,
  ConfigResult,
  ConfigScalar,
  ConfigSourceDescriptor,
  ConfigValue,
  DiagnosticReport,
  DiagnosticReportResolvedPath,
  DiagnosticReportSource,
  LoadedSource,
  MergePolicy,
  OverrideMapping,
  ProvenanceAction,
  ProvenanceEvent,
  RedactionPolicyInput,
  ResolveConfigInput,
  ResolvedPath,
  ResourceLimitPolicy,
  SourceKind,
  SourceLocation,
  ValidatorAdapter,
  ValidatorInput,
  ValidatorResult,
  ValueLocation
} from "./types.js";
