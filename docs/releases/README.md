# Release Notes

Status: Active

Each release tag requires a reviewed Markdown file named
`docs/releases/<tag>.md`. The release workflow rejects a missing or empty file and
uses its content as the GitHub Release body.

Release notes summarize consumer-visible behavior, installation choices, breaking
changes, and migration links. `CHANGELOG.md` remains the chronological project
record; tag-specific notes are the publication copy for one release.

Do not claim that a hosted check, registry publication, or review period passed
before current evidence exists. Preparation notes may describe the checks that the
workflow will run.

The stable `1.0.0` publication copy is `docs/releases/v1.0.0.md`. Its operational
gate and allowed preparation diff are maintained in
`docs/ops/stable-1.0-release-checklist.md`.
