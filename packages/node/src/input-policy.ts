import type { ConfigIssueSeverity } from "@0disoft/universal-config-engine-core";

export type UnmappedInputBehavior = "warning" | "error";

export function behaviorSeverity(behavior: UnmappedInputBehavior): ConfigIssueSeverity {
  return behavior;
}
