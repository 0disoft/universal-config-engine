import { buildConfigDiff, type RunConfigPipelineResult } from "@0disoft/universal-config-engine-core";

export type ReloadFailure = "load_failed" | "validation_failed" | "snapshot_failed" | "closed";
export type ConfigReloadOutcome =
  | { readonly ok: true; readonly revision: number; readonly snapshot: RunConfigPipelineResult }
  | { readonly ok: false; readonly revision: number; readonly reason: ReloadFailure };

export interface ConfigReloadEvent {
  readonly status: "updated" | "rejected";
  readonly revision: number;
  readonly reason?: ReloadFailure | "watch_failed";
  /** Counts public changes only; absent when comparison cannot fit its budget. */
  readonly changedPathCount?: number;
}

export interface CreateConfigReloaderInput {
  readonly load: () => Promise<RunConfigPipelineResult>;
  readonly onChange?: (event: ConfigReloadEvent) => void | Promise<void>;
}

export interface ConfigReloader {
  /** An active refresh and at most one queued refresh; bursts share that queue. */
  refresh(): Promise<ConfigReloadOutcome>;
  getSnapshot(): RunConfigPipelineResult | undefined;
  close(): void;
}

/** No automatic work starts until refresh is explicitly called. */
export function createConfigReloader(input: CreateConfigReloaderInput): ConfigReloader {
  return createReloadState(input).controller;
}

/** Internal notification boundary shared with the filesystem watcher. */
export function createReloadState(input: CreateConfigReloaderInput) {
  let closed = false;
  let revision = 0;
  let snapshot: RunConfigPipelineResult | undefined;
  let running: Promise<ConfigReloadOutcome> | undefined;
  let queued: { promise: Promise<ConfigReloadOutcome>; resolve: (outcome: ConfigReloadOutcome) => void } | undefined;
  const failed = (reason: ReloadFailure): ConfigReloadOutcome => ({ ok: false, revision, reason });
  function notify(event: ConfigReloadEvent) {
    if (closed || input.onChange === undefined) return;
    try { void Promise.resolve(input.onChange(Object.freeze(event))).catch(() => {}); } catch { /* Observers cannot break loading. */ }
  }
  function reject(reason: Exclude<ReloadFailure, "closed">) {
    notify({ status: "rejected", revision, reason });
    return failed(reason);
  }
  async function perform(): Promise<ConfigReloadOutcome> {
    let loaded: RunConfigPipelineResult;
    try { loaded = await input.load(); }
    catch { return closed ? failed("closed") : reject("load_failed"); }
    if (closed) return failed("closed");
    if (!loaded?.result?.ok || loaded.report?.status !== "ok") return reject("validation_failed");
    let next: RunConfigPipelineResult;
    let changedPathCount: number | undefined;
    try {
      next = freezeSnapshot(loaded);
      if (snapshot !== undefined) {
        const diff = buildConfigDiff(snapshot.result, next.result);
        if (diff.status === "ok") changedPathCount = diff.changes.filter(change =>
          change.before?.visibility !== "redacted" && change.after?.visibility !== "redacted").length;
      }
    } catch { return reject("snapshot_failed"); }
    snapshot = next;
    revision += 1;
    notify({ status: "updated", revision, ...(changedPathCount === undefined ? {} : { changedPathCount }) });
    return { ok: true, revision, snapshot: next };
  }
  function start(): Promise<ConfigReloadOutcome> {
    let complete!: (outcome: ConfigReloadOutcome) => void;
    const task = new Promise<ConfigReloadOutcome>(resolve => { complete = resolve; });
    // The application callback can synchronously request another refresh.
    // Claim the running slot before invoking it so that request joins the queue.
    running = task;
    void task.then(() => {
      running = undefined;
      const waiting = queued;
      queued = undefined;
      if (waiting !== undefined) {
        if (closed) waiting.resolve(failed("closed"));
        else void start().then(waiting.resolve);
      }
    });
    void perform().catch(() => closed ? failed("closed") : reject("load_failed")).then(complete);
    return task;
  }
  const controller: ConfigReloader = {
    refresh() {
      if (closed) return Promise.resolve(failed("closed"));
      if (running === undefined) return start();
      if (queued === undefined) {
        let resolve!: (outcome: ConfigReloadOutcome) => void;
        const promise = new Promise<ConfigReloadOutcome>(complete => { resolve = complete; });
        queued = { promise, resolve };
      }
      return queued.promise;
    },
    getSnapshot: () => snapshot,
    close() {
      closed = true;
      queued?.resolve(failed("closed"));
      queued = undefined;
    }
  };
  return { controller, watchFailed: () => notify({ status: "rejected", revision, reason: "watch_failed" }) };
}

function freezeSnapshot(value: RunConfigPipelineResult): RunConfigPipelineResult {
  const copy = structuredClone(value);
  const pending: object[] = [copy];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of Object.values(current)) if (child !== null && typeof child === "object") pending.push(child);
    Object.freeze(current);
  }
  return copy;
}
