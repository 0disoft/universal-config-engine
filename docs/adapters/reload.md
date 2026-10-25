# Reload and File Watching

Status: Available in 1.3.0, ADR 0018. Existing pipelines never start background work.

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
only `load_failed`, `load_timeout`, `validation_failed` or `snapshot_failed`, never exceptions.
Observer failures are contained. Observers run separately
from refresh completion: at most one asynchronous observer runs and only the latest
pending notification is retained. Superseded notifications are coalesced, and their
replacement omits `changedPathCount` because intermediate snapshots were skipped.
Synchronous observers still receive each event immediately. An observer may await
`refresh()` without blocking the load queue. This is a latest-state notification
surface, not an audit log with guaranteed delivery of every intermediate event.

Observers receive an optional second `{ signal }` argument. Closing drops pending
notifications and aborts that signal; cooperative observers must check cancellation
before external writes and release their own resources in `finally`. An observer
that ignores cancellation may finish its already-started external work after close.

Updated events expose revision and, when a safe
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

### Automatic declaration graphs (1.3)

`watchConfig` loads through the same Node `loadConfig` facade and owns its file
dependency set. No separate loader callback or manually maintained file list is
required:

```ts
import { watchConfig } from "@0disoft/universal-config-engine-node";
import { createAjvValidator } from "@0disoft/universal-config-engine-validator-ajv";

const watched = await watchConfig({
  configPath: "uce.json", cwd: process.cwd(), workspacePath: process.cwd(),
  profile: "production", validatorFactory: createAjvValidator,
  onChange(event) { console.log(event.status, event.revision); }
});
if (!watched.ok) throw new Error(watched.code);
// Read private application config via watched.watcher.getSnapshot().
// Retain the handle, and call watched.watcher.close() at shutdown.
```

`WatchConfigInput` accepts the normal loading/profile/validation options plus
reloader deadlines, `onChange`, cancellation and debounce options. `workspacePath`
is required and is canonicalized once for the session. Replacing that workspace
alias does not move the session to a different workspace. Return values and
reloader methods are the same as `watchConfigFiles`, including an initial failed
load that leaves a live watcher for repair.

The root declaration is watched before its first read. Inherited declarations
(including missing files) are subscribed before their reads. Selected-profile
JSON, dotenv and official adapter file sources are subscribed as one batch before
source I/O. Each serialized reload rediscovers the graph once; it does not reparse
declarations in a separate discovery pass. An unchanged selection is canonicalized
once per refresh, rather than again for each discovery callback. New files are subscribed while loading,
so their changes join the existing single queued refresh. A valid new load drops
obsolete dependencies; failed loads keep the last-good dependency set and the
current attempt's repair files. The last-good config remains immutable.

Missing directories retain their nearest existing ancestor subscription, enabling
repair by creating a missing directory/declaration/source. An escaping symlink
retains only safe ancestor subscriptions; the normal loader still rejects opening
outside the workspace. No watcher is installed outside that boundary. A failed
load can be repaired by editing its declaration or a discovered in-workspace file.

Automatic selection has a fixed 160-path budget shared by the last-good and pending
graphs (two ordinary graphs of 16 declarations and 64 file sources). It still uses
at most 128 directory handles and 192 canonicalization requests per selection pass.
The limits may reject large/deep/alias-heavy graphs even if a custom core limit
allows more sources. Budget failures reject the refresh without publishing partial
config or losing the last good snapshot. Closing, cancellation and timeouts own all
subscriptions/timers through the shared watcher/reloader lifecycle.

Environment/argv changes still need `refresh()`. Files opened privately by a custom
validator/factory are not inferred. Filesystem notifications remain best effort,
not a transactional snapshot. Existing `watchConfigFiles` stays available for
explicit/custom loaders with its original 64-path bound.

### Explicit file selections

Initial watcher metadata setup is bounded by `loadTimeoutMs` (default 30 seconds)
and the lifetime `signal`, before any watch handle is acquired. One setup pass
shares its deadline across root `realpath`, directory `stat` and the complete
ancestor/target selection; the deadline does not restart per filesystem request.
`watchConfig` additionally bounds its preceding workspace-alias canonicalization
as a separate pass with the same limit. Initial loading retains its own existing
load deadline. Cancellation/timeout returns `watch_setup_failed` and releases
the setup timer/listener. Already-started OS I/O may finish later, but it cannot
start another metadata request, acquire subscriptions or invoke the loader.

`await watchConfigFiles({ workspacePath, paths, load, onChange?, debounceMs? })`
returns `{ ok: true, watcher, initial }` or a sanitized setup failure. `watcher`
has the same methods as a reloader. At most 64 explicit paths are accepted;
the bounded selection is copied and validated before asynchronous filesystem work,
so later changes to the caller's array do not change this watcher's inputs.
Relative paths use the workspace; explicit selections must also be lexically inside
that workspace. Parent directories and existing targets are
canonicalized and checked inside that boundary. Actual file loaders must still
enforce the workspace when opening each file, including after replacement.

In-workspace file and directory symlinks watch both the logical path components
and the canonical target's components. Each component is selected by basename
in its canonical parent, so replacing an intermediate directory or directory
link also requests a refresh. Before
each load, target boundaries are rechecked and directory watches are rebound;
retargeting outside the workspace rejects the refresh without calling `load`.
Directory selections are deduplicated across all paths. The global maximum remains
128 handles, with at most 192 cached `realpath` requests per selection pass. These
budgets include ancestor directories; deeply nested selections or many distinct
aliases may exhaust them even with fewer than 64 files. Initial budget exhaustion
returns `watch_setup_failed` before installing handles or calling `load`; during
refresh it rejects that load and retains the previous watches and last good config.

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

Watcher path canonicalization shares repeated parent and target lookups within
one setup or refresh pass. Each refresh starts a fresh cache so symlink changes
remain visible. File loaders retain their own open-time boundary checks.

## Operation deadlines and private failures

Loads and asynchronous observers have independent 30-second deadlines, configurable
with `loadTimeoutMs` and `observerTimeoutMs` (integer milliseconds, 1–2147483647).
Each callback receives an owned signal combining the lifetime cancellation with
its operation deadline. Timers and listeners are removed when work settles or is
cancelled; the operation signal also closes when its callback settles and must not
be retained for background work. Existing synchronous observers still run immediately. Synchronous code
cannot be preempted; callbacks must yield and cooperate with cancellation.

A load timeout resolves active and queued refreshes as `load_timeout`, retains the
last good snapshot and permanently stops that reloader. It never starts another
load over an abandoned callback. Fix the external dependency and ensure abandoned
work has stopped before creating a replacement. A watcher closes its handles and
timers on load timeout; initial timeout returns `watch_setup_failed`.

An observer timeout aborts its signal, drops queued notifications and disables
future notifications on that instance. Refresh remains usable, with no second
observer overlapping an uncooperative first one. Recreate after recovery when
notifications are needed. No callback receives automatic retries.

Optional `onError` observes private `Error.cause` chains using stable codes
`reload_load_failed`, `reload_load_timeout`, `reload_snapshot_failed`,
`reload_observer_failed` and `reload_observer_timeout`. It is never a public report
or a default log sink. Normal close/cancellation is not reported as a failure.
