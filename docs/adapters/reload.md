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
Configuration cloning and freezing are iterative, preserving core's support for
valid deep configurations when the application explicitly increases its limits.
Snapshots contain application config, including secret values, and must not be
logged. Failure retains the previous snapshot and revision. Failed outcomes expose
only `load_failed`, `validation_failed` or `snapshot_failed`, never exceptions.
Observer failures are contained. Updated events expose revision and, when a safe
comparison fits its budget, a public-path change count. Secret-only changes are
not counted; no value, fingerprint or diagnostic prose is emitted by these events.
Comparison retains redacted paths from both reports, including policies supplied
only through pipeline `reportOptions` and policies removed on the next refresh.
When a changed container is a strict typed ancestor of a redacted reported path,
its public/secret boundary cannot be reconstructed from leaf metadata alone.
The event omits `changedPathCount` in that case, including opaque object addition
or deletion, while still publishing the successful snapshot and revision.
Unambiguous scalar secret changes and independent public changes retain counts.

`close()` is idempotent, resolves active and queued refresh promises as `closed`,
prevents late snapshots or notifications and retains the last good snapshot.
An optional lifetime `signal` closes the reloader on abort. Each `load` callback
receives optional `{ signal }` options backed by an owned controller; closing
aborts that controller. Existing zero-argument callbacks remain supported. A
callback that ignores the signal may continue its external work, but no longer
holds the refresh promise open and its late rejection is observed. Do not await
another refresh from inside `load`.

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
with a maximum wait of 1000 ms from the first pending event. Continuous writes
therefore request periodic refreshes even without a quiet interval; an active load
may delay execution through the existing single queued refresh. Closing cancels
both the debounce and maximum-wait timers.
File changes made during a load queue a refresh through the same coalescing queue.
No recursive directory scanning or automatic dependency discovery occurs. Supply
the declaration, inherited declarations and actual file sources; recreate the
watcher if that dependency set changes. Environment/argv updates require manual
refresh. Filesystem watching is best effort and is not a transactional filesystem
snapshot; callers needing transactions must provide that in `load`.

`close()` clears both timers and closes all handles.
Cleanup attempts every timer and handle even if an injected disposer throws,
and always closes the reloader. Failed disposers remain owned and an explicit
repeated `close()` retries them; successful disposers are not called again.
Timer scheduling or cancellation failures also stop the watcher.

A watch error emits
`rejected/watch_failed` and closes the watcher; recreate it after fixing the
filesystem problem. A failed initial load still returns a watcher so a later
file correction can recover. Watch handles are non-persistent and do not keep an
otherwise finished Node process alive. No process/global listeners are installed.

## Deterministic test dependencies

`watchConfigFiles(input, dependencies?)` optionally accepts `ConfigWatchDependencies`
for canonicalization, directory stats, watching and one-shot scheduling. Each
scheduled job returns its cancellation function; no timer handle or wall clock is
required by the state machine. Omitting dependencies preserves native Node I/O
and timers. Lifetime cancellation during setup closes installed handles and fails
setup; after setup it closes the watcher and clears both timers. Core and Node
cancellation does not add process/global listeners or force-stop synchronous code.

For cooperative I/O cancellation, forward each callback's options rather than
closing over the original lifetime signal alone:

```ts
const reloader = createConfigReloader({
  signal: lifetime.signal,
  load: options => runConfigPipeline({
    ...pipeline,
    ...options,
    loaders: [{
      descriptor: file.descriptor,
      load: (_context, ioOptions) => loadJsonFileSource({ ...file, ...ioOptions })
    }]
  })
});
```

Closing aborts the owned signal even when no external lifetime signal was passed.
