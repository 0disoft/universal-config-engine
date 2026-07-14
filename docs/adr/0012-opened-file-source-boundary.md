# ADR 0012: Opened File Source Boundary

Status: Accepted
Owner: UNASSIGNED

## Purpose

Close the filesystem race between checking a declared file path and reading that
path through the Node source loaders.

## Source of Truth

- CLI file boundary: `docs/adr/0008-cli-file-source-path-boundary.md`
- Public library API: `docs/library/public-api.md`
- Security baseline: `docs/engineering/04-security-baseline.md`

## Decision

`FileReadPolicy` accepts an optional `allowedRootPath`. When it is provided, the
Node file reader:

1. opens the requested file without reading contents;
2. canonicalizes the allowed root and current file path;
3. rejects a canonical file path outside the allowed root;
4. requires matching bigint `ino` identity from the current path and opened handle,
   and also requires matching `dev` when both calls provide a nonzero device id;
5. reads only from that verified handle.

Boundary lookup failure, an outside canonical path, or changed file identity
returns a bounded `source-load` issue without raw path or file content. The reader
fails closed. JSON and dotenv loaders pass the policy to the shared file reader.

Successful bounded reads return the verified canonical file path. The CLI retains
that path as declaration context so later relative source resolution cannot perform
a second, inconsistent symlink lookup.

The CLI always supplies its canonical pipeline declaration directory as
`allowedRootPath`. Lower-level Node package consumers opt into the boundary by
supplying their own root; omitting it preserves caller-owned path behavior.

## Rationale

A path can be replaced by a symbolic link or reparse point after a preflight
`realpath` check. Verifying the canonical path and file identity after `open`
detects replacement before contents are read. Reading from the already verified
handle prevents a later path replacement from redirecting the read.

## Consequences

- CLI file sources have defense in depth across declaration parsing and actual
  file reading.
- Node consumers can apply the same boundary without depending on CLI code.
- Boundary verification adds filesystem metadata calls only when
  `allowedRootPath` is configured.
- Platforms must provide stable bigint `ino` values through Node.js `stat` for
  identity verification. Device identity is additionally compared when both stat
  variants provide it. Windows Node.js `24.0.0` reports path `dev` as zero while
  handle `dev` is nonzero, so zero is treated as unavailable rather than as a
  mismatched device. Bigint comparison avoids numeric precision loss.

## Validation

- Node tests reject an opened source whose canonical path escapes through a
  symbolic link or Windows junction.
- Node tests fail closed when the allowed root cannot be canonicalized.
- Node tests distinguish parent traversal from valid child names beginning with
  two dots.
- CLI tests continue to cover outside traversal, junction traversal, internal
  absolute paths, and equivalent directory aliases.
- CLI tests retarget a declaration symlink after reading and prove relative sources
  remain anchored to the opened declaration identity.

## Review Blockers

- File contents are read before boundary and identity verification completes.
- Boundary errors include raw file contents or sensitive filesystem paths.
- CLI file loaders omit the declaration directory boundary.
