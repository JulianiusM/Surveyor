# Frontend migration profile
<!--
documentation-metadata
audience: maintainers; frontend developers; AI coding agents
owner: frontend migration maintainers
status: current
last-verified: 2026-10-16
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: direct 2026-10-16 native isolation, production-coexistence exclusion and ordinary SPA source adoption reconciled with scoped verification; sharing within Vue, backend exclusions and production-guide freeze retained; no later-phase or cutover authorization
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

During migration review, compare the unchanged native UI/behavior with approved exceptions from the
[decision history](FRONTEND_FOUNDATION_DESIGN.md#original-decisions-and-dated-amendments). Native preservation is
temporary and ends at authorized cutover; it never becomes a permanent policy or API contract. Reuse actual backend
business owners for both frontends. Controllers own decisions and DBAL owns persistence; no parallel backend cleanup
layer is permitted. General application defects remain a separately authorized effort, even when a proposed remedy
includes a minor frontend edit. Record their evidence and disposition without implementing them through migration.

The [native-frontend isolation decision](FRONTEND_FOUNDATION_DESIGN.md#authorized-native-frontend-isolation-decision-2026-10-15)
keeps native frontend code untouched until full migration and its separately authorized removal. The new frontend
copies required native behavior into its own owners rather than importing native frontend code. Temporary duplication
between those frontends is approved; matching consumers within the new frontend still share one owner. Existing
backend/domain/controller/DBAL operations and catalogs remain shared. Third-party dependencies and shared image assets
are outside this application-code boundary. The existing feedback owner now supplies its own transient timer, and
copied authored Sass is composed once by `styles/application.sass` and delivered through Vite's client/SSR asset
handling rather than native frontend imports/links.
The maintainer's [October 16 R1 clarification](FRONTEND_FOUNDATION_DESIGN.md#direct-native-isolation-clarification-2026-10-16)
confirms that Vue copies are separately mutable: the sharing requirement concerns matching Vue consumers, and
native application presentation/frontend logic does not become a common owner for both frontends.
The [review](PILOT_PARITY_REVIEW.md#native-frontend-isolation-implementation-2026-10-15) records the bounded dependency
and parity checks; this implementation does not complete feature migration or authorize cutover.
Preserve the current approved comparator with its dated exceptions; this decision does not direct a rollback of
previously approved changes.

The [direct E1 production-scope decision](FRONTEND_FOUNDATION_DESIGN.md#direct-production-coexistence-exclusion-and-spa-correction-2026-10-16)
excludes simultaneous native/Vue production use. Do not implement Event native/versioned permission coordination
for that scenario; `IMP-066` closes by exclusion, not repair. This does not remove the temporary native development
comparator, authorize cutover or roll back the previously approved Packing coordination remedy.

**Approved parity-only clarification (2026-10-14):** the maintainer explicitly limits the migration to visual and
behavioral parity, except for previously approved frontend changes. Minor backend transport/presentation adaptation
may reuse existing shared implementation; general backend fixes, stronger legacy transaction/token guarantees and
existing backlog remedies are excluded and must not become migration prerequisites. This expressly defers R1A
current-owner token issuance, R1B current-token consumption, R2 transfer completion, R3 profile-deactivation completion
and R4 account-deletion completion. Their defects remain open in the central backlog; the decisions are exclusions,
not pending approval requests. Continue the corresponding frontend journeys against the existing shared behavior.
Previously approved bounded corrections retain their scope. New frontend/adapter code still follows security,
private-projection, contract, readability, no-replay and delivery requirements without claiming a repaired backend.

The same direct reply rejects D1's Event document-POST exception and reinforces ordinary SPA commands/navigation
throughout implemented P0–P2. Classify every changed form/link by its actual purpose: ordinary internal commands
use authored generated JSON/multipart contracts and shared Vue owners, while true provider/capability arrivals,
outputs and unmigrated destinations retain their explicit boundaries. Partial backend completion is not a reason
to submit an ordinary Vue form as a document. Preserve existing operation order and honest confirmed/unknown
outcomes without importing excluded backend repairs. The existing playbook and built-application tests must show
actual matching-consumer adoption and same-document behavior; no new infrastructure checker or CI gate is required.

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
