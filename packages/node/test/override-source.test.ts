import { describe, expect, it } from "vitest";
import { buildConfigInspection, resolveConfig, type ConfigSourceDescriptor } from "@0disoft/universal-config-engine-core";
import { createArgvSource, createProcessEnvSource, parseSimpleDotenv } from "../src/index.js";

function descriptor(kind: ConfigSourceDescriptor["kind"]): ConfigSourceDescriptor {
  return { id: kind, kind, priority: 1, displayName: kind };
}

describe("override source dictionary keys", () => {
  it.each(["-1", "-1.", "-.5", "-1.e2", "-0", "-1.5e-2"])(
    "parses the same negative number in separate and assignment syntax (%s)", raw => {
      const descriptor = { id: "argv", kind: "argv" as const, priority: 0, displayName: "argv" };
      const mappings = [{ sourceKind: "argv" as const, externalName: "--n", targetPath: ["n"], parseAs: "number" as const }];
      for (const argv of [["--n", raw], [`--n=${raw}`]]) {
        const result = createArgvSource({ descriptor, mappings, argv });
        expect(result.value).toEqual({ n: Number(raw) });
        expect(result.issues).toEqual([]);
      }
    }
  );

  it("rejects ambiguous assignment names before inspecting argument values", () => {
    const argv = Object.defineProperty(["--setting=a=b"], 0, {
      get() { throw new Error("Argument values must not be inspected for invalid declarations."); }
    });
    const loaded = createArgvSource({ descriptor: descriptor("argv"), argv, mappings: [
      { externalName: "--setting", sourceKind: "argv", targetPath: ["first"] },
      { externalName: "--setting=a", sourceKind: "argv", targetPath: ["second"] }
    ] });
    expect(loaded.value).toEqual({});
    expect(loaded.issues).toEqual([expect.objectContaining({ code: "argv_mapping_external_name_invalid", severity: "error" })]);
    expect(resolveConfig({ sources: [loaded] }).ok).toBe(false);
    const env = createProcessEnvSource({ descriptor: descriptor("process-env"), env: { "name=a": "b" },
      mappings: [{ externalName: "name=a", sourceKind: "process-env", targetPath: ["value"] }] });
    expect(env.value).toEqual({ value: "b" });
  });

  it("preserves secret mapping policies through both public Node adapters", () => {
    const loaded = [
      createArgvSource({ descriptor: descriptor("argv"), argv: ["--endpoint=mapping input marker"],
        mappings: [{ externalName: "--endpoint", sourceKind: "argv", targetPath: ["endpoint"], secret: true }] }),
      createProcessEnvSource({ descriptor: descriptor("process-env"), env: { APP_ENDPOINT: "mapping input marker" },
        mappings: [{ externalName: "APP_ENDPOINT", sourceKind: "process-env", targetPath: ["endpoint"], secret: true }] })
    ];
    for (const source of loaded) {
      const inspection = buildConfigInspection(resolveConfig({ sources: [source] }));
      expect(inspection.status).toBe("ok");
      expect(inspection.entries.find(entry => entry.path[0] === "endpoint")?.visibility).toBe("redacted");
      expect(JSON.stringify(inspection)).not.toContain("mapping input marker");
    }
  });
  it.each([
    { argv: ["--token"], code: "argv_missing_value" },
    { argv: ["--token=one", "--token=two"], code: "argv_duplicate_argument" }
  ])("detaches $code paths from reusable mappings", ({ argv, code }) => {
    const targetPath = ["auth", "token"];
    const loaded = createArgvSource({ descriptor: descriptor("argv"), argv,
      mappings: [{ externalName: "--token", sourceKind: "argv", targetPath }] });
    targetPath.splice(0, targetPath.length, "server", "port");
    expect(loaded.issues).toEqual([expect.objectContaining({ code, path: ["auth", "token"] })]);
    expect(loaded.issues?.[0]?.path).not.toBe(targetPath);
    expect(Object.isFrozen(targetPath)).toBe(false);
    expect(resolveConfig({ sources: [loaded] }).issues[0]?.path).toEqual(["auth", "token"]);
  });

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
