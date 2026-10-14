# Staged frontend upgrading amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-14
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: digest-guarded frontend amendments preserve complete reviewed candidate guidance; unchanged production procedures stay in their existing owners; no runtime or cutover execution claimed
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; src/frontend/; package.json
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Before scheduling the change — amendment-01

<!-- delta:amendment-01 -->
The runtime bundle includes matching Express/server-rendering output, fingerprinted client assets, generated API
contracts and language catalogs. Keep these together with the reviewed Help corpora and runtime dependencies.
See the [release-content inventory](OPERATIONS.md#2-extract-and-verify-the-release) before activating the release.
Production runs the existing Node service without a Vite development server or additional frontend asset service.

## Before scheduling the change

<!-- /delta:amendment-01 -->

## 1. Verify and extract the release — amendment-02

<!-- delta:amendment-02 -->
Verify the frontend renderer, client manifest/assets, generated contract validators and language resources listed in
the [operations runbook](OPERATIONS.md#2-extract-and-verify-the-release). Do not assemble a release from selected files
belonging to different builds or run generation inside the installed runtime directory.

The release workflow does not create a sidecar checksum file. Obtain the expected digest from the approved release

<!-- /delta:amendment-02 -->

## 5. Start and validate — amendment-03

<!-- delta:amendment-03 -->
Replace the compiled runtime and frontend artifacts together. The application detects the new build through normal
session refresh: compatible open edits may finish, and a clean idle page reloads once. Missing chunks or incompatible
commands preserve mounted drafts for deliberate recovery. No retained old-client asset directory is required.
This browser recovery does not remove the maintenance window, schema checks or rollback boundaries above.

### 5. Start and validate

<!-- /delta:amendment-03 -->

## 5. Start and validate — amendment-04

<!-- delta:amendment-04 -->
On pages using the Vue frontend, fetch the emitted scripts/styles and exercise required controls after initialization.
Check Help navigation/search and the selected language as well as successful server rendering. A rendered document or
healthy server alone does not verify initialized controls; use the [full operations checklist](OPERATIONS.md#post-start-validation).
Validate enabled identity-provider and SMTP workflows independently rather than infer them from frontend loading.

Only then remove the maintenance response and reopen normal traffic.

<!-- /delta:amendment-04 -->
