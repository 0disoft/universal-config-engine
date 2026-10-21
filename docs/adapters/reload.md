# Reload and File Watching

Status: Unreleased, ADR 0018. Existing pipelines never start background work.

`createConfigReloader({ load, onChange? })` returns `refresh()`, `getSnapshot()`
and `close()`. The callback runs the application's existing pipeline. Refreshes
are serialized: one load can run and one following load can be queued; further
requests share that queued Promise. No unbounded queue of callback work is kept.
The running slot is claimed before calling application code, so even a synchronous
refresh request made inside `load` joins the single queue rather than overlapping
the active load. Such a request must not be awaited by that active callback.

A successful result and report are cloned and deeply frozen before publication.
Snapshots contain application config, including secret values, and must not be
logged. Failure retains the previous snapshot and revision. Failed outcomes expose
only `load_failed`, `validation_failed` or `snapshot_failed`, never exceptions.
Observer failures are contained. Updated events expose revision and, when a safe
comparison fits its budget, a public-path change count. Secret-only changes are
not counted; no value, fingerprint or diagnostic prose is emitted by these events.

`close()` is idempotent, resolves queued work as `closed`, prevents late snapshots
or notifications and retains the last good snapshot for reading. It cannot cancel
an arbitrary application callback already running; that callback owns its timeout
and external resources. Do not await another refresh from inside `load`.

## Selected file watching

`await watchConfigFiles({ workspacePath, paths, load, onChange?, debounceMs? })`
returns `{ ok: true, watcher, initial }` or a sanitized setup failure. `watcher`
has the same methods as a reloader. At most 64 explicit paths are accepted;
the bounded selection is copied and validated before asynchronous filesystem work,
so later changes to the caller's array do not change this watcher's inputs.
Relative paths use the workspace. Parent directories and existing targets are
canonicalized and checked inside that boundary. Actual file loaders must still
enforce the workspace when opening each file, including after replacement.

In-workspace file symlinks watch both the link and the canonical target. Before
each load, target boundaries are rechecked and directory watches are rebound;
retargeting outside the workspace rejects the refresh without calling `load`.
Selections are deduplicated and use at most two directory handles per input path.

Watching starts before the initial refresh. Parent directories are watched with
basename filtering so atomic file replacement keeps working. A null filename
requests a refresh; events are debounced (default 25 ms, configurable 0–1000 ms)
and use the same coalescing queue. File changes made during a load queue a refresh.
No recursive directory scanning or automatic dependency discovery occurs. Supply
the declaration, inherited declarations and actual file sources; recreate the
watcher if that dependency set changes. Environment/argv updates require manual
refresh. Filesystem watching is best effort and is not a transactional filesystem
snapshot; callers needing transactions must provide that in `load`.

`close()` clears the timer and closes all handles. A watch error emits
`rejected/watch_failed` and closes the watcher; recreate it after fixing the
filesystem problem. A failed initial load still returns a watcher so a later
file correction can recover. Watch handles are non-persistent and do not keep an
otherwise finished Node process alive. No process/global listeners are installed.
