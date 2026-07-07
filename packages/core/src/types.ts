export type ConfigScalar = string | number | boolean | null;

export type ConfigValue =
  | ConfigScalar
  | readonly ConfigValue[]
  | { readonly [key: string]: ConfigValue };

export type ConfigPathSegment = string | number;

export type ConfigPath = readonly ConfigPathSegment[];

export type SourceKind =
  | "defaults"
  | "object"
  | "json-file"
  | "dotenv-file"
  | "process-env"
  | "argv"
  | "adapter";

export interface RedactionPolicyInput {
  readonly secretSource?: boolean;
  readonly secretPaths?: readonly ConfigPath[];
  readonly secretNamePatterns?: readonly string[];
}

export interface ConfigSourceDescriptor {
  readonly id: string;
  readonly kind: SourceKind;
  readonly priority: number;
  readonly displayName: string;
  readonly redaction?: RedactionPolicyInput;
}

export interface SourceLocation {
  readonly sourceId: string;
  readonly sourcePath?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface ValueLocation {
  readonly path: ConfigPath;
  readonly location: SourceLocation;
}

export type ConfigIssueCategory =
  | "source-load"
  | "parse"
  | "mapping"
  | "merge"
  | "coercion"
  | "validation"
  | "redaction"
  | "resource-limit";

export type ConfigIssueSeverity = "error" | "warning";

export interface ConfigIssue {
  readonly category: ConfigIssueCategory;
  readonly code: string;
  readonly severity: ConfigIssueSeverity;
  readonly message: string;
  readonly path?: ConfigPath;
  readonly sourceId?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LoadedSource {
  readonly descriptor: ConfigSourceDescriptor;
  readonly value: unknown;
  readonly locations?: readonly ValueLocation[];
  readonly issues?: readonly ConfigIssue[];
}

export interface ConfigLoaderResult {
  readonly value: unknown;
  readonly locations?: readonly ValueLocation[];
  readonly issues?: readonly ConfigIssue[];
}

export interface ConfigLoader<TContext = undefined> {
  readonly descriptor: ConfigSourceDescriptor;
  load(context: TContext): Promise<ConfigLoaderResult> | ConfigLoaderResult;
}

export type ProvenanceAction =
  | "defined"
  | "overridden"
  | "defaulted"
  | "coerced"
  | "validated"
  | "redacted"
  | "rejected";

export interface ProvenanceEvent {
  readonly path: ConfigPath;
  readonly action: ProvenanceAction;
  readonly sourceId: string;
  readonly previousSourceId?: string;
  readonly message: string;
}

export interface MergePolicy {
  readonly objectPolicy: "deep-merge";
  readonly arrayPolicy: "replace";
  readonly scalarPolicy: "higher-priority-replaces";
  readonly nullPolicy: "explicit-null-overwrites";
  readonly unsafeKeyPolicy: "reject";
  readonly samePriorityPolicy: "issue-and-later-source-wins";
}

export interface ResourceLimitPolicy {
  readonly maxDepth: number;
  readonly maxKeyCount: number;
  readonly maxPathLength: number;
  readonly maxDiagnostics: number;
}

export interface OverrideMapping {
  readonly externalName: string;
  readonly targetPath: ConfigPath;
  readonly sourceKind: "process-env" | "argv";
  readonly parseAs?: "string" | "number" | "boolean" | "json";
  readonly secret?: boolean;
}

export interface CoercionRule {
  readonly path: ConfigPath;
  readonly from: "string";
  readonly to: "number" | "boolean" | "json";
  readonly onFailure: "issue";
}

export interface ValidatorInput {
  readonly config: ConfigValue;
  readonly provenance: readonly ProvenanceEvent[];
}

export interface ValidatorResult<TValidated = unknown> {
  readonly ok: boolean;
  /**
   * Adapter-local typed output. Core validation records issues and provenance only;
   * it does not replace pipeline config with this value.
   */
  readonly value?: TValidated;
  readonly issues: readonly ConfigIssue[];
}

export interface ValidatorAdapter<TValidated = unknown> {
  readonly id: string;
  validate(input: ValidatorInput): Promise<ValidatorResult<TValidated>> | ValidatorResult<TValidated>;
}

export interface ResolvedPath {
  readonly path: ConfigPath;
  readonly status: "resolved";
  readonly winningSourceId: string;
  readonly winningPriority: number;
  readonly overriddenSourceIds: readonly string[];
}

export interface ResolveConfigInput {
  readonly sources: readonly LoadedSource[];
  readonly mergePolicy?: Partial<MergePolicy>;
  readonly limits?: Partial<ResourceLimitPolicy>;
  readonly coercionRules?: readonly CoercionRule[];
}

export interface ConfigResult {
  readonly ok: boolean;
  readonly config: ConfigValue;
  readonly sources: readonly ConfigSourceDescriptor[];
  readonly issues: readonly ConfigIssue[];
  readonly provenance: readonly ProvenanceEvent[];
  readonly resolvedPaths: readonly ResolvedPath[];
  readonly limits: ResourceLimitPolicy;
}

export interface DiagnosticReportSource {
  readonly id: string;
  readonly kind: SourceKind;
  readonly displayName: string;
  readonly priority: number;
  readonly status: "loaded" | "failed";
}

export interface DiagnosticReportResolvedPath {
  readonly path: ConfigPath;
  readonly status: "resolved";
  readonly winningSourceId: string;
  readonly overriddenSourceIds: readonly string[];
  readonly redacted: boolean;
  readonly redactionReason?: string;
}

export interface DiagnosticReport {
  readonly schemaVersion: "0.1";
  readonly status: "ok" | "error";
  readonly sources: readonly DiagnosticReportSource[];
  readonly resolvedPaths: readonly DiagnosticReportResolvedPath[];
  readonly issues: readonly ConfigIssue[];
  readonly provenance: readonly ProvenanceEvent[];
  readonly limits: ResourceLimitPolicy;
}
