import { createZodValidator } from "@0disoft/universal-config-engine-validator-zod";
import { z } from "zod";

const validator = createZodValidator({
  id: "schema",
  schema: z.object({ enabled: z.boolean() })
});
const result = validator.validate({ config: { enabled: true }, provenance: [] });

if (!result.ok || result.value.enabled !== true) {
  throw new Error("Zod adapter consumer failed.");
}
