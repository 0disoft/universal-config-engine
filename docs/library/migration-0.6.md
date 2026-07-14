# Migration To 0.6

Status: Current

The `0.6` line deprecates ignored legacy validator issue fields before their
scheduled removal in `1.0.0`. It does not change validator execution or diagnostic
output.

## Package Update

Update the packages used by the consumer together:

```powershell
pnpm update @0disoft/universal-config-engine-core@0.6.0 `
  @0disoft/universal-config-engine-node@0.6.0 `
  @0disoft/universal-config-engine-cli@0.6.0 `
  @0disoft/universal-config-engine-validator-ajv@0.6.0 `
  @0disoft/universal-config-engine-validator-zod@0.6.0
```

## Validator Issues

Validator adapters should return only structured fields trusted by core:

```ts
return {
  ok: false,
  issues: [{
    code: "invalid_port",
    severity: "error",
    path: ["service", "port"]
  }]
};
```

Remove these legacy fields from adapter-produced `ValidatorIssue` objects:

- `category`;
- `message`;
- `sourceId`;
- `details`.

Core has ignored those fields since `0.3` and constructs public `ConfigIssue`
objects from the registered validator id, bounded machine code, severity, and
normalized path. Removing them from consumer code therefore does not change runtime
reports.

The fields remain accepted by the `0.6` TypeScript types with `@deprecated`
documentation so existing adapters continue to compile. They are removed from the
public type beginning with `1.0.0-rc.1`; migrate before adopting the first `1.0`
release candidate.

No runtime deprecation warning is emitted. Library validation does not write
unsolicited output to consumer logs.
