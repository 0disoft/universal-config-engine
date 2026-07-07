# Rollback

Status: Draft

## Operational Contract

Provide a short actionable decision tree with triggers, package or CLI rollback
procedure, contract validation, owners, and forward-fix criteria.

This repository does not currently own database rollback policy, hosted API rollback,
or migration recovery. Those surfaces require a future ADR before becoming active
operations scope.

## Owners

- Primary owner: UNASSIGNED
- Backup owner: UNASSIGNED
- Escalation path: repository issues for non-sensitive package failures; do not
  include npm tokens or credentials in issues.

## Package Rollback Procedure

If a bad package is published:

1. Stop further publishes and preserve the failing version, tag, and validation log.
2. Deprecate the bad npm version with a short pointer to the fixed version when npm
   publication is active.
3. Prepare a patch version that reverts or forward-fixes the package behavior.
4. Run the full release pre-checks from `docs/ops/release.md`.
5. Publish the patch only after validation passes and package scope/authentication
   are confirmed.

If a GitHub release exists but npm publication has not happened:

1. Preserve the failing tag, release URL, asset names, and validation log.
2. Remove or replace only the bad release assets after a corrected build is
   available from a clean tagged commit.
3. Supersede the release notes with the corrective commit or replacement tag when
   the tag itself is wrong.
4. Keep the corrective commit history intact; do not hide a bad public artifact by
   rewriting history after it has been announced.

If only a GitHub tag or release draft exists, delete or supersede the draft before
public announcement and keep the corrective commit history intact.

## Validation

- Required validation names: check, smoke, docs.
- Release blocker status: rollback is blocked while the fix fails local validation,
  package smoke checks, or secret-safety checks.
- Remaining operational risk: npm unpublish behavior is registry-policy dependent;
  prefer deprecating bad versions and publishing a fixed patch.
