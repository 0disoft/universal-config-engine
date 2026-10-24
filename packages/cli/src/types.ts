export type { PipelineDeclaration, PipelineProfileDeclaration, PipelineSourceDeclaration, ObjectSourceDeclaration, JsonFileSourceDeclaration, DotenvFileSourceDeclaration, FileAdapterSourceDeclaration, ProcessEnvSourceDeclaration, ArgvSourceDeclaration, AjvJsonSchemaValidatorDeclaration, PipelineValidatorDeclaration } from "@0disoft/universal-config-engine-node";

export type CliCommand = "explain" | "validate";

export type CliExecutionCommand = CliCommand | "diff";

export type CliOutputMode = "human" | "json";

export interface CliRuntime {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export interface CliResult {
  readonly exitCode: number;
}
