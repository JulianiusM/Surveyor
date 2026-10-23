# Staged frontend operations amendments
<!--
documentation-metadata
audience: maintainers; frontend developers; migration reviewers
owner: frontend migration maintainers
status: migration-pending
last-verified: 2026-10-23
verification-baseline: docs-baseline-2026-09-06-d14
verification-scope: existing automatic document reload and approved participant-payer wording retained; inherited native five-second notice claim reconciled with approved shared Vue feedback and no-repeat guidance; production reference unchanged; no runtime or cutover execution claimed
source-anchors: docs/frontend-migration/documentation-boundary.json; docs/frontend-migration/check-documentation-boundary.mjs; docs/policies/DOCUMENTATION_POLICY.md; docs/policies/DEVELOPMENT_POLICY.md; docs/UPGRADING.md; src/modules/invoice/invoiceOperations.ts; src/modules/invoice/calculation.ts; src/public/js/events.ts; src/frontend/; package.json
next-review: next-authorized-migration-slice-or-cutover
-->

These amendments retain the reviewed frontend guidance without copying unchanged production procedures.
The [profile](../PROFILE.md) governs preparation and review; its [manifest](../documentation-boundary.json)
owns destination mapping and exact operations. Payload links use their mapped production location.
Surrounding notes use this file's location. Preparing complete temporary output does not authorize cutover.

## Operational model — amendment-01

<!-- delta:amendment-01 -->
production dependency manifests. Express serves the application and its compiled frontend assets from this same
release; production requires no Vite development server or separate frontend asset service. Keep server rendering,
fingerprinted client files, generated contracts, language catalogs and reviewed Help together with their matching
production dependencies. The archive does not replace the need for:

<!-- /delta:amendment-01 -->

## 2. Extract and verify the release — amendment-02

<!-- delta:amendment-02 -->
  server.js
  frontend-server/entry-server.mjs
  public/app/.vite/manifest.json
  public/app/assets/
  api-contracts/
  modules/localization/generated/
docs/

<!-- /delta:amendment-02 -->

## 2. Extract and verify the release — amendment-03

<!-- delta:amendment-03 -->
The `docs/user-guide/` directory and its reviewed language corpora/assets must be present because the application
serves them as in-app help. `dist/api-contracts/` contains the generated contract description, operation manifest and
server validators; the language resources and manifest are packaged under `dist/modules/localization/generated/`.
Install the entire release rather than copying individual server files or client chunks from another build.

<!-- /delta:amendment-03 -->

## 4. Attach persistent files — amendment-04

<!-- delta:amendment-04 -->
The application detects a changed frontend build through normal session refresh. Compatible edits already open in
the browser may finish. Only eligible dynamic content pages, currently Overview, Packing/Drivers/Survey/Activity detail, and Event
detail/admin, can reload automatically when clean and idle. Creation, duplication, user-management, Help and static error/completion pages
retain deliberate recovery, even when untouched. Draft/pending/unknown and loop guards still apply. A missing client
chunk or incompatible command retains mounted drafts for deliberate recovery rather than automatically replaying
writes. Operators do not maintain an old-asset directory. Users with unsaved or uncertain work should review the
displayed recovery choices before reloading. Session/security revalidation and periodic content reads are unchanged.

### 4. Attach persistent files

<!-- /delta:amendment-04 -->

## Invoice retention — amendment-05

<!-- delta:amendment-05 -->
[Invoice Pools and Payments](user-guide/en/INVOICE_POOLS.md#privacy-proof-access-storage-and-retention).

<!-- /delta:amendment-05 -->

## Post-start validation — amendment-06

<!-- delta:amendment-06 -->
For a page that uses the Vue frontend, also check its emitted scripts/styles and one actual interaction after browser
initialization. Confirm that the expected controls become usable, no startup notice or asset-load error remains, and
Help links/search work in each enabled interface language. Server-rendered HTML alone does not prove that browser
initialization or commands work. These checks supplement the enabled sign-in/provider and delivery checks above.

Remove disposable test data according to normal application and retention procedures.

<!-- /delta:amendment-06 -->

## Decommissioning — amendment-07

<!-- delta:amendment-07 -->
### A frontend page cannot finish loading after a release change

Check that the server renderer, current manifest, client scripts/styles, generated contracts and language resources all
come from the same release. Review browser asset failures and proxy responses as well as application logs. Preserve
unsaved input and review any uncertain command against current saved data before refreshing; do not resend a creation
or upload merely because its response was lost. Reinstall the coherent release when files are missing or mismatched.

## Decommissioning

<!-- /delta:amendment-07 -->

## Invoice pool factors, rebates, and recalculation — amendment-08

<!-- delta:amendment-08 -->
It adds the recorder profile and name snapshot to invoice records. Organizer expenses can omit proof and enter
accepted shared costs immediately. They may optionally identify an eligible participant who paid; that participant's
invoice history and the pool's invoice-credit setting apply. Without participant attribution, the expense creates no
personal invoice credit. Recorder attribution remains separate and does not itself grant personal invoice credit.
An authorized organizer does not need to attend the event to record one. Adding an expense after

<!-- /delta:amendment-08 -->

## Invoice pool factors, rebates, and recalculation — amendment-09

<!-- delta:amendment-09 -->
Pool controls retain their pending state through server confirmation and required follow-up reads. Keep the page open
and do not repeat an action while it is pending. Transient result notices disappear after ten seconds; unresolved
outcomes and stale-calculation conditions remain visible.

<!-- /delta:amendment-09 -->
