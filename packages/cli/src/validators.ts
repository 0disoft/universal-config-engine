import { createDeclaredValidators as compile, type PipelineDeclaration } from "@0disoft/universal-config-engine-node";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";
import type { CreateDeclaredValidatorsResult } from "@0disoft/universal-config-engine-node";
export type { CreateDeclaredValidatorsResult } from "@0disoft/universal-config-engine-node";

export function createDeclaredValidators(declaration: PipelineDeclaration): CreateDeclaredValidatorsResult {
  return compile(declaration, createAjvValidator);
}
