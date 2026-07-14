import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";

const validator = createAjvValidator({
  id: "schema",
  schema: {
    type: "object",
    required: ["enabled"],
    properties: { enabled: { type: "boolean" } }
  }
});
const result = validator.validate({ config: { enabled: true }, provenance: [] });

if (!result.ok) {
  throw new Error("Ajv adapter consumer failed.");
}
