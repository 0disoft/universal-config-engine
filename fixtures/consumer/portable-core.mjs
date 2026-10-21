// No Node globals/imports: this exact exercise also runs inside workerd.
export async function exercisePortableCore(core) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const descriptor = (id, priority) => ({ id, priority, kind: "object", displayName: id });
  const sources = [
    { descriptor: descriptor("defaults", 0), value: { server: { port: "80" }, password: "UCE_PORTABLE_PRIVATE" } },
    { descriptor: descriptor("override", 10), value: { server: { port: "443" } } }
  ];
  const outputValidator = core.createStandardSchemaValidator({ schema: { "~standard": {
    version: 1, vendor: "portable-fixture", validate: async value => ({ value: { port: value.server.port } })
  } } });
  const typed = await core.runValidatedConfigPipeline({ context: undefined, loaders: sources.map(source => ({
    descriptor: source.descriptor, load: () => ({ value: source.value })
  })), coercionRules: [{ path: ["server", "port"], from: "string", to: "number", onFailure: "issue" }], outputValidator });
  check(typed.ok && typed.value.port === 443, "Portable typed pipeline failed.");
  check(typed.result.config.server.port === 443, "Portable coercion failed.");
  check(typed.result.resolvedPaths.some(path => path.winningSourceId === "override" && path.overriddenSourceIds.includes("defaults")), "Portable provenance failed.");
  check(!JSON.stringify(typed.report).includes("UCE_PORTABLE_PRIVATE"), "Portable report leaked a value.");
  const inspection = core.buildConfigInspection(typed.result);
  check(inspection.status === "ok" && !JSON.stringify(inspection).includes("UCE_PORTABLE_PRIVATE"), "Portable inspection failed.");
  const publicReport = core.buildPublicDiagnosticReport(typed.report);
  check(publicReport.status === "ok" && !JSON.stringify(publicReport).includes("password"), "Portable projection failed.");
  const after = core.resolveConfig({ sources: [{ descriptor: descriptor("next", 0), value: { server: { port: 444 } } }] });
  check(core.buildConfigDiff(typed.result, after).changes.some(change => change.path.join(".") === "server.port"), "Portable comparison failed.");
  const limited = core.resolveConfig({ sources, limits: { maxSources: 1 } });
  check(!limited.ok && limited.issues.some(issue => issue.code === "max_sources_exceeded"), "Portable resource limit failed.");
  return { status: "ok", checks: ["typed-coercion", "provenance", "redaction", "inspection", "public-projection", "comparison", "resource-limit"] };
}
