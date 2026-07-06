import type {
  CoercionRule,
  ConfigSourceDescriptor,
  OverrideMapping,
  ResourceLimitPolicy
} from "@universal-config-engine/core";

export type CliCommand = "explain" | "validate";

export type CliOutputMode = "human" | "json";

export interface PipelineDeclaration {
  readonly sources: readonly PipelineSourceDeclaration[];
  readonly coercionRules?: readonly CoercionRule[];
  readonly limits?: Partial<ResourceLimitPolicy>;
}

export type PipelineSourceDeclaration =
  | ObjectSourceDeclaration
  | JsonFileSourceDeclaration
  | DotenvFileSourceDeclaration
  | ProcessEnvSourceDeclaration
  | ArgvSourceDeclaration;

interface BaseSourceDeclaration {
  readonly id: string;
  readonly priority: number;
  readonly displayName?: string;
  readonly redaction?: ConfigSourceDescriptor["redaction"];
}

export interface ObjectSourceDeclaration extends BaseSourceDeclaration {
  readonly kind: "object";
  readonly value: unknown;
}

export interface JsonFileSourceDeclaration extends BaseSourceDeclaration {
  readonly kind: "json-file";
  readonly path: string;
  readonly maxFileBytes?: number;
}

export interface DotenvFileSourceDeclaration extends BaseSourceDeclaration {
  readonly kind: "dotenv-file";
  readonly path: string;
  readonly maxFileBytes?: number;
}

export interface ProcessEnvSourceDeclaration extends BaseSourceDeclaration {
  readonly kind: "process-env";
  readonly mappings: readonly OverrideMapping[];
}

export interface ArgvSourceDeclaration extends BaseSourceDeclaration {
  readonly kind: "argv";
  readonly mappings: readonly OverrideMapping[];
}

export interface CliRuntime {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface CliResult {
  readonly exitCode: number;
}
