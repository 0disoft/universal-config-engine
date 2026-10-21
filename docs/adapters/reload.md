# Reload and File Watching

Status: Unreleased, ADR 0018. Existing pipelines never start background work.

`createConfigReloader({ load, onChange? })` returns `refresh()`, `getSnapshot()`
and `close()`. The callback runs the application's existing pipeline. Refreshes
are serialized: one load can run and one following load can be queued; further
requests share that queued Promise. No unbounded queue of callback work is kept.

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
