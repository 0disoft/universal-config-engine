# Release Notes

Status: Active

Each release tag requires a reviewed Markdown file named
`docs/releases/<tag>.md`. The release workflow rejects a missing or empty file and
uses its content as the GitHub Release body.

Release notes summarize consumer-visible behavior, installation choices, breaking
changes, and migration links. `CHANGELOG.md` remains the chronological project
record; tag-specific notes are the publication copy for one release.

Do not claim that a hosted check, registry publication, or validation gate passed
before current evidence exists. Preparation notes may describe the checks that the
workflow will run.

The current candidate publication copy is `docs/releases/v1.3.0-rc.1.md`; the
stable publication copy is `docs/releases/v1.2.0.md`. Release operations and SBOM
evidence are defined in `docs/ops/release.md`; exact candidate authorization is
maintained in `release-policy.json`. The historical `1.0.0` preparation checklist
is `docs/ops/stable-1.0-release-checklist.md`.
