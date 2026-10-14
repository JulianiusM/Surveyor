# Frontend migration profile
<!--
documentation-metadata
audience: maintainers; frontend developers; AI coding agents
owner: frontend migration maintainers
status: current
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: approved return to readable delta staging, generic task-context delivery, digest-checked reconciliation and prepared-output review; production-guide-only freeze and active governance/runtime Help retained; no cutover or runtime change
source-anchors: docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; docs/frontend-migration/FRONTEND_FOUNDATION_DESIGN.md; docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; src/frontend/; docs/user-guide/en/; docs/user-guide/de/
next-review: next-authorized-migration-slice-or-cutover
activation-scope: frontend framework migration, frontend pilot review/maintenance, migration documentation or associated cutover preparation
staging-directory: staged
replacement-manifest: documentation-boundary.json
-->

Apply this profile only to work within its declared activation scope, after the two general policies. Their
[optional discovery procedure](../policies/DOCUMENTATION_POLICY.md#document-roles-and-optional-task-profiles)
requires neither this profile nor its directory to exist. This profile supplies additional task rules, not approval
or permission to override a general rule. Resolve conflicts directly before dependent implementation.

## Documentation roles

The maintainer's explicit 2026-10-14 clarification corrects the earlier overbroad freeze interpretation:

- **Frozen production guides:** repository/operator/development/testing guides, ordinary feature references and the
  native flat Help corpus remain the production reference. Update them only for explicitly approved/requested
  production changes. Removing frontend-migration links and staging references is separately approved; the boundary
  manifest records only the reviewed resulting contents for those exact cleanup paths.
- **Active governance:** general policies, their configuration, AI instructions, ADRs and Help-authoring rules remain
  active in their canonical locations. Do not stage them or make their application depend on this directory.
  Permanent owners use generic optional-profile discovery; temporary frontend rules belong here.
- **Runtime pilot Help:** reviewed language corpora/assets stay directly under `docs/user-guide/<locale>/` for the
  existing application reader. They are implemented content, not future replacements of production guides. Do not
  stage them. The shared trusted-content and whole-article fallback rules remain in active governance.
- **Amendment staging:** this profile's `staged/` directory contains readable changed sections and small fragments,
  not maintained complete guide copies. Its [manifest](documentation-boundary.json) owns targets, operations,
  original-content digests and metadata changes. No duplicate policy, AI or runtime Help copies belong there.
  Complete reconciled guides exist only as ignored preparation/review output before authorized publication.

## Native reference and shared implementation

During coexistence, compare the unchanged native UI/behavior with approved exceptions from the
[decision history](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments). Native preservation is
temporary and ends at authorized cutover; it never becomes a permanent policy or API contract. Reuse actual backend
business owners for both frontends. Controllers own decisions and DBAL owns persistence; no parallel backend cleanup
layer is permitted. General application defects remain a separately authorized effort, even when a proposed remedy
includes a minor frontend edit. Record their evidence and disposition without implementing them through migration.

Use the [Development amendments](staged/DEVELOPMENT.md) alongside unchanged canonical development guidance and
the active engineering policy. They retain the frontend playbook, ownership contracts and worked examples without
copying unrelated domain procedures. The [handoff](FRONTEND_FOUNDATION_DESIGN.md#migration-contribution-handoff),
[behavior inventory](BEHAVIOR_INVENTORY.md), [coverage map](TEST_COVERAGE.md) and
[review](PILOT_PARITY_REVIEW.md) supply feature-specific baseline and actual evidence. These references are followed
only after this profile is activated, rather than being required by general policies or production guides.

## Checks and delegation

Before editing, classify each owned path under the roles above and inspect its exact source/authorization. Pass this
active profile, file ownership and unresolved conflicts to each delegate. Apply the general concise approval format
and independent semantic review; labels, a passing syntax check or a generic cleanup instruction grant no approval.

Use the general bootstrap to deliver current policies and declared profiles; explicitly select this profile for
matching work. Carry its content identity and authorization through delegation and continuation. Reassess indirect
shared-backend or documentation impacts when scope changes. A separately authorized production task keeps its own
implementation scope even when its guide/source changes require reconciliation here.

Run `node docs/frontend-migration/check-documentation-boundary.mjs` before changes and at final review. Its immutable
baseline protects production worktree and index separately; active governance and runtime pilot Help are exempt.
Exact approved cleanup receipts accept only their reviewed content, not another edit or a blanket exemption.
Do not rebase or weaken the inventory to hide a finding. New production exceptions require direct approval and
independent source review before recording their exact receipt.

The guard also checks that every staged amendment is mapped, each payload is used once and operations name unique
locations. It reconciles against current approved guide contents. Untouched content passes through; changed touched
sections/fragments require an explicit reviewed reconciliation record. Do not accept today's hash automatically,
fuzzy-match a location or restore removed production references from the original commit.

Use `--preview` to assemble complete temporary guides before cutover and run the existing advisory checker at final
paths. It does not write production files. The preparation receipt identifies guide, amendment, manifest, source and
governance inputs plus raw output hashes; preparation is not semantic acceptance or publication authorization.
Review changed parts, inherited procedures and actual source independently. Record the actual reviewers and scope,
then use `--check-ready` with that receipt to detect later input/output changes. Readiness concerns this document
operation, never an application build, merge or release prerequisite.

The generic checker validates the live profile/map inventory as well as links in amendments; only named payload
links use final destination locations. Run its live-source report as well as the assembled preview, since the preview
omits this profile and cannot establish its source inventory. Reports remain advisory without application hooks.

Keep source/governance review inputs scoped to the amendment's actual dependencies and update affected guidance or
record the outstanding reconciliation in this profile's existing review/status owner. A changed source identity is
a review prompt, not proof that wording is wrong. Independent review distinguishes intended differences from drift.

## Verbatim cutover and retirement

Maintain final destination-relative links inside amendment payloads and production-valid destination metadata in the
manifest. Reconcile against current approved production inputs and prepare/review complete output **before** cutover.
Recheck the exact reviewed inputs and output identities immediately before the separately authorized document write.
Cutover copies those prepared bytes verbatim; it does not merge or repair text while publishing. Default routes,
native consumer removal and deployment each retain their own required authorization.

Release packaging uses generic optional-profile discovery to omit temporary working/staging material. Canonical
runtime Help and active governance remain packaged unchanged. Publication filtering is independent of migration
implementation and remains useful when this profile has been retired; no permanent owner requires this directory.

Retire this profile and completed control/staging material after cutover. The
[retirement inventory](FRONTEND_FOUNDATION_DESIGN.md#cutover-retirement-inventory) owns shared asset/helper,
consumer, comparator-test and historical-evidence dispositions. Keep durable decisions in active ADRs and open
defects in their existing owner. Generic discovery remains valid when this directory is gone.
