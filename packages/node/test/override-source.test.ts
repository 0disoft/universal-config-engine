import { describe, expect, it } from "vitest";
import { resolveConfig, type ConfigSourceDescriptor } from "@0disoft/universal-config-engine-core";
import { createArgvSource, createProcessEnvSource, parseSimpleDotenv } from "../src/index.js";

function descriptor(kind: ConfigSourceDescriptor["kind"]): ConfigSourceDescriptor {
  return { id: kind, kind, priority: 1, displayName: kind };
}

describe("override source dictionary keys", () => {
  it.each(["__proto__", "constructor", "toString"])("preserves an explicit %s through argv, env and dotenv mapping", (externalName) => {
    const target = { externalName, targetPath: ["port"], parseAs: "number" as const };
    for (const argv of [[externalName, "9000"], [`${externalName}=9000`]]) {
      const loaded = createArgvSource({
        descriptor: descriptor("argv"), argv, mappings: [{ ...target, sourceKind: "argv" }]
      });
      expect(loaded.issues).toEqual([]);
      expect(resolveConfig({ sources: [loaded] }).config).toEqual({ port: 9000 });
    }

    const mappings = [{ ...target, sourceKind: "process-env" as const }];
    const env = createProcessEnvSource({
      descriptor: descriptor("process-env"), env: { [externalName]: "9000" }, mappings
    });
    expect(env.issues).toEqual([]);
    expect(resolveConfig({ sources: [env] }).config).toEqual({ port: 9000 });

    const dotenv = parseSimpleDotenv(descriptor("dotenv-file"), `${externalName}=9000`);
    expect(Object.getPrototypeOf(dotenv.value)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(dotenv.value, externalName)).toBe(true);
    const mappedDotenv = createProcessEnvSource({
      descriptor: descriptor("process-env"), env: dotenv.value as NodeJS.ProcessEnv, mappings
    });
    expect(mappedDotenv.issues).toEqual([]);
    expect(resolveConfig({ sources: [mappedDotenv] }).config).toEqual({ port: 9000 });
  });

  it.each(["constructor", "toString", "hasOwnProperty"])("ignores absent env input named %s", (externalName) => {
    const loaded = createProcessEnvSource({
      descriptor: descriptor("process-env"), env: {},
      mappings: [{ externalName, sourceKind: "process-env", targetPath: ["port"], parseAs: "number" }]
    });
    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual([]);
    expect(resolveConfig({ sources: [loaded] }).ok).toBe(true);
  });

  it("does not inspect inherited environment getters", () => {
    const env = Object.create({
      get APP_PORT(): string { throw new Error("Inherited environment input must be ignored."); }
    }) as NodeJS.ProcessEnv;
    const loaded = createProcessEnvSource({
      descriptor: descriptor("process-env"), env,
      mappings: [{ externalName: "APP_PORT", sourceKind: "process-env", targetPath: ["port"] }]
    });
    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual([]);
  });
});
