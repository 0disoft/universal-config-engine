import { z } from "zod";
import {
  createStandardSchemaValidator, runConfigPipeline,
  type StandardConfigSchemaOutput, type ValidatorAdapter
} from "@0disoft/universal-config-engine-core";

const schema = z.object({ port: z.coerce.number().int().positive() });
const validator: ValidatorAdapter<{ port: number }> = createStandardSchemaValidator({ schema });
type Inferred = StandardConfigSchemaOutput<typeof schema>;
const example: Inferred = { port: 443 };
const port: number = example.port;
const direct = await validator.validate({ config: { port: "443" }, provenance: [] });
if (direct.value?.port !== port) throw new Error("Installed schema output inference failed.");
const pipeline = await runConfigPipeline({ context: undefined, validators: [validator], loaders: [{
  descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" },
  load: () => ({ value: { port: "443" } })
}] });
if (!pipeline.result.ok || (pipeline.result.config as { port: string }).port !== "443") {
  throw new Error("Installed Standard Schema must preserve resolved input.");
}
