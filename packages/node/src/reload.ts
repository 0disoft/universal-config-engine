import { buildConfigDiff, cloneConfigValue, type ConfigOperationOptions, type ConfigChange, type ConfigPath, type RunConfigPipelineResult } from "@0disoft/universal-config-engine-core";

export type ReloadFailure = "load_failed" | "validation_failed" | "snapshot_failed" | "closed";
export type ConfigReloadOutcome =
  | { readonly ok: true; readonly revision: number; readonly snapshot: RunConfigPipelineResult }
  | { readonly ok: false; readonly revision: number; readonly reason: ReloadFailure };

export interface ConfigReloadEvent {
  readonly status: "updated" | "rejected";
  readonly revision: number;
  readonly reason?: ReloadFailure | "watch_failed";
  /** Counts public changes only; absent when comparison exceeds its budget or secret container structure is ambiguous. */
  readonly changedPathCount?: number;
}

export interface CreateConfigReloaderInput extends ConfigOperationOptions {
  readonly load: (options?: ConfigOperationOptions) => Promise<RunConfigPipelineResult>;
  readonly onChange?: (event: ConfigReloadEvent, options?: ConfigOperationOptions) => void | Promise<void>;
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
  const cancellation = new AbortController();
  let cancelActive: (() => void) | undefined;
  let revision = 0;
  let snapshot: RunConfigPipelineResult | undefined;
  let running: Promise<ConfigReloadOutcome> | undefined;
  let queued: { promise: Promise<ConfigReloadOutcome>; resolve: (outcome: ConfigReloadOutcome) => void } | undefined;
  let notifying = false;
  let pendingNotification: ConfigReloadEvent | undefined;
  const failed = (reason: ReloadFailure): ConfigReloadOutcome => ({ ok: false, revision, reason });
  function notify(event: ConfigReloadEvent) {
    if (closed || input.onChange === undefined) return;
    if (notifying) {
      // A count relative to an omitted intermediate snapshot would be misleading.
      const { changedPathCount: _count, ...coalesced } = event;
      pendingNotification = pendingNotification === undefined ? event : coalesced;
      return;
    }
    notifying = true;
    try {
      const result = input.onChange(Object.freeze(event), { signal: cancellation.signal });
      if (result !== undefined) {
        void Promise.resolve(result).then(finishNotification, finishNotification);
        return;
      }
    } catch { /* Observers cannot break loading. */ }
    finishNotification();
  }
  function finishNotification() {
    notifying = false;
    const next = pendingNotification;
    pendingNotification = undefined;
    if (next !== undefined) notify(next);
  }
  function reject(reason: Exclude<ReloadFailure, "closed">) {
    notify({ status: "rejected", revision, reason });
    return failed(reason);
  }
  async function perform(): Promise<ConfigReloadOutcome> {
    let loaded: RunConfigPipelineResult;
    try { loaded = await input.load({ signal: cancellation.signal }); }
    catch { return closed ? failed("closed") : reject("load_failed"); }
    if (closed) return failed("closed");
    if (!loaded?.result?.ok || loaded.report?.status !== "ok") return reject("validation_failed");
    let next: RunConfigPipelineResult;
    let changedPathCount: number | undefined;
    try {
      next = freezeSnapshot(loaded);
      if (snapshot !== undefined) {
        // Reports also contain reportOptions-only policies, absent from result.
        // Retain either side's redaction even when the caller removes a policy.
        const secretPaths = [snapshot, next].flatMap(item => item.report.resolvedPaths
          .filter(entry => entry.redacted).map(entry => entry.path));
        const diff = buildConfigDiff(snapshot.result, next.result, { secretPaths });
        if (diff.status === "ok" && !hasOpaqueContainerChange(diff.changes, secretPaths)) changedPathCount = diff.changes.filter(change =>
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
    cancelActive = () => complete(failed("closed"));
    void task.then(() => {
      running = undefined;
      cancelActive = undefined;
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
      if (closed) return;
      closed = true;
      pendingNotification = undefined;
      cancellation.abort();
      input.signal?.removeEventListener("abort", abort);
      cancelActive?.();
      queued?.resolve(failed("closed"));
      queued = undefined;
    }
  };
  function abort() { controller.close(); }
  input.signal?.addEventListener("abort", abort, { once: true });
  if (input.signal?.aborted) controller.close();
  return { controller, watchFailed: () => notify({ status: "rejected", revision, reason: "watch_failed" }) };
}

/** Leaf redaction cannot prove whether a changed ancestor container is public. */
function hasOpaqueContainerChange(changes: readonly ConfigChange[], secretPaths: readonly ConfigPath[]): boolean {
  const containers = changes.filter(change => change.before?.visibility === "container" || change.after?.visibility === "container");
  if (containers.length === 0 || secretPaths.length === 0) return false;
  // Typed segments preserve array indexes vs object names, without an all-pairs scan.
  type Trie = Map<string | number, Trie>;
  const root: Trie = new Map();
  for (const path of secretPaths) {
    let node = root;
    for (const segment of path) {
      let child = node.get(segment);
      if (child === undefined) { child = new Map(); node.set(segment, child); }
      node = child;
    }
  }
  return containers.some(change => {
    let node: Trie | undefined = root;
    for (const segment of change.path) node = node?.get(segment);
    return node !== undefined && node.size > 0;
  });
}

function freezeSnapshot(value: RunConfigPipelineResult): RunConfigPipelineResult {
  // Native structuredClone can exhaust its call stack on a config that core
  // successfully validated with an explicitly increased depth budget.
  const metadata = structuredClone({ ...value, result: { ...value.result, config: null } });
  const copy: RunConfigPipelineResult = { ...metadata, result: {
    ...metadata.result, config: cloneConfigValue(value.result.config)
  } };
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
