import {
  buildConfigDiff, buildConfigInspection, checkConfigChanges, resolveConfig,
  type ConfigChangePolicy, type ConfigInspection, type ConfigDiff, type ConfigChangeCheck
} from "@0disoft/universal-config-engine-core";
import { parseCliArgs, type CliCommand } from "@0disoft/universal-config-engine-cli";

const before = resolveConfig({ sources: [{
  descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" }, value: { port: 80 }
}] });
const after = resolveConfig({ sources: [{
  descriptor: { id: "defaults", kind: "object", priority: 0, displayName: "defaults" }, value: { port: 443 }
}] });
const inspection: ConfigInspection = buildConfigInspection(after, { path: ["port"] });
const diff: ConfigDiff = buildConfigDiff(before, after);
const policy: ConfigChangePolicy = { version: "change-policy-1", rules: [{ id: "port", path: ["port"], mode: "forbid-changes" }] };
const check: ConfigChangeCheck = checkConfigChanges(before, after, policy);
const legacy: Record<CliCommand, true> = { explain: true, validate: true };
if (inspection.entries[0]?.value !== 443 || diff.changes[0]?.kinds[0] !== "value-changed" ||
    check.policy.status !== "failed" || !legacy[parseCliArgs(["validate", "--config", "uce.json"]).command]) {
  throw new Error("Installed inspection, diff, policy or legacy command types failed.");
}
