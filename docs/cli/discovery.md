# Explicit Workspace Discovery

Status: Implemented in the Node API, unreleased (ADR 0018). CLI integration follows
as a separate delivery unit. Existing explicit configuration paths retain their
behavior, and published `1.2.0` does not include this API.

```ts
import { discoverPipelineDeclaration, readTextFileWithinLimit } from "@0disoft/universal-config-engine-node";

const found = await discoverPipelineDeclaration({
  workspacePath: "/app", startPath: "services/api"
});
if (found.ok) {
  const contents = await readTextFileWithinLimit({
    filePath: found.configPath, sourceId: "declaration",
    allowedRootPath: found.workspacePath
  });
}
```

At each directory, check `uce.json`, `.uce.json`, then `uce.config.json`, in that
order. Search the start directory first, then parents, including the explicit
workspace root. The default start is the workspace itself; relative starts are
resolved from it. There is no search outside the workspace, executable JS/TS,
package.json config interpretation, recursive directory scan or env/argv guessing.
These files contain pipeline declarations; dialect data belongs in declared file
sources and is not confused with a declaration.

At most 32 directories are searched by default. `maxDirectories` accepts a positive
safe integer, normalizes invalid values to 32 and is always capped at 256. Each
directory has exactly three candidate names. A required parent beyond the budget
fails with `resource-limit/max_discovery_directories_exceeded`; absence through
the workspace root is `source-load/config_not_found`.

The first existing candidate wins. A directory, broken symlink, inaccessible
candidate or symlink escaping the workspace produces a bounded source-load issue;
discovery never silently falls back to a farther declaration. Selection does not
read or validate contents, so malformed JSON is rejected by the subsequent loader.
Filesystem exception text and paths are omitted from failures. Successful results
include the selected canonical path, canonical workspace and searched-directory
count; those metadata are not intended for public sharing.

Discovery is selection, not an open-file capability. Consumers must still use the
bounded file reader with `allowedRootPath` when opening the selected declaration,
so a link or junction swap cannot bypass the workspace boundary. The existing
opened-file identity verification remains authoritative.
